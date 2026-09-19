"""Timing instrumentation must preserve sample order and transcript behavior."""
import unittest
from unittest.mock import patch
import numpy as np
import streaming

class Model:
    def __init__(self, *_): self.frames=[];self.metrics={}
    def start(self): self.frames=[]
    def push(self,audio,rate):
        self.frames.append(audio.copy());self.metrics={'recognizer_push_ms':2.,'result_drain_ms':.25}
        return 'fixture'
    def finish(self): return 'fixture' if self.frames else ''
    def close(self): pass

class TimingTests(unittest.TestCase):
    def setUp(self):
        patcher=patch.object(streaming,'Nemotron',Model);patcher.start();self.addCleanup(patcher.stop)
        self.session=streaming.StreamingSession(warmup=False);self.session.start()
    def test_silence_has_no_inference_or_onset(self):
        self.assertIsNone(self.session.push(np.zeros(320),16000))
        self.assertEqual(self.session.metrics['recognizer_push_calls'],0)
        self.assertEqual(self.session.metrics['recognizer_push_ms'],0)
        self.assertIsNone(self.session.metrics['first_nonzero_audio_s'])
        self.assertEqual(self.session.finish(),'')
    def test_onset_burst_counts_preserved_frames(self):
        frames=[np.zeros(320,np.float32) for _ in range(5)]
        voice=np.ones(320,np.float32);voice[:100]=0;frames.append(voice)
        for frame in frames:self.session.push(frame,16000)
        self.assertTrue(np.array_equal(np.concatenate(frames),np.concatenate(self.session.model.frames)))
        self.assertEqual(self.session.metrics['gate_released_frames'],6)
        self.assertEqual(self.session.metrics['recognizer_push_calls'],1)
        self.assertEqual(self.session.metrics['recognizer_push_ms'],2)
        self.assertEqual(self.session.metrics['result_drain_ms'],.25)
        self.assertAlmostEqual(self.session.first_nonzero_audio_s,.1+100/16000)
    def test_new_session_clears_onset(self):
        self.session.push(np.ones(320),16000);self.session.finish();self.session.start()
        self.assertIsNone(self.session.first_nonzero_audio_s)
    def test_tiny_signal_is_not_classified_as_silence(self):
        self.session.push(np.full(320,1e-9),16000)
        self.assertEqual(self.session.first_nonzero_audio_s,0)
        self.assertEqual(self.session.metrics['recognizer_push_calls'],1)
    def test_invalid_samples_do_not_set_onset(self):
        with self.assertRaises(ValueError):self.session.push([float('nan')],16000)
        self.assertIsNone(self.session.first_nonzero_audio_s)
    def test_metrics_have_no_audio_or_text(self):
        self.session.push(np.ones(320),16000)
        self.assertEqual(set(self.session.metrics),{'asr_ms','gate_ms','vad_ms','recognizer_push_ms','result_drain_ms','recognizer_push_calls','first_nonzero_audio_s','gate_released_frames'})

    def test_coalescing_preserves_samples_and_one_second_limit_at_all_rates(self):
        for rate in (8000, 16000, 44100, 48000, 96000, 176400, 192000, 384000):
            frames = [np.arange(round(rate * .64), dtype=np.float32),
                      np.arange(rate, dtype=np.float32)]
            batched = streaming.coalesce_frames(frames, rate)
            self.assertTrue(all(0 < len(frame) <= rate for frame in batched))
            np.testing.assert_array_equal(np.concatenate(frames), np.concatenate(batched))

    def test_high_rate_samples_reach_model_unchanged(self):
        for rate in (176400, 192000, 384000):
            self.session.start()
            audio=np.sin(np.arange(rate//10, dtype=np.float32)/20)
            self.session.push(audio, rate);self.session.finish()
            np.testing.assert_array_equal(np.concatenate(self.session.model.frames), audio)
        self.session.start()
        with self.assertRaises(ValueError):self.session.push([.25],384001)

    def test_coalescing_single_frame_does_not_copy(self):
        frames = [np.ones(320, np.float32)]
        self.assertIs(streaming.coalesce_frames(frames, 16000), frames)
        self.assertEqual(streaming.coalesce_frames([], 16000), [])

    def test_finish_flushes_pending_tail_once_without_changing_samples(self):
        self.session.push(np.ones(320, np.float32), 16000)
        for _ in range(150):
            self.session.push(np.zeros(320, np.float32), 16000)
        pending = np.concatenate(list(self.session.gate.pending))
        prior_calls = len(self.session.model.frames)
        self.assertEqual(self.session.finish(), 'fixture')
        self.assertEqual(len(self.session.model.frames), prior_calls + 1)
        np.testing.assert_array_equal(self.session.model.frames[-1], pending)

if __name__=='__main__':unittest.main()
