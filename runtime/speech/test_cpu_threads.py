"""Worker defaults must fit a small CPU allocation without changing research overrides."""
import os
import unittest
from unittest.mock import patch

from worker_main import configure_cpu_threads


class CpuThreadTests(unittest.TestCase):
    def test_affinity_limits_the_default(self):
        for available, expected in (({0}, '1'), ({2, 7}, '2'), (set(range(16)), '4')):
            with self.subTest(available=available), patch.dict(os.environ, {}, clear=True):
                with patch('os.sched_getaffinity', return_value=available):
                    configure_cpu_threads()
                self.assertEqual(os.environ['NEMO_SPEECH_CPU_THREADS'], expected)

    def test_cpu_count_fallback_and_unknown_cpu(self):
        for count, expected in ((2, '2'), (16, '4'), (None, '1')):
            with self.subTest(count=count), patch.dict(os.environ, {}, clear=True):
                with patch('os.sched_getaffinity', side_effect=OSError), patch('os.cpu_count', return_value=count):
                    configure_cpu_threads()
                self.assertEqual(os.environ['NEMO_SPEECH_CPU_THREADS'], expected)

    def test_explicit_research_configuration_is_not_rewritten(self):
        with patch.dict(os.environ, {'NEMO_SPEECH_CPU_THREADS': '8'}, clear=True):
            with patch('os.sched_getaffinity', side_effect=AssertionError('unneeded probe')):
                configure_cpu_threads()
            self.assertEqual(os.environ['NEMO_SPEECH_CPU_THREADS'], '8')


if __name__ == '__main__':
    unittest.main()
