"""The CPU guard must fail before any AVX2 shared library can be loaded."""
import subprocess
import unittest
from unittest.mock import patch

import adapters


class CpuCheckTests(unittest.TestCase):
    def test_supported_cpu(self):
        with patch.object(adapters.subprocess, 'run') as run:
            run.return_value.returncode = 0
            adapters.check_cpu()
            self.assertEqual(run.call_args.kwargs['timeout'], 5)

    def test_unsupported_cpu_does_not_load_library(self):
        with patch.object(adapters.subprocess, 'run') as run, patch.object(adapters.c, 'CDLL') as load:
            run.return_value.returncode = 1
            with self.assertRaisesRegex(RuntimeError, 'Unsupported CPU'):
                adapters.Nemotron()
            load.assert_not_called()

    def test_missing_or_hung_guard_does_not_load_library(self):
        for error in (FileNotFoundError(), subprocess.TimeoutExpired('cpu-check', 5)):
            with self.subTest(error=type(error).__name__), \
                    patch.object(adapters.subprocess, 'run', side_effect=error), \
                    patch.object(adapters.c, 'CDLL') as load:
                with self.assertRaises(type(error)):
                    adapters.Nemotron()
                load.assert_not_called()
