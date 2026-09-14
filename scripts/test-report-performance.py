import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('report', Path(__file__).with_name('report-performance.py'))
report = importlib.util.module_from_spec(spec)
spec.loader.exec_module(report)


class PerformanceReportTests(unittest.TestCase):
    def row(self, seq, event, **fields):
        return dict(schema=1, seq=seq, t_us=seq * 1000, run_id='run', event=event, **fields)

    def test_streaming_wait_reasons_and_roles_do_not_imply_visible_output(self):
        events = [('recording_state_requested', None), ('dictation_desktop_preview_transcribed', 230), ('dictation_desktop_phrase_transcribed', 1800),
                  ('dictation_desktop_snapshot_preview_wait', 42), ('dictation_desktop_snapshot_final_wait', 75),
                  ('dictation_desktop_snapshot_waiting_agreement', None), ('dictation_desktop_snapshot_coalesced', None),
                  ('dictation_desktop_snapshot_revised', None)]
        rows = [self.row(1, 'run_metadata')]
        for i, (name, duration) in enumerate(events, 2):
            fields = dict(name=name, dictation_session_id=1)
            if duration is not None: fields['duration_ms'] = duration
            rows.append(self.row(i, 'lifecycle', **fields))
        session = report.summarize(rows)['recordings'][0]
        self.assertEqual(session['desktop_recognition_ms']['preview']['p50'], 230)
        self.assertEqual(session['desktop_recognition_ms']['final']['p50'], 1800)
        self.assertEqual(session['desktop_queue_wait_ms']['final']['p50'], 75)
        self.assertEqual(session['desktop_snapshot_observations']['waiting_agreement'], 1)
        self.assertEqual(session['desktop_snapshot_observations']['revised'], 1)
        self.assertIsNone(session['first_text_ms'])
        self.assertEqual(session['delivery_observations']['desktop_paste_dispatch_count'], 0)

    def test_preview_budget_expiration_is_visible_without_claiming_native_failure(self):
        rows = [self.row(1, 'run_metadata'), self.row(2, 'request_started', request_id=1, mode='preview'),
                self.row(3, 'request_completed', request_id=1, mode='preview', outcome='skipped_budget',
                         last_stage='recognition', total_us=600100, audio_samples=32000, stages_us={'recognition':600100})]
        result = report.summarize(rows)
        self.assertEqual(result['native_requests']['preview']['outcomes']['skipped_budget'], 1)
        self.assertIn('desktop_preview_budget_exhausted', result['review_flags'])
        self.assertNotIn('native_request_errors_require_review', result['review_flags'])
        self.assertFalse(result['evidence']['requests_without_completion'])

    def test_progressive_dispatch_is_not_claimed_as_visible_text(self):
        names = [('recording_state_requested', None), ('dictation_desktop_stream_started', None),
                 ('dictation_desktop_phrase_queued', 2000), ('dictation_desktop_paste_dispatched', 300),
                 ('dictation_desktop_first_phrase_dispatched', 2900), ('dictation_desktop_paste_dispatched', 320),
                 ('dictation_desktop_stream_flush_completed', 1200), ('dictation_desktop_stream_failed', None),
                 ('dictation_desktop_terminal_route_dispatched', None), ('dictation_desktop_keyboard_dispatch_completed', 350)]
        rows = [self.row(1, 'run_metadata')]
        for i, (name, duration) in enumerate(names, 2):
            fields = {'name': name, 'dictation_session_id': 1}
            if duration is not None: fields['duration_ms'] = duration
            rows.append(self.row(i, 'lifecycle', **fields))
        result = report.summarize(rows)
        session = result['recordings'][0]
        self.assertIsNone(session['first_text_ms'])
        self.assertEqual(session['first_desktop_phrase_dispatch_ms'], 2900)
        self.assertEqual(session['paste_dispatch_ms']['count'], 2)
        self.assertEqual(session['paste_stages_ms']['keyboard_dispatch']['p50'], 350)
        self.assertEqual(session['delivery_observations']['terminal_paste_dispatch_count'], 1)
        self.assertEqual(session['delivery_observations']['desktop_paste_dispatch_count'], 2)
        self.assertTrue(session['delivery_observations']['desktop_stream_failed'])
        self.assertIn('desktop_paste_failure_requires_review', result['review_flags'])

    def test_live_snapshot_work_and_limit_remain_distinct_from_editor_receipts(self):
        names = ['recording_state_requested', 'dictation_desktop_snapshot_requested',
                 'dictation_desktop_snapshot_recognized', 'dictation_desktop_live_prefix_dispatched',
                 'dictation_desktop_snapshot_failed', 'dictation_desktop_snapshot_limit_reached']
        rows = [self.row(1, 'run_metadata')] + [self.row(i, 'lifecycle', name=name, dictation_session_id=1) for i, name in enumerate(names, 2)]
        result = report.summarize(rows)
        delivery = result['recordings'][0]['delivery_observations']
        self.assertEqual(delivery['desktop_snapshots_requested'], 1)
        self.assertEqual(delivery['desktop_snapshots_recognized'], 1)
        self.assertEqual(delivery['desktop_live_prefix_dispatch_count'], 1)
        self.assertEqual(delivery['desktop_snapshot_failures'], 1)
        self.assertTrue(delivery['desktop_snapshot_limit_reached'])
        self.assertIsNone(result['recordings'][0]['first_text_ms'])
        self.assertIn('desktop_live_updates_waiting_for_phrase_boundary', result['review_flags'])
        self.assertIn('desktop_speculative_recognition_failed', result['review_flags'])

    def test_unavailable_is_not_zero_and_incomplete_is_not_success(self):
        result = report.summarize([self.row(8, 'request_started', request_id=7, mode='final')])
        self.assertTrue(result['evidence']['prefix_missing'])
        self.assertEqual(result['evidence']['requests_without_completion'], [7])
        self.assertIsNone(result['backend_resources']['peak_rss_mib'])
        self.assertEqual(result['backend_resources']['cpu_percent_one_core_100']['count'], 0)

    def test_stage_units_rtf_and_multicore_cpu(self):
        rows = [self.row(1, 'run_metadata'), self.row(2, 'request_started', request_id=1, mode='final'),
                self.row(3, 'request_completed', request_id=1, mode='final', outcome='ok', last_stage='recognition',
                         stages_us={'recognition': 250000}, total_us=300000, audio_samples=16000),
                self.row(4, 'resource_sample', available=True, cpu_us=0, peak_rss_kib=1024),
                self.row(5, 'resource_sample', available=True, cpu_us=2500, peak_rss_kib=2048)]
        result = report.summarize(rows)
        self.assertEqual(result['native_requests']['final']['recognition_real_time_factor']['p50'], .25)
        self.assertEqual(result['native_requests']['final']['stages_ms']['recognition']['p50'], 250)
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
        bad = [self.row(2, 'request_completed', request_id=1, mode='preview'),
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
        self.assertEqual(result['native_requests'], {})

    def test_fallback_zero_time_is_observed_and_old_fields_are_unavailable(self):
        base = dict(request_id=1, mode='preview', outcome='ok', last_stage='recognition',
                    total_us=100, stages_us={'recognition': 90}, audio_samples=16000)
        rows = [self.row(1, 'run_metadata'), self.row(2, 'request_started', request_id=1, mode='preview'),
                self.row(3, 'request_completed', **base)]
        self.assertIsNone(report.summarize(rows)['native_requests']['preview']['preview_context']['fallback_count'])
        rows[-1]['preview_diagnostics'] = dict(initial_context_frames=512, reduced_attempt_us=50, fallback_us=0)
        data = report.summarize(rows)['native_requests']['preview']
        self.assertEqual(data['preview_context']['fallback_count'], 1)
        self.assertEqual(data['preview_context']['fallback_ms']['p50'], 0)
        self.assertEqual(data['by_outcome']['ok']['total_ms']['p50'], .1)

    def test_recordings_do_not_pool_long_short_or_reload_and_missing_wait_is_null(self):
        rows = [self.row(1, 'run_metadata')]
        for session, duration in [(1, 40000), (2, 3000)]:
            rows += [self.row(len(rows)+1, 'lifecycle', name='recording_state_requested', dictation_session_id=session),
                     self.row(len(rows)+2, 'lifecycle', name='dictation_recording_duration', dictation_session_id=session, duration_ms=duration)]
        rows += [self.row(6, 'lifecycle', name='frontend_app_mounted'),
                 self.row(7, 'lifecycle', name='recording_state_requested', dictation_session_id=1),
                 self.row(8, 'lifecycle', name='dictation_stop_preview_wait_completed', dictation_session_id=1, duration_ms=0)]
        result = report.summarize(rows)['recordings']
        self.assertEqual([(r['frontend_epoch'], r['session_id']) for r in result], [(0, 1), (0, 2), (1, 1)])
        self.assertEqual([r['recording_ms'] for r in result], [40000, 3000, None])
        self.assertIsNone(result[0]['stop_wait_ms']['preview'])
        self.assertEqual(result[-1]['stop_wait_ms']['preview'], 0)

    def test_preview_failure_is_flagged_even_if_final_succeeds(self):
        rows = [self.row(1, 'run_metadata'), self.row(2, 'lifecycle', name='dictation_live_preview_failed'),
                self.row(3, 'lifecycle', name='dictation_final_output_completed')]
        self.assertIn('live_preview_failure_requires_review', report.summarize(rows)['review_flags'])

    def test_duplicate_records_are_not_double_counted(self):
        entry = self.row(2, 'lifecycle', name='recording_state_active')
        result = report.summarize([self.row(1, 'run_metadata'), entry, entry])
        self.assertEqual(result['lifecycle_counts']['recording_state_active'], 1)
        self.assertEqual(result['evidence']['duplicate_records_ignored'], 1)
        self.assertIn('incomplete_or_invalid_log_evidence', result['review_flags'])

    def test_transcription_success_does_not_hide_missing_cursor_delivery(self):
        rows = [self.row(1, 'run_metadata')]
        for name in ['recording_state_requested', 'recording_state_active',
                     'dictation_owned_preedit_unavailable', 'dictation_transcription_completed',
                     'dictation_manual_transcript_ready']:
            rows.append(self.row(len(rows) + 1, 'lifecycle', name=name, dictation_session_id=1))
        result = report.summarize(rows)
        self.assertIn('cursor_delivery_unavailable_requires_review', result['review_flags'])
        self.assertIn('manual_copy_ready_requires_review', result['review_flags'])
        delivery = result['recordings'][0]['delivery_observations']
        self.assertTrue(delivery['cursor_unavailable'])
        self.assertTrue(delivery['manual_copy_ready'])
        self.assertFalse(delivery['final_output_completed'])
        self.assertEqual(delivery['checkpoint_commit_events'], 0)

    def test_partial_delivery_remains_visible_after_focus_loss(self):
        rows = [self.row(1, 'run_metadata')]
        for name in ['recording_state_requested', 'dictation_owned_preedit_started',
                     'dictation_canonical_checkpoint_committed', 'dictation_owned_preedit_failed',
                     'dictation_recovery_retained']:
            rows.append(self.row(len(rows) + 1, 'lifecycle', name=name, dictation_session_id=1))
        result = report.summarize(rows)
        self.assertIn('cursor_delivery_failure_requires_review', result['review_flags'])
        delivery = result['recordings'][0]['delivery_observations']
        self.assertEqual(delivery['checkpoint_commit_events'], 1)
        self.assertTrue(delivery['cursor_session_started'])
        self.assertTrue(delivery['recovery_retained'])
        self.assertFalse(delivery['final_output_completed'])

    def test_absent_delivery_events_do_not_invent_failure(self):
        rows = [self.row(1, 'run_metadata'), self.row(2, 'lifecycle',
                name='recording_state_active', dictation_session_id=1)]
        result = report.summarize(rows)
        self.assertEqual(result['review_flags'], [])
        self.assertFalse(result['recordings'][0]['delivery_observations']['cursor_failure'])

    def test_desktop_paste_dispatch_is_not_a_verified_editor_receipt(self):
        rows = [self.row(1, 'run_metadata')]
        for name in ['recording_state_requested', 'recording_state_active',
                     'dictation_desktop_paste_session_started', 'dictation_desktop_paste_dispatched']:
            rows.append(self.row(len(rows) + 1, 'lifecycle', name=name, dictation_session_id=1))
        result = report.summarize(rows)
        self.assertIn('desktop_paste_dispatch_needs_target_verification', result['review_flags'])
        delivery = result['recordings'][0]['delivery_observations']
        self.assertTrue(delivery['desktop_paste_dispatched'])
        self.assertFalse(delivery['final_output_completed'])
        self.assertFalse(delivery['cursor_session_started'])

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


class DestinationReportTests(unittest.TestCase):
    def row(self,**changes):
        return dict(schema=1,seq=1,t_us=1000,run_id='run',event='destination_check',
            **({'scope':'window','stage':'paste','outcome':'matched','events_tracked':False,'duration_ms':3}|changes))
    def test_window_match_is_not_promoted_to_control_verification(self):
        result=report.summarize([report.validate_entry(self.row())])['destination_verification']
        self.assertEqual(result['paste']['scopes'],{'window':1})
        self.assertEqual(result['paste']['event_registration_missing'],1)
        self.assertEqual(result['status']['observations'],0)
        self.assertIsNone(result['status']['probe_ms']['p50'])
    def test_invalid_destination_metadata_rejected(self):
        for changes in [{'scope':'private field name'},{'stage':'unknown'},{'outcome':'secret'},{'events_tracked':1},{'duration_ms':float('nan')}]:
            with self.assertRaises(ValueError):report.validate_entry(self.row(**changes))
    def test_legacy_logs_do_not_invent_destination_coverage(self):
        result=report.summarize([dict(schema=1,seq=1,t_us=1000,run_id='run',event='run_metadata')])
        self.assertEqual(result['destination_verification']['paste']['observations'],0)
        self.assertIsNone(result['destination_verification']['paste']['probe_ms']['p50'])


if __name__ == '__main__':
    unittest.main()
