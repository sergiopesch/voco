"""The worker converts each session's text in its chosen spelling, append-only."""
import io
import json
import unittest
from unittest.mock import patch
from worker_main import main, serve


class ScriptedModel:
    """Returns its hypotheses in turn, like StreamingSession."""
    audio_s = 0.
    rate = 16000
    metrics = {}

    class gate:
        processed_s = skipped_s = 0.
        pending_n = 0

    def __init__(self, hypotheses, final):
        self.hypotheses, self.final = hypotheses, final

    def start(self):
        self.queue = list(self.hypotheses)

    def push(self, audio, rate):
        return self.queue.pop(0)

    def finish(self):
        return self.final

    def cancel(self):
        pass


class FakeMetrics:
    run_id = 'fixture'

    def __init__(self):
        self.rows = []

    def emit(self, event, **fields):
        self.rows.append(dict(event=event, **fields))


def session(hypotheses, final, **start):
    requests = [{'op': 'start', 'session': 'one', 'seq': 0, **start}]
    requests += [{'op': 'push', 'session': 'one', 'seq': index, 'audio': [0.], 'rate': 16000}
                 for index in range(1, len(hypotheses) + 1)]
    requests.append({'op': 'finish', 'session': 'one', 'seq': len(hypotheses) + 1})
    output, metrics = io.StringIO(), FakeMetrics()
    source = io.BytesIO(''.join(json.dumps(request) + '\n' for request in requests).encode())
    serve(output, source, ScriptedModel(hypotheses, final), metrics)
    return [json.loads(line) for line in output.getvalue().splitlines()][1:], metrics.rows


class WorkerSpellingTests(unittest.TestCase):
    HYPOTHESES = ['I recogn', 'I recognized', 'I recognized the colo', 'I recognized the color']
    FINAL = 'I recognized the colors.'

    def test_british_session_emits_only_text_that_cannot_change(self):
        responses, rows = session(self.HYPOTHESES, self.FINAL, spelling='british')
        texts = [response['text'] for response in responses]
        self.assertEqual(texts, [None, 'I recogn', 'I recogni', 'I recognised the colo', None,
                                 'I recognised the colours.'])
        self.assertTrue(all(response['mode'] == 'append-only' for response in responses))
        completed = [row for row in rows if row['event'] == 'request_completed']
        self.assertEqual({row['spelling'] for row in completed}, {'british'})
        self.assertFalse(any({'text', 'transcript', 'audio'} & row.keys() for row in rows))

    def test_american_session_and_a_start_without_spelling(self):
        responses, _ = session(['The colour of the centre'], 'The colour of the centre.', spelling='american')
        self.assertEqual(responses[-1]['text'], 'The color of the center.')
        responses, rows = session(self.HYPOTHESES, self.FINAL)
        self.assertEqual([response['text'] for response in responses][1:], self.HYPOTHESES + [self.FINAL])
        self.assertEqual({row['spelling'] for row in rows if row['event'] == 'request_completed'}, {'as-recognised'})

    def test_unknown_spelling_rejects_the_start(self):
        responses, rows = session(['the color'], 'the color', spelling='canadian')
        self.assertEqual(responses[0]['error'], 'stream request rejected: ValueError')
        self.assertTrue(all('error' in response for response in responses))
        self.assertEqual(rows[0]['error_code'], 'invalid_spelling')

    def test_missing_table_fails_startup_before_ready(self):
        protocol, metrics = io.StringIO(), FakeMetrics()
        metrics.close = lambda: None
        with patch('streaming.Metrics', return_value=metrics), patch('spelling.Spelling', side_effect=FileNotFoundError), \
                patch('streaming.StreamingSession', side_effect=AssertionError('model loaded')):
            self.assertEqual(main(protocol), 1)
        self.assertEqual(json.loads(protocol.getvalue()), {'ready': False, 'error': 'local speech runtime could not initialize'})
        self.assertEqual(metrics.rows[0]['stage'], 'spelling_table')
        self.assertEqual(metrics.rows[0]['error_code'], 'runtime_file_missing')


if __name__ == '__main__':
    unittest.main()
