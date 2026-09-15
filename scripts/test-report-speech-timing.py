import json,subprocess,sys,tempfile,unittest
from pathlib import Path

SCRIPT=Path(__file__).with_name('report-speech-performance.py')
class ReportTests(unittest.TestCase):
    def report(self,fields,endpoint_overrides=None,backend=()):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'stream-performance').mkdir();(root/'performance').mkdir()
            rows=[{'event':'worker_ready','run_id':'one','event_seq':1,'model':'fixture'}]
            for seq,op in enumerate(['start','push','finish'],2):
                row={'event':'request_completed','op':op,'run_id':'one','event_seq':seq,'stream_session_hash':'hash','cpu_user_s':seq,'cpu_system_s':0,'total_ms':1,'queue_age_ms':0}
                if op=='push':row.update(fields)
                elif endpoint_overrides is not None:row.update(endpoint_overrides)
                rows.append(row)
            (root/'performance/app.jsonl').write_text(''.join(json.dumps({'stream_session_hash':'hash', **r})+'\n' for r in backend))
            (root/'stream-performance/worker.jsonl').write_text(''.join(json.dumps(r)+'\n' for r in rows))
            return json.loads(subprocess.check_output([sys.executable,str(SCRIPT),str(root)],text=True))['sessions'][0]
    def test_old_logs_have_unavailable_stage_values(self):
        r=self.report({})
        self.assertIsNone(r['recognizer_push_ms']['p50'])
        self.assertIsNone(r['first_nonzero_audio_s'])
    def test_measured_zero_is_distinct_from_unavailable(self):
        r=self.report({'recognizer_push_ms':0,'result_drain_ms':0,'recognizer_push_calls':0,'first_nonzero_audio_s':0})
        self.assertEqual(r['recognizer_push_ms'],{'count':1,'p50':0,'p95':0,'max':0})
        self.assertEqual(r['first_nonzero_audio_s'],0)
    def test_burst_count_and_cost_survive_summary(self):
        r=self.report({'recognizer_push_ms':65.5,'result_drain_ms':.3,'recognizer_push_calls':33,'first_nonzero_audio_s':.64})
        self.assertEqual(r['recognizer_push_calls_per_request']['max'],33)
        self.assertEqual(r['recognizer_push_ms']['p50'],65.5)
    def test_invalid_numeric_samples_are_not_reported(self):
        r=self.report({'recognizer_push_ms':float('nan'),'result_drain_ms':True,'recognizer_push_calls':-1})
        self.assertIsNone(r['recognizer_push_ms']['p50'])
        self.assertIsNone(r['result_drain_ms']['p50'])
        self.assertIsNone(r['recognizer_push_calls_per_request']['p50'])
    def test_missing_or_invalid_cpu_is_unavailable(self):
        for value in (None, True, float('nan'), -1):
            with self.subTest(value=value):
                self.assertIsNone(self.report({}, {'cpu_user_s':value})['worker_cpu_s'])

    def test_batched_call_count_remains_distinct_from_released_frames(self):
        r=self.report({'gate_released_frames':33,'recognizer_push_calls':1})
        self.assertEqual(r['gate_released_frames_per_request']['max'],33)
        self.assertEqual(r['recognizer_push_calls_per_request']['max'],1)

    def test_successful_quality_events_are_not_failures(self):
        rows = [{'event':'speech_exchange', 'outcome':'ok'}]
        rows += [{'event':'speech_quality', 'stage':stage} for stage in
                 ('hypothesis', 'delivery_requested', 'delivery_dispatched')]
        rows += [{'event':'speech_quality', 'stage':'native_dispatch', 'outcome':'dispatched'},
                 {'event':'speech_quality', 'stage':'terminal', 'outcome':'finished'}]
        report = self.report({}, backend=rows)
        self.assertEqual(report['app_failures'], {})
        self.assertEqual(report['app_unclassified_records'], 0)
        self.assertEqual(report['app_outcomes'], {'native_dispatch:dispatched':1, 'terminal:finished':1})

    def test_explicit_failure_events_remain_counted(self):
        rows = [{'event':'speech_exchange', 'outcome':'response_timeout'},
                {'event':'speech_queue_failed', 'reason':'insertion_failed'},
                {'event':'speech_quality', 'stage':'delivery_failed'},
                {'event':'speech_quality', 'stage':'terminal', 'outcome':'failed'},
                {'event':'speech_quality', 'stage':'native_dispatch', 'outcome':'rejected'}]
        report = self.report({}, backend=rows)
        self.assertEqual(report['app_failures'], {'response_timeout':1, 'insertion_failed':1,
                         'delivery_failed':1, 'terminal_failed':1, 'native_rejected':1})
        self.assertEqual(report['app_unclassified_records'], 0)

    def test_cancelled_and_uncertain_are_outcomes_not_assumed_failures(self):
        rows = [{'event':'speech_quality', 'stage':stage, 'outcome':outcome} for stage,outcome in
                [('terminal','cancelled'), ('terminal','incomplete'),
                 ('native_dispatch','uncertain'), ('native_dispatch','no-mutation')]]
        report = self.report({}, backend=rows)
        self.assertEqual(report['app_failures'], {})
        self.assertEqual(sum(report['app_outcomes'].values()), 4)
        self.assertEqual(report['app_unclassified_records'], 0)

    def test_unknown_records_are_visible_without_exporting_arbitrary_fields(self):
        rows = [{'event':'future_event', 'outcome':'secret_SENTINEL'},
                {'event':'speech_exchange'},
                {'event':'speech_exchange', 'outcome':['invalid']},
                {'event':'speech_queue_failed', 'reason':{'unexpected':True}},
                {'event':'speech_quality', 'stage':'native_dispatch'},
                {'event':'speech_quality', 'stage':'terminal', 'outcome':'future-outcome'}]
        report = self.report({}, backend=rows)
        self.assertEqual(report['app_unclassified_records'], len(rows))
        self.assertEqual(report['app_failures'], {})
        self.assertNotIn('secret_SENTINEL', json.dumps(report))

    def test_process_failures_and_malformed_records_are_retained(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'performance').mkdir()
            record={'event':'speech_worker_failed','stage':'startup','reason':'output_eof',
                    'exit_observed':False,'exit_code':None,'exit_signal':None}
            (root/'performance/app.jsonl').write_text(json.dumps(record)+'\n[]\nnull\n{}\ninvalid\n')
            report=json.loads(subprocess.check_output([sys.executable,str(SCRIPT),str(root)],text=True))
            self.assertEqual(report['coverage']['invalid_lines'],4)
            self.assertEqual(report['worker_process_failures'][0]['reason'],'output_eof')
            self.assertIsNone(report['worker_process_failures'][0]['exit_code'])
            self.assertEqual(report['sessions'],[])

if __name__=='__main__':unittest.main()
