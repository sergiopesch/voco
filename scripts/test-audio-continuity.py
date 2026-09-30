#!/usr/bin/env python3
"""No inference: verify synthetic waveform coverage scoring detects missing speech."""
import array
from pathlib import Path
import unittest
from audio_continuity import capture_continuity, pcm16

class ContinuityTests(unittest.TestCase):
    def setUp(self):
        self.reference = pcm16(Path(__file__).resolve().parent.parent / 'tests/fixtures/speech/84-121123-0000.wav')

    def test_shifted_complete_fixture_uses_one_exact_alignment(self):
        for shift in (17, 8000, 16031):
            with self.subTest(shift=shift):
                captured = array.array('h', [0]) * shift + self.reference + array.array('h', [0]) * 1000
                result = capture_continuity(self.reference, captured)
                self.assertTrue(result['passed'])
                self.assertEqual(result['offsetSamples'], shift)

    def test_missing_speech_quarter_fails(self):
        captured = array.array('h', [0]) * 8000 + self.reference + array.array('h', [0]) * 1000
        first, last = len(self.reference) // 4, len(self.reference) // 2
        captured[8000 + first:8000 + last] = array.array('h', [0]) * (last - first)
        self.assertFalse(capture_continuity(self.reference, captured)['passed'])

    def test_missing_interior_time_with_same_total_duration_fails(self):
        start, length = 16000, 2400
        damaged = self.reference[:start] + self.reference[start + length:] + array.array('h', [0]) * length
        self.assertEqual(len(damaged), len(self.reference))
        self.assertFalse(capture_continuity(self.reference, damaged)['passed'])

    def test_constant_capture_fails(self):
        self.assertFalse(capture_continuity(self.reference, array.array('h', [100]) * (len(self.reference) + 1000))['passed'])

    def test_truncated_capture_fails(self):
        with self.assertRaisesRegex(AssertionError, 'shorter'):
            capture_continuity(self.reference, self.reference[:-1])

if __name__ == '__main__':
    unittest.main()
