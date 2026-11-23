"""A push's samples reach the model the same from base64 float32 and from a JSON list."""
import base64
import io
import json
import unittest
import numpy as np
from test_worker_spelling import FakeMetrics, ScriptedModel
from worker_main import push_audio, serve


class RecordingModel(ScriptedModel):
    def start(self, phrases=(), boost=None):
        super().start(phrases, boost)
        self.pushed = []

    def push(self, audio, rate):
        self.pushed.append(np.asarray(audio, np.float32))
        return None


def packed(samples):
    return base64.b64encode(np.asarray(samples, '<f4').tobytes()).decode()


def responses(pushes):
    requests = [{'op': 'start', 'session': 'one', 'seq': 0}]
    requests += [{'op': 'push', 'session': 'one', 'seq': index, 'rate': 16000, **push}
                 for index, push in enumerate(pushes, start=1)]
    output, metrics, model = io.StringIO(), FakeMetrics(), RecordingModel([], '')
    source = io.BytesIO(''.join(json.dumps(request) + '\n' for request in requests).encode())
    serve(output, source, model, metrics)
    return [json.loads(line) for line in output.getvalue().splitlines()][2:], metrics.rows, model


class WorkerAudioTests(unittest.TestCase):
    # Values a float32 holds exactly and ones it rounds, the smallest subnormal,
    # negative zero and both ends of the range.
    SAMPLES = np.array([0., -0., 1., -1., .1, -.3, 1e-45, 3.4028235e38, 2 ** -24, 1 / 3], np.float32)

    def test_packed_samples_are_the_listed_samples_bit_for_bit(self):
        listed = [float(sample) for sample in self.SAMPLES]
        answers, _, model = responses([{'audio': listed}, {'audio_f32': packed(self.SAMPLES)}])
        self.assertTrue(all('error' not in answer for answer in answers), answers)
        from_list, from_packed = model.pushed
        self.assertEqual(from_packed.dtype, np.float32)
        self.assertEqual(from_list.tobytes(), self.SAMPLES.tobytes())
        self.assertEqual(from_packed.tobytes(), self.SAMPLES.tobytes())

    def test_packed_samples_are_read_little_endian(self):
        audio = push_audio({'audio_f32': base64.b64encode(bytes([0, 0, 128, 63, 0, 0, 0, 191])).decode()})
        self.assertEqual(audio.tolist(), [1., -.5])

    def test_a_push_names_one_encoding_and_whole_samples(self):
        whole = packed([.25, .5])
        rejected = [
            {'audio_f32': whole, 'audio': [.25, .5]},       # both
            {'audio_f32': whole[:-4] + 'A==='},              # bad padding
            {'audio_f32': whole[:-1] + '!'},                 # not base64
            {'audio_f32': base64.b64encode(b'\0' * 6).decode()},  # half a sample
            {'audio_f32': whole + '\n'},                     # a stray line end
            {'audio_f32': [whole]},                          # not a string
            {'audio_f32': 7},
        ]
        answers, rows, model = responses(rejected)
        self.assertEqual(model.pushed, [])
        self.assertEqual([answer.get('error') for answer in answers],
                         ['stream request rejected: ValueError'] * len(rejected))
        self.assertEqual([row['error_code'] for row in rows if row['event'] == 'request_failed'],
                         ['invalid_audio'] * len(rejected))

    def test_a_rejected_push_says_nothing_about_its_samples(self):
        answers, rows, _ = responses([{'audio_f32': 'PRIVATE'}])
        self.assertNotIn('PRIVATE', json.dumps(answers) + json.dumps(rows))


if __name__ == '__main__':
    unittest.main()
