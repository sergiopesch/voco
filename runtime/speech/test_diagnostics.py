import io
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from streaming import Metrics
from worker_main import identity, metadata, serve, main

class FakeModel:
    def start(self): pass

class FakeMetrics:
    run_id='fixture'
    def __init__(self): self.rows=[]
    def emit(self,event,**fields): self.rows.append(dict(event=event,**fields))

class DiagnosticsTests(unittest.TestCase):
    def test_boolean_negative_and_unbounded_identity_rejected(self):
        for value in [True,-1,'2']:
            with self.assertRaises(ValueError): identity({'session':'one','seq':value})
        with self.assertRaises(ValueError): identity({'session':'x'*81,'seq':1})

    def test_correlates_hash_without_retaining_session_content(self):
        content='private dictated words'
        data=metadata({'session':content,'seq':2,'dictation_session_id':4,'queue_age_ms':float('nan')})
        self.assertNotIn(content,json.dumps(data));self.assertEqual(len(data['stream_session_hash']),64)
        self.assertEqual(data['dictation_session_id'],4);self.assertIsNone(data['queue_age_ms'])

    def test_non_object_json_does_not_crash_protocol(self):
        metrics=FakeMetrics();output=io.StringIO()
        serve(output,io.BytesIO(b'[]\nnull\n{"session":"one","seq":0,"op":"unknown"}\n'),FakeModel(),metrics)
        responses=[json.loads(x) for x in output.getvalue().splitlines()]
        self.assertTrue(responses[0]['ready']);self.assertEqual(len(responses),4)
        self.assertTrue(all('error' in x for x in responses[1:]));self.assertEqual(len(metrics.rows),3)

    def test_eof_exits_successfully_but_truncated_or_oversized_protocol_fails(self):
        for data, expected in ((b'', 0), (b'{', 1), (b'x' * (4 * 1024 * 1024) + b'\n', 1)):
            metrics = FakeMetrics()
            self.assertEqual(serve(io.StringIO(), io.BytesIO(data), FakeModel(), metrics), expected)
            if expected:
                self.assertEqual(metrics.rows, [{'event': 'protocol_rejected', 'reason': 'oversized_or_truncated'}])

    def test_missing_dependency_returns_sanitized_startup_failure(self):
        protocol = io.StringIO()
        with patch.dict('sys.modules', {'streaming': None}), patch('sys.stderr', new_callable=io.StringIO) as errors:
            self.assertEqual(main(protocol), 1)
        self.assertEqual(json.loads(protocol.getvalue()), {'ready': False, 'error': 'local speech runtime could not initialize'})
        diagnostic = json.loads(errors.getvalue())
        self.assertEqual(diagnostic['event'], 'worker_startup_failed')
        self.assertEqual(diagnostic['stage'], 'runtime_import')
        self.assertEqual(diagnostic['error_code'], 'runtime_dependency_missing')
        self.assertEqual(set(diagnostic), {'event', 'stage', 'error_type', 'error_code'})

    def test_unsafe_metrics_paths_disable_logging_without_touching_targets(self):
        for kind in ('symlink', 'hardlink', 'fifo', 'public_file', 'public_directory', 'directory_link'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp) / 'voco/stream-performance'
                root.mkdir(parents=True, mode=0o700)
                target = Path(tmp) / 'target'
                target.write_text('retained sentinel')
                target.chmod(0o600)
                log = root / 'worker.jsonl'
                if kind == 'symlink':
                    log.symlink_to(target)
                elif kind == 'hardlink':
                    os.link(target, log)
                elif kind == 'fifo':
                    os.mkfifo(log, 0o600)
                elif kind == 'public_file':
                    log.write_text('retained log')
                    log.chmod(0o644)
                elif kind == 'public_directory':
                    root.chmod(0o755)
                else:
                    root.rmdir()
                    other = Path(tmp) / 'other'
                    other.mkdir(mode=0o700)
                    root.symlink_to(other, target_is_directory=True)
                with patch.dict(os.environ, {'XDG_STATE_HOME': tmp, 'VOCO_PERFORMANCE_LOG': '1'}), patch('sys.stderr', new_callable=io.StringIO) as errors:
                    started = time.monotonic()
                    metrics = Metrics()
                    self.assertFalse(metrics.enabled)
                    metrics.emit('ignored')
                    metrics.close()
                    self.assertLess(time.monotonic() - started, 1)
                    self.assertEqual(errors.getvalue().strip(), '{"event":"worker_metrics_unavailable"}')
                self.assertEqual(target.read_text(), 'retained sentinel')
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                if kind == 'public_file':
                    self.assertEqual(log.read_text(), 'retained log')
                    self.assertEqual(log.stat().st_mode & 0o777, 0o644)

    def test_rotated_worker_logs_remain_private(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'XDG_STATE_HOME': tmp, 'VOCO_PERFORMANCE_LOG': '1'}):
            metrics = Metrics()
            metrics.handler.maxBytes = 500
            for index in range(30):
                metrics.emit('fixture', count=index)
            metrics.close()
            logs = list((Path(tmp) / 'voco/stream-performance').glob('worker.jsonl*'))
            self.assertGreater(len(logs), 1)
            self.assertLessEqual(len(logs), 4)
            self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in logs))

    def test_full_queue_close_finishes_after_slow_disk_recovers(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'XDG_STATE_HOME': tmp, 'VOCO_PERFORMANCE_LOG': '1'}):
            metrics = Metrics()
            entered, release = threading.Event(), threading.Event()
            original = metrics.handler.emit
            def blocked(record):
                entered.set()
                release.wait(5)
                original(record)
            metrics.handler.emit = blocked
            try:
                metrics.emit('first')
                self.assertTrue(entered.wait(1))
                for _ in range(metrics.queue.maxsize):
                    metrics.emit('queued')
                self.assertTrue(metrics.queue.full())
                metrics.close()
                self.assertTrue(metrics.writer.is_alive())
            finally:
                release.set()
                metrics.writer.join(2)
            self.assertFalse(metrics.writer.is_alive())
            records = [json.loads(line) for line in (Path(tmp) / 'voco/stream-performance/worker.jsonl').read_text().splitlines()]
            self.assertEqual(records[-1]['event'], 'metrics_closed')
            self.assertEqual(len(records), 258)

    def test_empty_queue_close_wakes_blocking_writer_without_polling(self):
        with tempfile.TemporaryDirectory() as tmp, patch.dict(os.environ, {'XDG_STATE_HOME': tmp, 'VOCO_PERFORMANCE_LOG': '1'}):
            metrics = Metrics()
            self.assertTrue(metrics.queue.empty())
            metrics.close()
            self.assertFalse(metrics.writer.is_alive())
            records = [json.loads(line) for line in (Path(tmp) / 'voco/stream-performance/worker.jsonl').read_text().splitlines()]
            self.assertEqual([row['event'] for row in records], ['metrics_closed'])

    def test_slow_metrics_disk_never_blocks_producer_and_reports_drops(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'XDG_STATE_HOME':tmp,'VOCO_PERFORMANCE_LOG':'1'}):
            metrics=Metrics();entered=threading.Event();release=threading.Event()
            original=metrics.handler.emit
            def blocked(record):
                entered.set();release.wait(3);original(record)
            metrics.handler.emit=blocked
            metrics.emit('first');self.assertTrue(entered.wait(1))
            before=time.monotonic()
            for i in range(300):metrics.emit('queued',counter=i)
            elapsed=time.monotonic()-before
            self.assertLess(elapsed,1);self.assertGreater(metrics.dropped,0)
            release.set();metrics.close();self.assertFalse(metrics.writer.is_alive())
            records=[json.loads(x) for x in (Path(tmp)/'voco/stream-performance/worker.jsonl').read_text().splitlines()]
            self.assertEqual(records[-1]['event'],'metrics_closed');self.assertEqual(records[-1]['dropped_events'],metrics.dropped)

    def test_disk_failure_disables_only_metrics(self):
        with tempfile.TemporaryDirectory() as tmp,patch.dict(os.environ,{'XDG_STATE_HOME':tmp,'VOCO_PERFORMANCE_LOG':'1'}):
            metrics=Metrics()
            metrics.handler.emit=lambda record: (_ for _ in ()).throw(OSError('private path'))
            with patch('sys.stderr',new_callable=io.StringIO) as stderr:
                metrics.emit('probe');metrics.writer.join(1);metrics.emit('still-safe');metrics.close()
                self.assertFalse(metrics.enabled);self.assertNotIn('private path',stderr.getvalue())

if __name__=='__main__': unittest.main()
