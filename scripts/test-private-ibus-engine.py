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


PROTOCOL_VERSION = 3
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

    session_id = 10_001
    started = client.request("start", clientSessionId=session_id)
    if started.get("sessionId") != session_id or not started.get("engineActive"):
        raise RuntimeError("private VOCO engine did not bind the focused context")

    client.request(
        "update",
        sessionId=session_id,
        confirmedText="",
        preeditText="stable provisional",
        provisionalText="stable provisional",
    )
    pump_events()
    client.request(
        "update",
        sessionId=session_id,
        confirmedText="stable ",
        preeditText="tail",
        provisionalText="stable tail",
    )
    pump_events()
    finalized = client.request(
        "commit",
        sessionId=session_id,
        text="authoritative mismatch",
    )
    pump_events()
    if finalized.get("finalizationOutcome") != "preserved":
        raise RuntimeError("mismatched progressive final was not preserved")
    if commits != ["stable ", "tail"]:
        raise RuntimeError("private IBus commit sequence was not exact")
    if deletions:
        raise RuntimeError("private IBus engine emitted a deletion request")
    if not any(text == "stable provisional" and visible for text, visible in preedits):
        raise RuntimeError("private IBus context did not receive provisional text")

    # Without progressive commits, an exact final clears only VOCO's preedit
    # and becomes normal application text.
    exact_session = 10_002
    client.request("start", clientSessionId=exact_session)
    client.request(
        "update",
        sessionId=exact_session,
        confirmedText="",
        preeditText="exact provisional",
        provisionalText="exact provisional",
    )
    exact_final = client.request(
        "commit",
        sessionId=exact_session,
        text="exact authoritative final",
    )
    pump_events()
    if exact_final.get("finalizationOutcome") != "committed":
        raise RuntimeError("exact final was not committed")
    if commits[-1] != "exact authoritative final":
        raise RuntimeError("exact final commit sequence was not preserved")

    # Canonical checkpoints clear only VOCO's draft, append an exact
    # authoritative suffix, and retain the same focused lease.
    canonical_session = 20_001
    client.request("start", clientSessionId=canonical_session)
    client.request(
        "update",
        sessionId=canonical_session,
        confirmedText="",
        preeditText="canonical draft one",
        provisionalText="canonical draft one",
    )
    pump_events()
    commit_count = len(commits)
    empty_checkpoint = client.request(
        "checkpoint",
        sessionId=canonical_session,
        expectedCommittedText="",
        appendText="",
    )
    pump_events()
    if empty_checkpoint.get("sessionId") != canonical_session:
        raise RuntimeError("empty canonical checkpoint released the active lease")
    if len(commits) != commit_count or not preedits or preedits[-1] != ("", False):
        raise RuntimeError("empty canonical checkpoint did not clear only the draft")

    client.request(
        "update",
        sessionId=canonical_session,
        confirmedText="",
        preeditText="canonical draft two",
        provisionalText="canonical draft two",
    )
    checkpoint = client.request(
        "checkpoint",
        sessionId=canonical_session,
        expectedCommittedText="",
        appendText="canonical checkpoint ",
    )
    pump_events()
    if checkpoint.get("sessionId") != canonical_session:
        raise RuntimeError("canonical checkpoint did not retain the active lease")
    if checkpoint.get("committedCharacterCount") != len("canonical checkpoint "):
        raise RuntimeError("canonical checkpoint status did not acknowledge exact text")
    if commits[-1] != "canonical checkpoint ":
        raise RuntimeError("canonical checkpoint did not commit its exact suffix")

    # A stale acknowledgement is rejected before clearing preedit or emitting
    # any normal application text.
    client.request(
        "update",
        sessionId=canonical_session,
        confirmedText="canonical checkpoint ",
        preeditText="canonical draft two",
        provisionalText="canonical checkpoint canonical draft two",
    )
    pump_events()
    commit_count = len(commits)
    preedit_count = len(preedits)
    try:
        client.request(
            "checkpoint",
            sessionId=canonical_session,
            expectedCommittedText="wrong canonical prefix",
            appendText="forbidden append",
        )
    except EngineRejected:
        pass
    else:
        raise RuntimeError("mismatched canonical acknowledgement was accepted")
    pump_events()
    if len(commits) != commit_count or len(preedits) != preedit_count or deletions:
        raise RuntimeError("mismatched canonical checkpoint mutated the target")

    canonical_final = client.request(
        "finish-canonical",
        sessionId=canonical_session,
        expectedCommittedText="canonical checkpoint ",
        appendText="canonical final",
    )
    pump_events()
    if canonical_final.get("finalizationOutcome") != "committed":
        raise RuntimeError("canonical final did not report a committed outcome")
    if commits[-2:] != ["canonical checkpoint ", "canonical final"]:
        raise RuntimeError("canonical checkpoint and final sequence was not exact")
    if deletions:
        raise RuntimeError("canonical final emitted a deletion request")

    # Cancellation after a checkpoint preserves normal committed text and
    # discards only the current VOCO preedit.
    cancel_session = 20_002
    client.request("start", clientSessionId=cancel_session)
    client.request(
        "update",
        sessionId=cancel_session,
        confirmedText="",
        preeditText="canonical canceled draft",
        provisionalText="canonical canceled draft",
    )
    client.request(
        "checkpoint",
        sessionId=cancel_session,
        expectedCommittedText="",
        appendText="canonical preserved",
    )
    client.request(
        "update",
        sessionId=cancel_session,
        confirmedText="canonical preserved",
        preeditText="canonical canceled draft",
        provisionalText="canonical preservedcanonical canceled draft",
    )
    canceled = client.request("cancel", sessionId=cancel_session)
    pump_events()
    if canceled.get("finalizationOutcome") != "preserved":
        raise RuntimeError("canonical cancel did not preserve checkpoint text")
    if commits[-1] != "canonical preserved":
        raise RuntimeError("canonical cancel committed its discarded draft")
    if not preedits or preedits[-1] != ("", False) or deletions:
        raise RuntimeError("canonical cancel did not clear only the owned draft")

    # Focus loss invalidates the old lease before a delayed final can mutate.
    focus_session = 10_003
    client.request("start", clientSessionId=focus_session)
    client.request(
        "update",
        sessionId=focus_session,
        confirmedText="",
        preeditText="focus-owned tail",
        provisionalText="focus-owned tail",
    )
    context.focus_out()
    pump_events(0.2)
    commit_count = len(commits)
    try:
        client.request("commit", sessionId=focus_session, text="delayed final")
    except EngineRejected:
        pass
    else:
        raise RuntimeError("focus-lost finalization was accepted")
    if len(commits) != commit_count or deletions:
        raise RuntimeError("focus-lost finalization mutated the target")
    client.request("cancel", sessionId=focus_session)

    # IBus's global engine proxy suppresses an unchanged content tuple on the
    # next focus. The engine must not treat its old safe tuple as fresh proof.
    context.focus_in()
    pump_events(0.2)
    unchanged_safe_tuple = 10_004
    try:
        client.request("start", clientSessionId=unchanged_safe_tuple)
    except EngineRejected:
        pass
    else:
        raise RuntimeError("unchanged cached content renewed a VOCO lease")

    # A changed explicit safe report is forwarded and restores the legitimate
    # owned-preedit path for this exact focus epoch.
    safe_hints = IBus.InputHints.SPELLCHECK | IBus.InputHints.WORD_COMPLETION
    context.set_content_type(
        IBus.InputPurpose.FREE_FORM,
        safe_hints,
    )
    pump_events(0.1)
    fresh_safe_session = 10_005
    client.request("start", clientSessionId=fresh_safe_session)
    client.request("cancel", sessionId=fresh_safe_session)

    # Ambiguous default metadata revokes even an established safe proof. A
    # later changed, explicit safe tuple can establish it again.
    context.set_content_type(IBus.InputPurpose.FREE_FORM, IBus.InputHints.NONE)
    pump_events(0.1)
    try:
        client.request("start", clientSessionId=10_006)
    except EngineRejected:
        pass
    else:
        raise RuntimeError("ambiguous default content retained a VOCO lease")
    context.set_content_type(
        IBus.InputPurpose.FREE_FORM, IBus.InputHints.SPELLCHECK
    )
    pump_events(0.1)
    recovered_safe_session = 10_007
    client.request("start", clientSessionId=recovered_safe_session)
    client.request("cancel", sessionId=recovered_safe_session)

    # Sensitive and terminal purposes remain ineligible for owned preedit.
    context.focus_out()
    context.focus_in()
    context.set_content_type(IBus.InputPurpose.PASSWORD, IBus.InputHints.NONE)
    pump_events(0.2)
    try:
        client.request("start", clientSessionId=10_008)
    except EngineRejected:
        pass
    else:
        raise RuntimeError("password input context acquired a VOCO lease")

    context.set_content_type(IBus.InputPurpose.FREE_FORM, IBus.InputHints.PRIVATE)
    pump_events(0.1)
    try:
        client.request("start", clientSessionId=10_009)
    except EngineRejected:
        pass
    else:
        raise RuntimeError("private input context acquired a VOCO lease")

    context.set_content_type(
        getattr(IBus.InputPurpose, "TERMINAL", 10),
        IBus.InputHints.NONE,
    )
    pump_events(0.1)
    try:
        client.request("start", clientSessionId=10_010)
    except EngineRejected:
        pass
    else:
        raise RuntimeError("terminal input context acquired a VOCO lease")

    # Ordinary keys pass through and invalidate the lease before another update.
    context.focus_out()
    pump_events(0.1)
    context.focus_in()
    context.set_content_type(
        IBus.InputPurpose.FREE_FORM, IBus.InputHints.SPELLCHECK
    )
    pump_events(0.2)
    key_session = 10_011
    client.request("start", clientSessionId=key_session)
    client.request(
        "update",
        sessionId=key_session,
        confirmedText="",
        preeditText="key-owned tail",
        provisionalText="key-owned tail",
    )
    if context.process_key_event(ord("x"), 53, 0):
        raise RuntimeError("persistent VOCO engine consumed an ordinary key")
    pump_events(0.2)
    try:
        client.request(
            "update",
            sessionId=key_session,
            confirmedText="",
            preeditText="stale tail",
            provisionalText="stale tail",
        )
    except EngineRejected:
        pass
    else:
        raise RuntimeError("ordinary key input did not invalidate the VOCO lease")
    client.request("cancel", sessionId=key_session)

    # Reset invalidates the lease and clears only preedit.
    reset_session = 10_012
    client.request("start", clientSessionId=reset_session)
    client.request(
        "update",
        sessionId=reset_session,
        confirmedText="",
        preeditText="reset-owned tail",
        provisionalText="reset-owned tail",
    )
    context.reset()
    pump_events(0.2)
    commit_count = len(commits)
    try:
        client.request(
            "update",
            sessionId=reset_session,
            confirmedText="",
            preeditText="delayed reset tail",
            provisionalText="delayed reset tail",
        )
    except EngineRejected:
        pass
    else:
        raise RuntimeError("reset input context retained a VOCO lease")
    if len(commits) != commit_count or deletions:
        raise RuntimeError("reset input context mutated target text")
    client.request("cancel", sessionId=reset_session)

    # Selecting another private-daemon input source disables/destroys VOCO's
    # target engine. Delayed app commands cannot follow the replacement.
    fallback_engine = next(
        (name for name in sorted(engine_names) if name != TEST_ENGINE_NAME),
        None,
    )
    if fallback_engine is None:
        raise RuntimeError("private IBus daemon has no fallback engine for source-switch test")
    selection_session = 10_013
    client.request("start", clientSessionId=selection_session)
    client.request(
        "update",
        sessionId=selection_session,
        confirmedText="",
        preeditText="selection-owned tail",
        provisionalText="selection-owned tail",
    )
    commit_count = len(commits)
    context.set_engine(fallback_engine)
    pump_events(0.2)
    try:
        client.request(
            "update",
            sessionId=selection_session,
            confirmedText="",
            preeditText="delayed selection tail",
            provisionalText="delayed selection tail",
        )
    except EngineRejected:
        pass
    else:
        raise RuntimeError("source selection retained a VOCO lease")
    if len(commits) != commit_count or deletions:
        raise RuntimeError("source selection mutated target text")
    client.request("cancel", sessionId=selection_session)

    context.set_engine(TEST_ENGINE_NAME)
    engine_deadline = time.monotonic() + 5
    while time.monotonic() < engine_deadline:
        pump_events(0.05)
        active_engine = context.get_engine()
        if active_engine is not None and active_engine.get_name() == TEST_ENGINE_NAME:
            break
    else:
        raise RuntimeError("private input context did not reattach VOCO after source switch")
    context.set_content_type(
        IBus.InputPurpose.FREE_FORM, IBus.InputHints.SPELLCHECK
    )
    pump_events(0.2)

    # Closing the target destroys its engine. A delayed final must be rejected,
    # and a new context must acquire a fresh session and content-type proof.
    destroy_session = 10_014
    client.request("start", clientSessionId=destroy_session)
    client.request(
        "update",
        sessionId=destroy_session,
        confirmedText="",
        preeditText="destroy-owned tail",
        provisionalText="destroy-owned tail",
    )
    commit_count = len(commits)
    context.destroy()
    pump_events(0.2)
    try:
        client.request("commit", sessionId=destroy_session, text="delayed closed final")
    except EngineRejected:
        pass
    else:
        raise RuntimeError("destroyed target accepted delayed finalization")
    if len(commits) != commit_count or deletions:
        raise RuntimeError("destroyed target finalization mutated target text")
    client.request("cancel", sessionId=destroy_session)

    disconnect_context = bus.create_input_context("voco-private-disconnect-test")
    disconnect_context.connect(
        "update-preedit-text",
        lambda _context, text, _cursor, visible: preedits.append(
            (text.get_text(), bool(visible))
        ),
    )
    disconnect_context.connect(
        "commit-text",
        lambda _context, text: commits.append(text.get_text()),
    )
    disconnect_context.connect(
        "delete-surrounding-text",
        lambda _context, offset, count: deletions.append((offset, count)),
    )
    disconnect_context.set_capabilities(
        int(IBus.Capabilite.FOCUS) | int(IBus.Capabilite.PREEDIT_TEXT)
    )
    disconnect_context.set_engine(TEST_ENGINE_NAME)
    disconnect_context.focus_in()
    engine_deadline = time.monotonic() + 5
    while time.monotonic() < engine_deadline:
        pump_events(0.05)
        active_engine = disconnect_context.get_engine()
        if active_engine is not None and active_engine.get_name() == TEST_ENGINE_NAME:
            break
    else:
        raise RuntimeError("replacement private input context did not attach VOCO")
    pump_events(0.2)

    # A PREEDIT-capable client is not enough: every newly focused toolkit
    # context must explicitly disclose a known, non-sensitive content type.
    try:
        client.request("start", clientSessionId=10_015)
    except EngineRejected:
        pass
    else:
        raise RuntimeError("untyped input context acquired a VOCO lease")
    disconnect_context.focus_out()
    disconnect_context.set_content_type(
        IBus.InputPurpose.FREE_FORM, IBus.InputHints.SPELLCHECK
    )
    disconnect_context.focus_in()
    pump_events(0.2)

    # App disconnect clears the remaining owned preedit without target deletion.
    disconnect_session = 10_016
    client.request("start", clientSessionId=disconnect_session)
    client.request(
        "update",
        sessionId=disconnect_session,
        confirmedText="",
        preeditText="disconnect-owned tail",
        provisionalText="disconnect-owned tail",
    )
    pump_events(0.1)
    commit_count = len(commits)
    client.close()
    pump_events(0.2)
    if len(commits) != commit_count:
        raise RuntimeError("app disconnect committed target text")
    if not preedits or preedits[-1] != ("", False):
        raise RuntimeError("app disconnect did not clear owned preedit")

    disconnect_context.focus_out()
    disconnect_context.destroy()
    pump_events(0.2)
    if deletions:
        raise RuntimeError("private IBus engine emitted a deletion request")
    print("Private headless IBus engine lifecycle passed.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) == 5 and sys.argv[1] == "--prepare-component":
        raise SystemExit(
            prepare_component(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]))
        )
    raise SystemExit(main())
