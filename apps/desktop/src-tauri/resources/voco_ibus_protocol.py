"""Private, same-user IPC for VOCO's persistent IBus engine.

The socket carries dictated text, so it is deliberately kept outside the
session bus.  This module has no GI dependency and can be tested without
attaching to a desktop input session.
"""

from __future__ import annotations

import json
import os
import socket
import stat
import struct
from pathlib import Path
from typing import Any, Mapping, Optional


PROTOCOL_VERSION = 3
SOCKET_DIRECTORY_NAME = "voco"
SOCKET_FILE_NAME = "ibus-engine.sock"
MAX_REQUEST_BYTES = 4_000_000
MAX_RESPONSE_BYTES = 64_000


class ProtocolError(RuntimeError):
    """A malformed or unauthorized IPC request."""


def runtime_socket_path(environment: Optional[Mapping[str, str]] = None) -> Path:
    environment = os.environ if environment is None else environment
    runtime_dir = environment.get("XDG_RUNTIME_DIR", "")
    if not runtime_dir:
        raise ProtocolError("XDG_RUNTIME_DIR is unavailable")
    root = Path(runtime_dir)
    if not root.is_absolute():
        raise ProtocolError("XDG_RUNTIME_DIR must be an absolute path")
    return root / SOCKET_DIRECTORY_NAME / SOCKET_FILE_NAME


def secure_socket_directory(socket_path: Path) -> None:
    runtime_dir = socket_path.parent.parent
    runtime_status = runtime_dir.stat(follow_symlinks=False)
    if not stat.S_ISDIR(runtime_status.st_mode):
        raise ProtocolError("XDG_RUNTIME_DIR is not a directory")
    if runtime_status.st_uid != os.geteuid():
        raise ProtocolError("XDG_RUNTIME_DIR is owned by another user")
    if runtime_status.st_mode & 0o077:
        raise ProtocolError("XDG_RUNTIME_DIR permissions are not private")

    socket_dir = socket_path.parent
    try:
        socket_dir.mkdir(mode=0o700)
    except FileExistsError:
        pass
    directory_status = socket_dir.stat(follow_symlinks=False)
    if not stat.S_ISDIR(directory_status.st_mode):
        raise ProtocolError("VOCO runtime socket path is not a directory")
    if directory_status.st_uid != os.geteuid():
        raise ProtocolError("VOCO runtime socket directory is owned by another user")
    if directory_status.st_mode & 0o077:
        os.chmod(socket_dir, 0o700)


def peer_uid(connection: socket.socket) -> int:
    if not hasattr(socket, "SO_PEERCRED"):
        raise ProtocolError("peer credential verification is unavailable")
    credentials = connection.getsockopt(
        socket.SOL_SOCKET,
        socket.SO_PEERCRED,
        struct.calcsize("3i"),
    )
    _pid, uid, _gid = struct.unpack("3i", credentials)
    return uid


def encode_message(payload: Mapping[str, Any], maximum_bytes: int) -> bytes:
    encoded = (
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        + b"\n"
    )
    if len(encoded) > maximum_bytes:
        raise ProtocolError("protocol message exceeds the safety limit")
    return encoded


def decode_request(line: bytes) -> dict[str, Any]:
    if not line or len(line) > MAX_REQUEST_BYTES:
        raise ProtocolError("protocol request exceeds the safety limit")
    try:
        decoded = line.decode("utf-8")
        payload = json.loads(decoded)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ProtocolError("invalid JSON protocol request") from error
    if not isinstance(payload, dict):
        raise ProtocolError("protocol request must be a JSON object")
    return payload


class JsonLineBuffer:
    """Incrementally frames bounded newline-delimited requests."""

    def __init__(self) -> None:
        self._buffer = bytearray()

    def feed(self, chunk: bytes) -> tuple[bytes, ...]:
        self._buffer.extend(chunk)
        if len(self._buffer) > MAX_REQUEST_BYTES:
            raise ProtocolError("protocol request exceeds the safety limit")

        lines: list[bytes] = []
        while True:
            newline = self._buffer.find(b"\n")
            if newline < 0:
                break
            line = bytes(self._buffer[:newline])
            del self._buffer[: newline + 1]
            if not line:
                raise ProtocolError("empty protocol request")
            lines.append(line)
        return tuple(lines)


