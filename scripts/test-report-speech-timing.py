import json,subprocess,sys,tempfile,unittest
from pathlib import Path

SCRIPT=Path(__file__).with_name('report-speech-performance.py')
class ReportTests(unittest.TestCase):
    def report(self,fields,endpoint_overrides=None):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'stream-performance').mkdir();(root/'performance').mkdir()
            rows=[{'event':'worker_ready','run_id':'one','event_seq':1,'model':'fixture'}]
            for seq,op in enumerate(['start','push','finish'],2):
                row={'event':'request_completed','op':op,'run_id':'one','event_seq':seq,'stream_session_hash':'hash','cpu_user_s':seq,'cpu_system_s':0,'total_ms':1,'queue_age_ms':0}
                if op=='push':row.update(fields)
                elif endpoint_overrides is not None:row.update(endpoint_overrides)
                rows.append(row)
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
