#!/usr/bin/env python3
"""Serve the study guide on loopback and expose only catalogued Git blobs.

Never serve the checkout as a directory. Working files, credentials, recordings,
and Git internals are deliberately outside the HTTP document root.
"""

from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs, unquote
import argparse, json, mimetypes, subprocess

ROOT = Path(__file__).resolve().parent


class GuideServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, port, repo):
        self.repo = repo.resolve()
        self.site = ROOT / "site"
        self.catalog = json.loads((self.site / "catalog.json").read_text())
        self.entries = {f["path"]: f for f in self.catalog["files"]}
        commit = self.catalog["commit"]
        subprocess.run(
            ["git", "-C", str(self.repo), "cat-file", "-e", commit + "^{commit}"],
            check=True,
            capture_output=True,
        )
        super().__init__(("127.0.0.1", port), Handler)


class Handler(BaseHTTPRequestHandler):
    server_version = "VOCOStudy/1"

    def log_message(self, *args):
        pass  # No query paths or study activity written to logs.

    def reply(self, status, body, kind="application/json; charset=utf-8"):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
        )
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def error(self, status, message):
        self.reply(status, json.dumps({"error": message}).encode())

    def permitted(self):
        port = self.server.server_port
        allowed = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if self.headers.get("Host") not in allowed:
            self.error(403, "Loopback Host required")
            return False
        origin = self.headers.get("Origin")
        if origin and origin not in {"http://" + h for h in allowed}:
            self.error(403, "Same-origin requests only")
            return False
        if self.headers.get("Sec-Fetch-Site") == "cross-site":
            self.error(403, "Cross-site requests denied")
            return False
        return True

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        if not self.permitted():
            return
        url = urlsplit(self.path)
        if url.path == "/api/source":
            values = parse_qs(url.query)
            paths = values.get("path", [])
            if len(paths) != 1 or set(values) != {"path"}:
                self.error(400, "One catalogued path required")
                return
            entry = self.server.entries.get(paths[0])
            if not entry:
                self.error(404, "File is not in the pinned catalog")
                return
            if not entry["text"]:
                self.error(
                    415, "Binary or large file: metadata is available in the catalog"
                )
                return
            try:
                data = subprocess.check_output(
                    [
                        "git",
                        "-C",
                        str(self.server.repo),
                        "cat-file",
                        "blob",
                        entry["blob"],
                    ],
                    timeout=5,
                )
                text = data.decode("utf-8")
            except (subprocess.SubprocessError, UnicodeError):
                self.error(503, "Pinned source unavailable")
                return
            self.reply(
                200,
                json.dumps(
                    {
                        "path": entry["path"],
                        "commit": self.server.catalog["commit"],
                        "text": text,
                    }
                ).encode(),
            )
            return
        if url.path.startswith("/api/"):
            self.error(404, "Unknown endpoint")
            return
        path = unquote(url.path)
        target = (self.server.site / (path.lstrip("/") or "index.html")).resolve()
        if (
            not target.is_relative_to(self.server.site.resolve())
            or not target.is_file()
            or any(
                part.startswith(".")
                for part in target.relative_to(self.server.site).parts
            )
        ):
            self.error(404, "Page not found")
            return
        kind = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
        self.reply(200, target.read_bytes(), kind)

    def do_POST(self):
        self.error(405, "Read-only guide")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo",
        type=Path,
        required=True,
        help="Local VOCO Git checkout containing the pinned commit",
    )
    parser.add_argument("--port", type=int, default=8785)
    args = parser.parse_args()
    server = GuideServer(args.port, args.repo)
    print(
        f"Inside VOCO: http://127.0.0.1:{server.server_port} (loopback only)",
        flush=True,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