class PrivateSocketServer:
    """Owns a single authenticated VOCO app connection."""

    def __init__(self, socket_path: Optional[Path] = None) -> None:
        self.socket_path = runtime_socket_path() if socket_path is None else socket_path
        self.listener: Optional[socket.socket] = None
        self.client: Optional[socket.socket] = None
        self.client_buffer = JsonLineBuffer()
        self.negotiated = False

    def start(self) -> socket.socket:
        secure_socket_directory(self.socket_path)
        self._remove_stale_socket()
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            listener.bind(str(self.socket_path))
            os.chmod(self.socket_path, 0o600)
            listener.listen(2)
            listener.setblocking(False)
        except Exception:
            listener.close()
            raise
        self.listener = listener
        return listener

    def accept(self) -> Optional[socket.socket]:
        if self.listener is None:
            raise ProtocolError("protocol listener is not running")
        connection, _address = self.listener.accept()
        try:
            connection_uid = peer_uid(connection)
        except Exception:
            connection.close()
            raise
        if connection_uid != os.geteuid():
            connection.close()
            raise ProtocolError("protocol peer is owned by another user")
        if self.client is not None:
            try:
                connection.sendall(
                    encode_message(
                        {
                            "version": PROTOCOL_VERSION,
                            "id": None,
                            "ok": False,
                            "error": "VOCO input method is already connected",
                        },
                        MAX_RESPONSE_BYTES,
                    )
                )
            finally:
                connection.close()
            return None
        # GLib calls receive only after the fd is readable. A short timeout
        # lets bounded responses absorb ordinary local backpressure without
        # allowing a stalled same-user client to block the engine indefinitely.
        connection.settimeout(1.0)
        self.client = connection
        self.client_buffer = JsonLineBuffer()
        self.negotiated = False
        return connection

    def receive(self) -> tuple[dict[str, Any], ...]:
        if self.client is None:
            raise ProtocolError("protocol client is not connected")
        chunk = self.client.recv(64 * 1024)
        if not chunk:
            raise EOFError("protocol client disconnected")
        return tuple(decode_request(line) for line in self.client_buffer.feed(chunk))

    def send(self, payload: Mapping[str, Any]) -> None:
        if self.client is None:
            raise ProtocolError("protocol client is not connected")
        self.client.sendall(encode_message(payload, MAX_RESPONSE_BYTES))

    def disconnect(self) -> None:
        if self.client is not None:
            try:
                self.client.close()
            finally:
                self.client = None
        self.client_buffer = JsonLineBuffer()
        self.negotiated = False

    def close(self) -> None:
        self.disconnect()
        if self.listener is not None:
            try:
                self.listener.close()
            finally:
                self.listener = None
        self._unlink_owned_socket()

    def _remove_stale_socket(self) -> None:
        try:
            status = self.socket_path.stat(follow_symlinks=False)
        except FileNotFoundError:
            return
        if not stat.S_ISSOCK(status.st_mode) or status.st_uid != os.geteuid():
            raise ProtocolError("VOCO runtime socket path is unsafe")

        probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            probe.settimeout(0.1)
            probe.connect(str(self.socket_path))
        except (ConnectionRefusedError, FileNotFoundError):
            self.socket_path.unlink(missing_ok=True)
        else:
            raise ProtocolError("another VOCO input method is already running")
        finally:
            probe.close()

    def _unlink_owned_socket(self) -> None:
        try:
            status = self.socket_path.stat(follow_symlinks=False)
        except FileNotFoundError:
            return
        if stat.S_ISSOCK(status.st_mode) and status.st_uid == os.geteuid():
            self.socket_path.unlink(missing_ok=True)
