#!/usr/bin/env python3
"""Privacy, completeness and correlation regressions for metadata-only reports."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import stat
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('report-dictation-quality-events.py')
spec = importlib.util.spec_from_file_location('quality_events', SCRIPT)
reporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reporter)


def lengths(prefix, count=5):
    return {f'{prefix}_{unit}': count for unit in ('utf8_bytes', 'unicode_scalars', 'utf16_units')}


def fixture():
    def quality(stage, **fields):
        return dict(event='speech_quality', stage=stage, stream_session_hash='a' * 64, **fields)
    rows = [dict(event='run_metadata'),
            quality('hypothesis', quality_seq=0, quality_dropped=0, hypothesis_seq=1, previous_hypothesis_seq=0,
                    changed=True, append_only=True, **lengths('recognized')),
            quality('delivery_requested', quality_seq=1, quality_dropped=0, delivery_seq=1, hypothesis_seq=1, **lengths('suffix'), **lengths('target'), **lengths('committed', 0)),
            quality('native_dispatch', delivery_seq=1, hypothesis_seq=1, outcome='dispatched',
                    routed_utf8_bytes=5, leading_separator=False, **lengths('input'), **lengths('payload')),
            quality('delivery_dispatched', quality_seq=2, quality_dropped=0, delivery_seq=1, hypothesis_seq=1, **lengths('committed')),
            quality('hypothesis', quality_seq=3, quality_dropped=0, hypothesis_seq=2, previous_hypothesis_seq=1,
                    changed=False, append_only=True, **lengths('recognized')),
            quality('terminal', quality_seq=4, quality_dropped=0, hypothesis_seq=2, hypothesis_count=1,
                    delivery_count=1, dispatched_count=1, pending_delivery_count=0, outcome='finished', finish_responded=True,
                    captured_samples=320, enqueued_samples=320, responded_samples=320, buffered_samples=0,
                    accepted_equals_dispatched=True, **lengths('accepted'), **lengths('dispatched'))]
    return [dict(schema=1, run_id='123456-789', seq=i, t_us=i * 1000, dropped_events=0, **row) for i, row in enumerate(rows, 1)]


class QualityEventsTest(unittest.TestCase):
    def run_report(self, rows, suffix=b''):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'events.jsonl'
            path.write_bytes(b''.join(json.dumps(row).encode() + b'\n' for row in rows) + suffix)
            return reporter.summarize([path])

    def test_complete_metadata_never_certifies_destination(self):
        report = self.run_report(fixture())
        self.assertEqual(report['status'], 'reconciled_dispatch_metadata')
        self.assertEqual(report['destination_content_observation'], 'unavailable')
        self.assertEqual(report['runs'][0]['streams'][0]['reasons'], [])

    def test_finished_empty_stream_reconciles_without_inventing_hypotheses(self):
        rows = fixture()
        terminal = rows[-1]
        terminal.update(seq=2, quality_seq=0, hypothesis_seq=0, hypothesis_count=0,
                        delivery_count=0, dispatched_count=0, **lengths('accepted', 0), **lengths('dispatched', 0))
        self.assertEqual(self.run_report([rows[0], terminal])['status'], 'reconciled_dispatch_metadata')

    def test_absent_quality_stays_unavailable(self):
        self.assertEqual(self.run_report(fixture()[:1])['status'], 'unavailable')
        self.assertEqual(self.run_report([])['status'], 'unavailable')

    def test_native_dispatch_missing_is_incomplete_even_with_terminal_equality(self):
        rows = fixture()
        del rows[3]
        result = self.run_report(rows)
        self.assertEqual(result['status'], 'incomplete')
        self.assertIn('delivery_correlation_incomplete', result['runs'][0]['streams'][0]['reasons'])

    def test_faults_never_produce_reconciled_status(self):
        for mode in ('duplicate', 'rotation', 'dropped', 'frontend_dropped', 'bad_hypothesis', 'failed', 'pending', 'samples', 'payload', 'missing_terminal', 'missing_units', 'missing_recognized_length', 'wrong_target_length'):
            with self.subTest(mode=mode):
                rows = fixture()
                if mode == 'duplicate': rows.insert(3, copy.deepcopy(rows[3]))
                if mode == 'rotation': rows = rows[1:]
                if mode == 'dropped': rows[-1]['dropped_events'] = 1
                if mode == 'frontend_dropped': rows[-1]['quality_dropped'] = 1
                if mode == 'bad_hypothesis': rows[3]['hypothesis_seq'] = 99
                if mode == 'failed': rows[-1]['outcome'] = 'failed'
                if mode == 'pending': rows[-1]['pending_delivery_count'] = 1
                if mode == 'samples': rows[-1]['responded_samples'] = 319
                if mode == 'payload': rows[3]['payload_utf8_bytes'] = 4
                if mode == 'missing_terminal': rows.pop()
                if mode == 'missing_units': del rows[-1]['dispatched_unicode_scalars']
                if mode == 'missing_recognized_length': del rows[1]['recognized_utf8_bytes']
                if mode == 'wrong_target_length': rows[2]['target_utf8_bytes'] = 6
                self.assertEqual(self.run_report(rows)['status'], 'incomplete')

    def test_malformed_truncated_or_oversized_lines_are_explicit(self):
        for suffix in (b'not json\n', b'{}', b'x' * (reporter.MAX_LINE_BYTES + 1) + b'\n'):
            result = self.run_report(fixture(), suffix)
            self.assertEqual(result['malformed_records'], 1)
            self.assertEqual(result['status'], 'incomplete')

    def test_coherently_changed_payload_and_route_cannot_hide_input_loss(self):
        rows = fixture()
        rows[3].update(routed_utf8_bytes=4, payload_utf8_bytes=4)
        result = self.run_report(rows)
        self.assertEqual(result['status'], 'incomplete')
        self.assertIn('routed_input_length_mismatch_or_unavailable', result['runs'][0]['streams'][0]['reasons'])

    def test_explicit_context_separator_is_a_traceable_transformation(self):
        rows = fixture()
        rows[3].update(context_separator=True, leading_separator=True, routed_utf8_bytes=6)
        self.assertEqual(self.run_report(rows)['status'], 'reconciled_dispatch_metadata')
        del rows[3]['context_separator']
        self.assertEqual(self.run_report(rows)['status'], 'incomplete')

    def test_recorder_rotation_order_can_be_reconstructed_without_deduplicating_silently(self):
        rows = fixture()
        self.assertEqual(self.run_report(rows[4:] + rows[:4])['status'], 'reconciled_dispatch_metadata')

    def test_unknown_content_is_never_reflected_in_report(self):
        rows = fixture()
        for row in rows:
            row.update(text='PRIVATE_SENTINEL', audio='PRIVATE_SENTINEL', path='/PRIVATE_SENTINEL', title='PRIVATE_SENTINEL', clipboard_hash='PRIVATE_SENTINEL')
        rows[3]['destination_content_observation'] = 'verified'
        result = self.run_report(rows)
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))
        self.assertEqual(result['destination_content_observation'], 'unavailable')
        rows[-1]['outcome'] = 'PRIVATE_SENTINEL'
        result = self.run_report(rows)
        self.assertEqual(result['status'], 'incomplete')
        self.assertNotIn('PRIVATE_SENTINEL', json.dumps(result))

    def test_boolean_or_missing_numeric_identity_is_not_valid_evidence(self):
        rows = fixture()
        rows[2]['delivery_seq'] = True
        self.assertEqual(self.run_report(rows)['status'], 'incomplete')
        rows = fixture()
        del rows[-1]['quality_dropped']
        self.assertEqual(self.run_report(rows)['status'], 'incomplete')

    def test_record_limit_is_explicit(self):
        before = reporter.MAX_RECORDS
        try:
            reporter.MAX_RECORDS = 3
            result = self.run_report(fixture())
            self.assertTrue(result['input_truncated'])
            self.assertEqual(result['status'], 'incomplete')
        finally:
            reporter.MAX_RECORDS = before

    def test_cli_creates_private_metadata_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, destination = Path(tmp) / 'events', Path(tmp) / 'report'
            source.write_text(''.join(json.dumps(row) + '\n' for row in fixture()))
            result = subprocess.run([sys.executable, str(SCRIPT), str(source), '--output', str(destination)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertEqual(stat.S_IMODE(destination.stat().st_mode), 0o600)
            self.assertEqual(json.loads(destination.read_text())['status'], 'reconciled_dispatch_metadata')

    def test_cli_refuses_to_overwrite_existing_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            source, destination = Path(tmp) / 'events', Path(tmp) / 'report'
            source.write_text(''.join(json.dumps(row) + '\n' for row in fixture()))
            destination.write_text('retained receipt')
            result = subprocess.run([sys.executable, str(SCRIPT), str(source), '--output', str(destination)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 2)
            self.assertEqual(destination.read_text(), 'retained receipt')


if __name__ == '__main__':
    unittest.main()
