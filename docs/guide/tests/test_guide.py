"""Exercise the real loopback server and the pinned lesson/source contract."""

import http.client
import json
import os
import sys
from pathlib import Path
import subprocess
import threading
import unittest
from urllib.parse import quote
from serve import GuideServer, ROOT


class GuideTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.repo = Path(os.environ["VOCO_SOURCE"])
        cls.server = GuideServer(0, cls.repo)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, path="/", method="GET", headers=None):
        connection = http.client.HTTPConnection(
            "127.0.0.1", self.server.server_port, timeout=5
        )
        connection.request(method, path, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def test_loopback_and_security_headers(self):
        self.assertEqual(self.server.server_address[0], "127.0.0.1")
        status, headers, body = self.request()
        self.assertEqual(status, 200)
        self.assertIn(b"Inside VOCO", body)
        self.assertIn("frame-ancestors 'none'", headers["Content-Security-Policy"])
        self.assertEqual(headers["Cache-Control"], "no-store")
        self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_reject_foreign_sites_and_dns_rebinding(self):
        for headers in [
            {"Host": "evil.example"},
            {"Origin": "https://evil.example"},
            {"Sec-Fetch-Site": "cross-site"},
        ]:
            with self.subTest(headers=headers):
                self.assertEqual(self.request(headers=headers)[0], 403)

    def test_only_pinned_catalogued_source_is_readable(self):
        path = "apps/desktop/src/App.tsx"
        status, _, body = self.request("/api/source?path=" + quote(path))
        self.assertEqual(status, 200)
        expected = subprocess.check_output(
            [
                "git",
                "-C",
                str(self.repo),
                "show",
                self.server.catalog["commit"] + ":" + path,
            ]
        ).decode()
        self.assertEqual(json.loads(body)["text"], expected)
        for path in [
            "../../.ssh/id_rsa",
            ".git/config",
            "/etc/passwd",
            "untracked-secret.txt",
        ]:
            with self.subTest(path=path):
                self.assertEqual(
                    self.request("/api/source?path=" + quote(path))[0], 404
                )

    def test_reject_traversal_and_writes(self):
        for path in [
            "/../serve.py",
            "/%2e%2e/serve.py",
            "/.git/config",
            "/api/unknown",
        ]:
            self.assertEqual(self.request(path)[0], 404)
        self.assertEqual(
            self.request("/api/source?path=README.md&path=LICENSE")[0], 400
        )
        self.assertEqual(self.request(method="POST")[0], 405)

    def test_binary_is_metadata_only(self):
        entry = next(x for x in self.server.entries.values() if not x["text"])
        self.assertEqual(
            self.request("/api/source?path=" + quote(entry["path"]))[0], 415
        )

    def test_catalog_matches_every_tracked_path_and_blob(self):
        raw = subprocess.check_output(
            [
                "git",
                "-C",
                str(self.repo),
                "ls-tree",
                "-r",
                "-z",
                self.server.catalog["commit"],
            ]
        )
        actual = {}
        for record in raw.split(b"\0"):
            if record:
                meta, path = record.split(b"\t", 1)
                actual[path.decode()] = meta.decode().split()[2]
        self.assertEqual(actual, {p: e["blob"] for p, e in self.server.entries.items()})
        self.assertEqual(len(actual), self.server.catalog["fileCount"])
        package = json.loads(subprocess.check_output(["git", "-C", str(self.repo), "show", self.server.catalog["commit"] + ":package.json"]))
        self.assertEqual(self.server.catalog["version"], package["version"])
        self.assertTrue(
            any(
                e["text"] and p.endswith(".cpp") for p, e in self.server.entries.items()
            )
        )

    def test_lessons_are_reproducible(self):
        subprocess.run(
            [sys.executable, str(ROOT / "tools/write_lessons.py"), "--check"],
            check=True,
            capture_output=True,
        )

    def test_lessons_cite_real_paths_and_valid_quizzes(self):
        chapters = json.loads((ROOT / "site/chapters.json").read_text())
        self.assertEqual(len(chapters), 20)
        self.assertEqual(len({c["id"] for c in chapters}), len(chapters))
        for chapter in chapters:
            with self.subTest(chapter=chapter["id"]):
                for entry in chapter["files"]:
                    self.assertIn(entry["path"], self.server.entries)
                self.assertEqual(len(chapter["steps"]), 5)
                self.assertIn(
                    chapter["quiz"]["correct"], range(len(chapter["quiz"]["answers"]))
                )

    def test_evaluation_is_dated_and_separate_from_release_source(self):
        chapters = json.loads((ROOT / "site/chapters.json").read_text())
        chapter = next(c for c in chapters if c["id"] == "typesafe")
        self.assertIn(self.server.catalog["version"], chapter["sourceNote"])
        self.assertIn(".41", chapter["comparison"]["title"])
        self.assertIn("not", chapter["comparison"]["limits"])
        for comparison in [chapter["comparison"], *chapter["comparison"].get("additional", [])]:
            self.assertEqual(len(comparison["headers"]), 3)
            self.assertTrue(comparison["rows"])
            self.assertTrue(all(len(row) == 3 for row in comparison["rows"]))


if __name__ == "__main__":
    unittest.main()
