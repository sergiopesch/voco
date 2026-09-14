#!/usr/bin/env python3
"""Exercise actual pipe behavior without loading a speech model."""
import importlib.util
import os
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    'speech_evaluation', Path(__file__).with_name('test-speech-adversarial.py'))
evaluation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(evaluation)


class WorkerResponseTests(unittest.TestCase):
    def setUp(self):
        reader, writer = os.pipe()
        self.reader = os.fdopen(reader, 'rb', buffering=0)
        self.writer = os.fdopen(writer, 'wb', buffering=0)
        self.addCleanup(self.reader.close)
        self.addCleanup(self.writer.close)
        self.responses = evaluation.WorkerResponses(self.reader, max_bytes=64)

    def test_multiple_responses_in_one_pipe_read(self):
        self.writer.write(b'{"text":"one"}\n{"text":"two"}\n')
        self.assertEqual(self.responses.read(timeout=0.1), {'text': 'one'})
        self.assertEqual(self.responses.read(timeout=0.1), {'text': 'two'})

    def test_partial_response_cannot_escape_timeout(self):
        self.writer.write(b'{"text":')
        with self.assertRaisesRegex(RuntimeError, 'time bound'):
            self.responses.read(timeout=0.02)

    def test_eof_does_not_accept_unterminated_json(self):
        self.writer.write(b'{"text":"done"}')
        self.writer.close()
        with self.assertRaisesRegex(RuntimeError, 'before a complete response'):
            self.responses.read(timeout=0.1)

    def test_oversized_line_and_partial_line_fail(self):
        for suffix in (b'\n', b''):
            with self.subTest(suffix=suffix):
                self.writer.write(b'x' * 65 + suffix)
                with self.assertRaisesRegex(RuntimeError, 'size bound'):
                    self.responses.read(timeout=0.1)
                self.responses.pending.clear()

    def test_malformed_json_fails(self):
        self.writer.write(b'broken\n')
        with self.assertRaises(ValueError):
            self.responses.read(timeout=0.1)


if __name__ == '__main__':
    unittest.main()
