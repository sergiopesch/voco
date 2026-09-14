import unittest
from unittest.mock import patch
import tempfile
import os
import json
from pathlib import Path
import numpy as np
from streaming import SilenceGate, Metrics
class GateTests(unittest.TestCase):
    def test_logging_disabled_creates_no_directory(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'VOCO_PERFORMANCE_LOG':'0','XDG_STATE_HOME':directory}):
            metrics=Metrics();metrics.emit('ignored')
            self.assertFalse(list(Path(directory).iterdir()))
    def test_unavailable_log_storage_does_not_prevent_worker_initialization(self):
        with tempfile.TemporaryDirectory() as directory:
            blocked=Path(directory)/'not-a-directory';blocked.write_text('fixture')
            with patch.dict(os.environ, {'VOCO_PERFORMANCE_LOG':'1','XDG_STATE_HOME':str(blocked)}):
                metrics=Metrics();metrics.emit('ignored')
                self.assertFalse(metrics.enabled)
    def test_rotated_logs_remain_private(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {'VOCO_PERFORMANCE_LOG':'1','XDG_STATE_HOME':directory}):
            metrics=Metrics();handler=metrics.logger.handlers[0];handler.maxBytes=200;handler.backupCount=2
            for _ in range(6):metrics.emit('rotation')
            metrics.close()
            files=list((Path(directory)/'voco/stream-performance').iterdir())
            self.assertEqual(len(files),3)
            self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in files))
    def test_zero_gate_does_not_discard_nonzero_quiet_speech(self):
        gate=SilenceGate();speech=np.full(800,1e-7,np.float32)
        self.assertEqual(sum(map(len,gate.push(speech,16000))),800)
        self.assertEqual(gate.skipped_s,0)
    def test_resume_retains_preroll_and_accounts_for_all_samples(self):
        gate=SilenceGate();received=0;processed=[]
        for _ in range(100):
            data=np.zeros(800,np.float32);received+=len(data);processed.extend(gate.push(data,16000))
        voice=np.linspace(-.2,.2,800,dtype=np.float32);received+=len(voice);frames=gate.push(voice,16000);processed.extend(frames)
        self.assertTrue(np.array_equal(frames[-1],voice));self.assertEqual(sum(map(len,frames[:-1])),10240)
        processed.extend(gate.finish(16000));self.assertAlmostEqual(sum(map(len,processed))/16000+gate.skipped_s,received/16000)
    def test_tail_and_restart_accounting(self):
        gate=SilenceGate();data=np.ones(800,np.float32)
        gate.push(data,16000)
        for _ in range(200):gate.push(np.zeros(800,np.float32),16000)
        gate.finish(16000)
        self.assertAlmostEqual(gate.processed_s+gate.skipped_s,10.05)
        self.assertGreater(gate.processed_s,1.5);self.assertLess(gate.processed_s,2.5)
    def test_log_has_resource_values_and_no_content(self):
        with tempfile.TemporaryDirectory() as directory:
            os.environ['VOCO_PERFORMANCE_LOG']='1';prior=os.environ.get('XDG_STATE_HOME');os.environ['XDG_STATE_HOME']=directory
            metrics=Metrics();metrics.emit('check',audio_s=1.,asr_ms=20.);metrics.close()
            row=json.loads((Path(directory)/'voco/stream-performance/worker.jsonl').read_text().splitlines()[0])
            self.assertGreater(row['rss_bytes'],0);self.assertIn('cpu_user_s',row)
            self.assertFalse({'audio','text','transcript','app_name'} & row.keys())
            for handler in metrics.logger.handlers:handler.close()
            if prior is None:del os.environ['XDG_STATE_HOME']
            else:os.environ['XDG_STATE_HOME']=prior
if __name__=='__main__':unittest.main()
