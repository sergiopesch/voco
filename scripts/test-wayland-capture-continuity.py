#!/usr/bin/env python3
"""No inference: verify synthetic waveform coverage scoring detects missing speech."""
import array
from pathlib import Path
import unittest
from test_native_wayland_capture import capture_continuity, pcm16, painted_copy_metrics

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

class PaintTests(unittest.TestCase):
    def score(self, pixels):
        return painted_copy_metrics(pixels, 200, 120, 600, 3, [0, 0, 200, 120], [20, 40, 149, 44])

    def test_black_and_unrelated_white_do_not_prove_painted_copy(self):
        for color in (0, 255):
            with self.subTest(color=color):
                self.assertFalse(self.score(bytes([color]) * (200 * 120 * 3))['passed'])

    def test_rounded_bordered_blank_fails_but_inner_glyphs_pass(self):
        pixels = bytearray([25] * (200 * 120 * 3))
        for y in range(44):
            for x in range(149):
                center_x = max(22, min(127, x))
                # Pill with a dark2px border and rounded dark corners.
                color = 190 if (x - center_x) ** 2 + (y - 22) ** 2 < 20 ** 2 else 25
                offset = ((y + 40) * 200 + x + 20) * 3
                pixels[offset:offset + 3] = bytes([color]) * 3
        self.assertFalse(self.score(pixels)['passed'], 'Rounded blank button must not count corners as text')
        for y in range(53, 70):
            for x in range(55, 65):
                offset = (y * 200 + x) * 3
                pixels[offset:offset + 3] = bytes([25]) * 3
        self.assertTrue(self.score(pixels)['passed'])

    def test_ghost_control_requires_inner_light_text_and_containment(self):
        pixels = bytearray([25] * (200 * 120 * 3))
        def score(button):
            return painted_copy_metrics(pixels, 200, 120, 600, 3, [0, 0, 200, 120], button, ghost=True)['passed']
        self.assertFalse(score([20, 40, 149, 44]))
        for y in range(53, 70):
            for x in range(55, 65):
                offset = (y * 200 + x) * 3
                pixels[offset:offset + 3] = bytes([190]) * 3
        self.assertTrue(score([20, 40, 149, 44]))
        self.assertFalse(score([20, 100, 149, 44]))

    def test_missing_native_screen_origin_fails(self):
        self.assertFalse(painted_copy_metrics(bytes(10800), 60, 60, 180, 3, [-1, -1, 60, 60], [10, 20, 30, 10])['passed'])

if __name__ == '__main__':
    unittest.main()
