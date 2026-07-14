from __future__ import annotations

import json
import os
import socket
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from voco_ibus_protocol import (
    MAX_REQUEST_BYTES,
    PROTOCOL_VERSION,
    JsonLineBuffer,
    PrivateSocketServer,
    ProtocolError,
    decode_request,
    encode_message,
    peer_uid,
    runtime_socket_path,
)


class ProtocolTests(unittest.TestCase):
    def test_runtime_path_requires_an_absolute_xdg_runtime_directory(self) -> None:
        with self.assertRaises(ProtocolError):
            runtime_socket_path({})
        with self.assertRaises(ProtocolError):
            runtime_socket_path({"XDG_RUNTIME_DIR": "relative"})
        self.assertEqual(
            runtime_socket_path({"XDG_RUNTIME_DIR": "/run/user/1000"}),
            Path("/run/user/1000/voco/ibus-engine.sock"),
        )

    def test_buffer_handles_fragmented_and_coalesced_requests(self) -> None:
        buffer = JsonLineBuffer()
        self.assertEqual(buffer.feed(b'{"id":1'), ())
        self.assertEqual(
            buffer.feed(b'}\n{"id":2}\n'),
            (b'{"id":1}', b'{"id":2}'),
        )

    def test_buffer_rejects_empty_and_oversized_requests(self) -> None:
        with self.assertRaises(ProtocolError):
            JsonLineBuffer().feed(b"\n")
        with self.assertRaises(ProtocolError):
            JsonLineBuffer().feed(b"x" * (MAX_REQUEST_BYTES + 1))

    def test_decoder_rejects_non_objects_and_invalid_json(self) -> None:
        for value in (b"[]", b"not-json", b"\xff"):
            with self.subTest(value=value), self.assertRaises(ProtocolError):
                decode_request(value)

    def test_encoder_does_not_escape_unicode_or_log_payloads(self) -> None:
        encoded = encode_message(
            {"version": PROTOCOL_VERSION, "id": 1, "text": "café 👩\u200d💻"},
            1_000,
        )
        self.assertEqual(json.loads(encoded), {"version": 1, "id": 1, "text": "café 👩\u200d💻"})

    def test_socket_is_private_and_accepts_only_same_user_peer(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary)
            os.chmod(runtime, 0o700)
            server = PrivateSocketServer(runtime / "voco" / "ibus-engine.sock")
            listener = server.start()
            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.connect(str(server.socket_path))
            accepted = server.accept()
            self.assertIsNotNone(accepted)
            self.assertEqual(peer_uid(accepted), os.geteuid())
            self.assertEqual(stat.S_IMODE(server.socket_path.stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(server.socket_path.parent.stat().st_mode), 0o700)
            client.close()
            server.close()
            listener.close()

    def test_second_client_is_rejected_without_replacing_the_owner(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary)
            os.chmod(runtime, 0o700)
            server = PrivateSocketServer(runtime / "voco" / "ibus-engine.sock")
            server.start()
            first = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            first.connect(str(server.socket_path))
            owner = server.accept()
            second = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            second.settimeout(1)
            second.connect(str(server.socket_path))
            self.assertIsNone(server.accept())
            rejection = json.loads(second.makefile("rb").readline())
            self.assertFalse(rejection["ok"])
            self.assertIs(server.client, owner)
            first.close()
            second.close()
            server.close()

    def test_failed_peer_credential_lookup_closes_the_accepted_socket(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            runtime = Path(temporary)
            os.chmod(runtime, 0o700)
            server = PrivateSocketServer(runtime / "voco" / "ibus-engine.sock")
            server.start()
            client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            client.connect(str(server.socket_path))
            with patch(
                "voco_ibus_protocol.peer_uid",
                side_effect=ProtocolError("synthetic credential failure"),
            ):
                with self.assertRaisesRegex(ProtocolError, "credential failure"):
                    server.accept()
            self.assertIsNone(server.client)
            client.close()
            server.close()


if __name__ == "__main__":
    unittest.main()
