#!/usr/bin/python3
"""Exercise VOCO against an explicitly isolated headless IBus daemon."""

from __future__ import annotations

import json
import os
import socket
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

import gi

gi.require_version("IBus", "1.0")
from gi.repository import GLib, IBus  # noqa: E402


PROTOCOL_VERSION = 5
TEST_ENGINE_NAME = "voco"


def prepare_component(source: Path, destination: Path, engine_script: Path) -> int:
    component = ET.parse(source)
    command = component.getroot().find("exec")
    if command is None:
        raise RuntimeError("IBus component has no exec element")
    command.text = f"/usr/bin/python3 -u {engine_script}"
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    component.write(destination, encoding="UTF-8", xml_declaration=True)
    return 0


def pump_events(duration: float = 0.1) -> None:
    context = GLib.MainContext.default()
    deadline = time.monotonic() + duration
    while time.monotonic() < deadline:
        while context.pending():
            context.iteration(False)
        time.sleep(0.005)


class EngineRejected(RuntimeError):
    pass


class ProtocolClient:
    def __init__(self, path: Path) -> None:
        self.socket = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.socket.settimeout(2)
        self.socket.connect(str(path))
        self.reader = self.socket.makefile("rb")
        self.next_id = 1
        self.request("hello")

    def request(self, operation: str, **values: Any) -> dict[str, Any]:
        request_id = self.next_id
        self.next_id += 1
        payload = {
            "version": PROTOCOL_VERSION,
            "id": request_id,
            "operation": operation,
            **values,
        }
        self.socket.sendall(
            json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode()
            + b"\n"
        )
        line = self.reader.readline()
        if not line:
            raise RuntimeError("private VOCO engine disconnected")
        response = json.loads(line)
        if response.get("version") != PROTOCOL_VERSION:
            raise RuntimeError("private VOCO protocol version mismatch")
        if response.get("id") != request_id:
            raise RuntimeError("private VOCO response order mismatch")
        if not response.get("ok"):
            raise EngineRejected(response.get("error") or "engine rejected request")
        result = response.get("result")
        if not isinstance(result, dict):
            raise RuntimeError("private VOCO response was not a status object")
        return result

    def close(self) -> None:
        self.reader.close()
        self.socket.close()


def wait_for_socket(path: Path) -> None:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        pump_events(0.05)
        if path.is_socket():
            return
    raise RuntimeError("private VOCO engine socket did not appear")


def main() -> int:
    address = os.environ.get("IBUS_ADDRESS", "")
    runtime_dir = Path(os.environ.get("XDG_RUNTIME_DIR", ""))
    expected_bus_socket = runtime_dir / "private-ibus.sock"
    if (
        not runtime_dir.is_absolute()
        or str(expected_bus_socket) not in address
        or "DISPLAY" in os.environ
        or "WAYLAND_DISPLAY" in os.environ
        or "DBUS_SESSION_BUS_ADDRESS" in os.environ
    ):
        raise RuntimeError("private IBus isolation environment is incomplete")
    if not expected_bus_socket.is_socket():
        raise RuntimeError("private IBus daemon socket is unavailable")

    IBus.init()
    bus = IBus.Bus()
    if not bus.is_connected():
        raise RuntimeError("could not connect to the private IBus daemon")

    engine_names = {engine.get_name() for engine in bus.list_engines()}
    if TEST_ENGINE_NAME not in engine_names:
        raise RuntimeError("private IBus daemon did not register the test component")
    if not bus.preload_engines([TEST_ENGINE_NAME]):
        raise RuntimeError("private IBus daemon did not preload the test component")
    pump_events(0.2)
    if not bus.set_global_engine(TEST_ENGINE_NAME):
        raise RuntimeError("private IBus daemon did not activate the test component")
    pump_events(0.2)

    context = bus.create_input_context("voco-private-headless-test")
    preedits: list[tuple[str, bool]] = []
    commits: list[str] = []
    deletions: list[tuple[int, int]] = []
    context.connect(
        "update-preedit-text",
        lambda _context, text, _cursor, visible: preedits.append(
            (text.get_text(), bool(visible))
        ),
    )
    context.connect(
        "commit-text",
        lambda _context, text: commits.append(text.get_text()),
    )
    context.connect(
        "delete-surrounding-text",
        lambda _context, offset, count: deletions.append((offset, count)),
    )
    context.set_capabilities(
        int(IBus.Capabilite.FOCUS) | int(IBus.Capabilite.PREEDIT_TEXT)
    )
    context.set_content_type(
        IBus.InputPurpose.FREE_FORM, IBus.InputHints.SPELLCHECK
    )
    context.set_engine(TEST_ENGINE_NAME)
    context.focus_in()
    engine_deadline = time.monotonic() + 5
    while time.monotonic() < engine_deadline:
        pump_events(0.05)
        active_engine = context.get_engine()
        if active_engine is not None and active_engine.get_name() == TEST_ENGINE_NAME:
            break
    else:
        raise RuntimeError("private input context did not attach the VOCO engine")
    pump_events(0.2)

    engine_socket = runtime_dir / "voco" / "ibus-engine.sock"
    wait_for_socket(engine_socket)
    client = ProtocolClient(engine_socket)
    pump_events(0.2)

    status = client.request("status")
    assert status["setupState"] == "safety-disabled" and not status["ready"]
    assert "original text field" in status["error"]
    rejected = []
    for attempt in range(3):
        assert client.request("poll-trigger", hotkey="Alt+D")["armed"]
        assert context.process_key_event(ord("d"), 40, int(IBus.ModifierType.MOD1_MASK))
        assert context.process_key_event(ord("d"), 40, int(IBus.ModifierType.MOD1_MASK | IBus.ModifierType.RELEASE_MASK))
        pump_events(0.02)
        trigger = client.request("poll-trigger", hotkey="Alt+D")["trigger"]
        assert trigger and trigger["mode"] == "dictation"
        assert client.request("poll-trigger", hotkey="Alt+D")["trigger"] is None
        for operation, values in [
            ("start", dict(clientSessionId=10001, triggerId=trigger["triggerId"])),
            ("start", dict(clientSessionId=10001)),
            ("update", dict(sessionId=10001, confirmedText="", preeditText="draft", provisionalText="draft")),
            ("commit", dict(sessionId=10001, text="never insert")),
            ("checkpoint", dict(sessionId=10001, expectedCommittedText="", appendText="never insert")),
            ("finish-canonical", dict(sessionId=10001, expectedCommittedText="", appendText="never insert")),
            ("cancel", dict(sessionId=10001)),
        ]:
            before = (list(preedits), list(commits), list(deletions))
            try:
                client.request(operation, **values)
            except EngineRejected as error:
                assert "original text field" in str(error), str(error)
            else:
                raise AssertionError(operation + " unexpectedly accepted")
            pump_events(0.03)
            assert (preedits, commits, deletions) == before, operation + " emitted a target mutation"
            rejected.append(operation)
        assert client.request("status")["sessionId"] is None
    client.close()
    pump_events(0.1)
    assert not commits and not deletions
    context.focus_out()
    context.destroy()
    print(json.dumps(dict(outcome="passed", consumingShortcuts=3, rejectedOperations=rejected,
                         targetCommits=commits, targetDeletions=deletions)))
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "--prepare-component":
        raise SystemExit(
            prepare_component(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))
        )
    raise SystemExit(main())
