import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('report', Path(__file__).with_name('report-performance.py'))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class PerformanceReportTests(unittest.TestCase):
    def row(self, seq, event, **fields):
        return dict(schema=1, seq=seq, t_us=seq * 1000, run_id='run', event=event, **fields)

    def session_rows(self, names):
        rows = [self.row(1, 'run_metadata')]
        for i, (name, duration) in enumerate(names, 2):
            fields = {'name': name, 'dictation_session_id': 1}
            if duration is not None: fields['duration_ms'] = duration
            rows.append(self.row(i, 'lifecycle', **fields))
        return rows

    def test_prefix_revisions_do_not_imply_visible_output(self):
        rows = self.session_rows([('recording_state_requested', None), ('dictation_desktop_snapshot_revised', None),
                                  ('dictation_desktop_snapshot_revised', None)])
        delivery = report.summarize(rows)['recordings'][0]['delivery_observations']
        self.assertEqual(delivery['desktop_prefix_revisions'], 2)
        self.assertEqual(delivery['desktop_paste_dispatch_count'], 0)

    def test_progressive_dispatch_is_not_claimed_as_visible_text(self):
        rows = self.session_rows([('recording_state_requested', None), ('dictation_desktop_stream_started', None),
                                  ('dictation_desktop_phrase_queued', 2000), ('dictation_desktop_paste_dispatched', 300),
                                  ('dictation_desktop_first_phrase_dispatched', 2900), ('dictation_desktop_paste_dispatched', 320),
                                  ('dictation_desktop_stream_flush_completed', 1200), ('dictation_desktop_stream_failed', None),
                                  ('dictation_desktop_paste_deferred', None), ('dictation_desktop_modifier_wait_completed', 12),
                                  ('dictation_desktop_keyboard_dispatch_completed', 350), ('dictation_desktop_remainder_copied', None)])
        result = report.summarize(rows)
        session = result['recordings'][0]
        self.assertEqual(session['first_desktop_phrase_dispatch_ms'], 2900)
        self.assertEqual(session['paste_dispatch_ms']['count'], 2)
        self.assertEqual(session['paste_stages_ms']['keyboard_dispatch']['p50'], 350)
        self.assertEqual(session['paste_stages_ms']['modifier_wait']['p50'], 12)
        self.assertEqual(session['delivery_observations']['desktop_paste_deferred_count'], 1)
        self.assertEqual(session['delivery_observations']['desktop_paste_dispatch_count'], 2)
        self.assertTrue(session['delivery_observations']['desktop_stream_failed'])
        self.assertTrue(session['delivery_observations']['desktop_remainder_copied'])
        self.assertIn('desktop_paste_failure_requires_review', result['review_flags'])

    def test_unavailable_paste_is_flagged_before_any_dispatch(self):
        rows = self.session_rows([('recording_state_requested', None), ('dictation_desktop_paste_unavailable', None)])
        result = report.summarize(rows)
        self.assertIn('desktop_paste_failure_requires_review', result['review_flags'])
        delivery = result['recordings'][0]['delivery_observations']
        self.assertTrue(delivery['desktop_paste_unavailable'])
        self.assertFalse(delivery['desktop_paste_dispatched'])

    def test_remainder_kept_in_review_remains_visible_after_partial_delivery(self):
        rows = self.session_rows([(name, None) for name in (
            'recording_state_requested', 'dictation_desktop_paste_session_started', 'dictation_desktop_paste_dispatched',
            'dictation_desktop_stream_failed', 'dictation_desktop_remainder_kept', 'dictation_recovery_retained')])
        result = report.summarize(rows)
        self.assertIn('desktop_paste_failure_requires_review', result['review_flags'])
        delivery = result['recordings'][0]['delivery_observations']
        self.assertTrue(delivery['desktop_remainder_kept_in_review'])
        self.assertTrue(delivery['recovery_retained'])
        self.assertFalse(delivery['desktop_remainder_copied'])

    def test_unavailable_is_not_zero_and_incomplete_is_not_success(self):
        result = report.summarize([self.row(8, 'lifecycle', name='recording_state_active')])
        self.assertTrue(result['evidence']['prefix_missing'])
        self.assertIn('incomplete_or_invalid_log_evidence', result['review_flags'])
        self.assertIsNone(result['backend_resources']['peak_rss_mib'])
        self.assertEqual(result['backend_resources']['cpu_percent_one_core_100']['count'], 0)

    def test_multicore_cpu_and_rss_units(self):
        rows = [self.row(1, 'run_metadata'),
                self.row(2, 'resource_sample', available=True, cpu_us=0, peak_rss_kib=1024),
                self.row(3, 'resource_sample', available=True, cpu_us=2500, peak_rss_kib=2048)]
        result = report.summarize(rows)
        self.assertEqual(result['backend_resources']['cpu_percent_one_core_100']['p50'], 250)
        self.assertEqual(result['backend_resources']['peak_rss_mib'], 2)

    def test_run_and_frontend_reload_do_not_merge_session_ids(self):
        rows = [dict(self.row(1, 'run_metadata'), run_id='old'), self.row(1, 'run_metadata'),
                self.row(2, 'lifecycle', name='recording_state_requested', dictation_session_id=1),
                self.row(3, 'lifecycle', name='frontend_app_mounted'),
                self.row(4, 'lifecycle', name='recording_state_active', dictation_session_id=1)]
        self.assertEqual(report.summarize(rows)['recording_request_to_active_backend_observed_ms']['count'], 0)
        self.assertEqual(report.summarize(rows, 'old')['evidence']['records'], 1)

    def test_audio_duration_is_not_teardown_latency(self):
        rows = [self.row(1, 'run_metadata'),
                self.row(2, 'lifecycle', name='dictation_recording_stopped', dictation_session_id=1),
                self.row(3, 'lifecycle', name='dictation_audio_teardown_completed', dictation_session_id=1, duration_ms=30000)]
        result = report.summarize(rows)
        self.assertEqual(result['stop_to_teardown_backend_observed_ms']['p50'], 1)
        self.assertEqual(result['audio_duration_ms']['dictation_audio_teardown_completed']['p50'], 30000)
        self.assertNotIn('dictation_audio_teardown_completed', result['lifecycle_duration_ms'])

    def test_dropped_and_sequence_gaps_remain_visible(self):
        result = report.summarize([self.row(1, 'run_metadata'), self.row(4, 'clean_exit_requested', dropped_events=3)], malformed=1)
        self.assertEqual(result['evidence']['sequence_gaps'], 2)
        self.assertEqual(result['evidence']['dropped_events'], 3)
        self.assertEqual(result['evidence']['malformed_lines'], 1)

    def test_bad_payloads_are_counted_without_breaking_valid_records(self):
        import tempfile
        import json
        bad = [self.row(2, 'lifecycle'),
               self.row(3, 'resource_sample', available=True, cpu_us='secret', peak_rss_kib=1),
               self.row(4, 'lifecycle', name='x', duration_ms=True),
               self.row(5, 'lifecycle', name='x', duration_ms=float('nan')),
               self.row(6, 'lifecycle', name='x', duration_ms=10**1000)]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'performance.jsonl'
            path.write_text('\n'.join(json.dumps(e) for e in [self.row(1, 'run_metadata'), *bad]))
            entries, malformed = report.read_entries([path])
        result = report.summarize(entries, malformed=malformed)
        self.assertEqual(result['evidence']['malformed_lines'], 5)
        self.assertIn('incomplete_or_invalid_log_evidence', result['review_flags'])
        self.assertEqual(result['lifecycle_counts'], {})

    def test_recordings_do_not_pool_long_short_or_reload_and_missing_timing_is_null(self):
        rows = [self.row(1, 'run_metadata')]
        for session, duration in [(1, 40000), (2, 3000)]:
            rows += [self.row(len(rows)+1, 'lifecycle', name='recording_state_requested', dictation_session_id=session),
                     self.row(len(rows)+2, 'lifecycle', name='dictation_recording_duration', dictation_session_id=session, duration_ms=duration)]
        rows += [self.row(6, 'lifecycle', name='frontend_app_mounted'),
                 self.row(7, 'lifecycle', name='recording_state_requested', dictation_session_id=1),
                 self.row(8, 'lifecycle', name='dictation_stop_to_idle', dictation_session_id=1, duration_ms=0)]
        result = report.summarize(rows)['recordings']
        self.assertEqual([(r['frontend_epoch'], r['session_id']) for r in result], [(0, 1), (0, 2), (1, 1)])
        self.assertEqual([r['recording_ms'] for r in result], [40000, 3000, None])
        self.assertIsNone(result[0]['stop_to_idle_ms'])
        self.assertEqual(result[-1]['stop_to_idle_ms'], 0)

    def test_duplicate_records_are_not_double_counted(self):
        entry = self.row(2, 'lifecycle', name='recording_state_active')
        result = report.summarize([self.row(1, 'run_metadata'), entry, entry])
        self.assertEqual(result['lifecycle_counts']['recording_state_active'], 1)
        self.assertEqual(result['evidence']['duplicate_records_ignored'], 1)
        self.assertIn('incomplete_or_invalid_log_evidence', result['review_flags'])

    def test_absent_delivery_events_do_not_invent_failure(self):
        rows = [self.row(1, 'run_metadata'), self.row(2, 'lifecycle',
                name='recording_state_active', dictation_session_id=1)]
        result = report.summarize(rows)
        self.assertEqual(result['review_flags'], [])
        self.assertFalse(result['recordings'][0]['delivery_observations']['desktop_stream_failed'])

    def test_desktop_paste_dispatch_is_not_a_verified_editor_receipt(self):
        rows = self.session_rows([(name, None) for name in (
            'recording_state_requested', 'recording_state_active',
            'dictation_desktop_paste_session_started', 'dictation_desktop_paste_dispatched')])
        result = report.summarize(rows)
        self.assertIn('desktop_paste_dispatch_needs_target_verification', result['review_flags'])
        self.assertNotIn('desktop_paste_failure_requires_review', result['review_flags'])
        self.assertTrue(result['recordings'][0]['delivery_observations']['desktop_paste_dispatched'])

    def test_cpu_coverage_and_writer_backlog_have_explicit_units(self):
        rows = [self.row(1, 'run_metadata'),
                self.row(2, 'resource_sample', available=True, cpu_us=1000000, peak_rss_kib=1, major_page_faults=3),
                self.row(3, 'resource_sample', available=False),
                self.row(4, 'resource_sample', available=True, cpu_us=2000000, peak_rss_kib=1, major_page_faults=5),
                self.row(5, 'lifecycle', name='recording_state_active', writer_observed_us=8000)]
        result = report.summarize(rows)
        self.assertEqual(result['backend_resources']['cpu_seconds_at_last_sample'], 2)
        self.assertEqual(result['backend_resources']['observed_span_ms'], 2)
        self.assertEqual(result['backend_resources']['unavailable_samples'], 1)
        self.assertEqual(result['backend_resources']['counter_deltas_between_samples']['major_page_faults'], 2)
        self.assertIsNone(result['backend_resources']['counter_deltas_between_samples']['voluntary_context_switches'])
        self.assertEqual(result['writer_queue_delay_ms']['p50'], 3)


if __name__ == '__main__':
    unittest.main()
