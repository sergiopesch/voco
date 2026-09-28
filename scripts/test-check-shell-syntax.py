#!/usr/bin/env python3
"""Exercise the shell syntax gate without executing any checked script."""

from pathlib import Path
import subprocess
import tempfile
import unittest


CHECKER = Path(__file__).resolve().with_name("check-shell-syntax.sh")


class ShellSyntaxTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="voco-shell-syntax-")
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)

    def script(self, name, content="true\n"):
        path = self.root / name
        path.write_text(content)
        return path

    def check(self, *paths):
        return subprocess.run(
            ["bash", str(CHECKER), *(str(path) for path in paths)],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_valid_files_with_spaces_are_not_executed(self):
        marker = self.root / "executed"
        scripts = [
            self.script("first script.sh", f'touch "{marker}"\n'),
            self.script("second script.sh", "exit 7\n"),
        ]
        result = self.check(*scripts)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(marker.exists())

    def test_invalid_script_at_each_position_fails(self):
        scripts = [self.script(f"script-{index}.sh") for index in range(3)]
        for index, script in enumerate(scripts):
            with self.subTest(position=index):
                script.write_text("if\n")
                result = self.check(*scripts)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(str(script), result.stderr)
                script.write_text("true\n")

    def test_missing_later_script_fails(self):
        result = self.check(self.script("valid.sh"), self.root / "missing.sh")
        self.assertNotEqual(result.returncode, 0)

    def test_empty_selection_fails(self):
        self.assertNotEqual(self.check().returncode, 0)


if __name__ == "__main__":
    unittest.main()
