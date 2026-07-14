#!/usr/bin/python3
"""Persistent VOCO IBus preedit engine.

IBus owns this process after the user explicitly enables the packaged VOCO
input source.  The VOCO app connects over a private same-user socket.  The
engine never changes the desktop's active input source, reads surrounding
text, or requests deletion from a target application.
"""

from __future__ import annotations

import signal
from typing import Any, Optional

import gi

gi.require_version("IBus", "1.0")
from gi.repository import GLib, IBus  # noqa: E402

from voco_ibus_ownership import (  # noqa: E402
    FinalizationAction,
    FinalizationPlan,
    OwnedPreeditLease,
)
from voco_ibus_protocol import (  # noqa: E402
    PROTOCOL_VERSION,
    PrivateSocketServer,
    ProtocolError,
)


ENGINE_NAME = "voco"
ENGINE_BUS_NAME = "org.freedesktop.IBus.Voco"
ENGINE_PATH_PREFIX = "/org/freedesktop/IBus/Voco/Engine/"
MAX_TEXT_BYTES = 1_000_000
SESSION_CONTROL_KEYVALS = {
    IBus.keyval_from_name("Alt_L"),
    IBus.keyval_from_name("Alt_R"),
    IBus.keyval_from_name("Control_L"),
    IBus.keyval_from_name("Control_R"),
    IBus.keyval_from_name("Shift_L"),
    IBus.keyval_from_name("Shift_R"),
    IBus.keyval_from_name("Super_L"),
    IBus.keyval_from_name("Super_R"),
}
SENSITIVE_INPUT_HINT_MASK = int(IBus.InputHints.PRIVATE) | int(
    getattr(IBus.InputHints, "HIDDEN_TEXT", 0)
)
KNOWN_INPUT_HINT_MASK = SENSITIVE_INPUT_HINT_MASK
for _input_hint_name in (
    "SPELLCHECK",
    "NO_SPELLCHECK",
    "WORD_COMPLETION",
    "LOWERCASE",
    "UPPERCASE_CHARS",
    "UPPERCASE_WORDS",
    "UPPERCASE_SENTENCES",
    "INHIBIT_OSK",
    "VERTICAL_WRITING",
    "EMOJI",
    "NO_EMOJI",
):
    KNOWN_INPUT_HINT_MASK |= int(getattr(IBus.InputHints, _input_hint_name, 0))


class VocoCoordinator:
    """Serializes one app connection, dictation lease, and input context."""

    def __init__(self) -> None:
        self.session_id: Optional[int] = None
        self.focused_engine: Optional[VocoEngine] = None
        self.target_engine: Optional[VocoEngine] = None
        self.committed_text = ""
        self.provisional_text = ""
        self.finalization_pending = False
        self.ownership_intact = True
        self.focus_lost = False

    def activate_engine(self, engine: "VocoEngine") -> None:
        if self.focused_engine is not None and self.focused_engine is not engine:
            self._invalidate_target(self.focused_engine)
        self.focused_engine = engine
        if self.session_id is not None and self.target_engine is not engine:
            self._invalidate_target(self.target_engine)

    def deactivate_engine(self, engine: "VocoEngine") -> None:
        if self.focused_engine is engine:
            self.focused_engine = None
        if self.target_engine is engine and self.session_id is not None:
            self._invalidate_target(engine)

    def disable_engine(self, engine: "VocoEngine") -> None:
        self.deactivate_engine(engine)

    def register_key_event(self, keyval: int, state: int) -> None:
        if self.session_id is None or is_session_control_key(keyval, state):
            return
        # Normal input always passes through. It also ends VOCO's exclusive
        # lease before any later cursor update or finalization can mutate the
        # target. Only VOCO's preedit is cleared; committed text is preserved.
        self.ownership_intact = False
        if self.target_engine is not None:
            self.target_engine.invalidate_context()
            try:
                self.target_engine.clear_preedit()
            except Exception:
                pass
        self.provisional_text = ""

    def register_context_reset(self, engine: "VocoEngine") -> None:
        if self.session_id is None or self.target_engine is not engine:
            return
        self.ownership_intact = False
        engine.invalidate_context()
        self.provisional_text = ""

    def validate_session(self, raw_session_id: Any) -> int:
        if not is_positive_integer(raw_session_id):
            raise ValueError("sessionId must be a positive integer")
        if self.session_id != raw_session_id:
            raise ValueError("stale or inactive session")
        return raw_session_id

    def start(self, client_session_id: Any) -> dict[str, Any]:
        if not is_positive_integer(client_session_id):
            raise ValueError("clientSessionId must be a positive integer")
        if self.session_id is not None:
            raise RuntimeError("active dictation session must be canceled first")

        engine = self.focused_engine
        if engine is None or not engine.focus_active:
            raise RuntimeError(
                "Enable the VOCO Dictation input source and focus a text field first"
            )
        if not engine.can_accept_preedit:
            raise RuntimeError(
                "The focused field does not expose a safe non-sensitive preedit context"
            )

        session_id = client_session_id
        self.session_id = session_id
        self.target_engine = engine
        self.committed_text = ""
        self.provisional_text = ""
        self.finalization_pending = False
        self.ownership_intact = True
        self.focus_lost = False
        engine.bind_session(session_id)
        return self.status()

    def update(
        self,
        session_id: Any,
        confirmed_text: Any,
        preedit_text: Any,
        provisional_text: Any,
    ) -> dict[str, Any]:
        self.validate_session(session_id)
        if self.finalization_pending:
            raise RuntimeError("final cursor commit is already being prepared")
        confirmed_text = validate_text(confirmed_text)
        preedit_text = validate_text(preedit_text)
        provisional_text = validate_text(provisional_text)
        engine = self._require_owned_target()
        if provisional_text != confirmed_text + preedit_text:
            raise ValueError("provisional text does not match its owned ranges")
        if not confirmed_text.startswith(self.committed_text):
            raise ValueError("confirmed text cannot revise an already sealed segment")

        append_text = confirmed_text[len(self.committed_text) :]
        if append_text and not self.provisional_text.startswith(append_text):
            raise ValueError(
                "confirmed text was not an exact prefix of the previously owned preedit"
            )
        engine.advance_preedit(append_text, preedit_text)
        self.committed_text = confirmed_text
        self.provisional_text = preedit_text
        return self.status()

    def commit(self, session_id: Any, text: Any) -> dict[str, Any]:
        self.validate_session(session_id)
        text = validate_text(text)
        engine = self._require_current_target()
        plan = engine.plan_finalization(
            session_id,
            self.committed_text,
            text,
            self.ownership_intact,
        )
        # The only revisable range is VOCO's preedit. Clear it before the pure
        # plan emits at most one non-destructive commit command.
        self.finalization_pending = True
        self.provisional_text = ""
        engine.clear_preedit()
        engine.execute_finalization(plan)
        outcome = {
            FinalizationAction.COMMIT: "committed",
            FinalizationAction.PRESERVE: "preserved",
        }[plan.action]
        result = self.status()
        result["finalizationOutcome"] = outcome
        self._clear_session()
        return result

    def cancel(self, session_id: Any) -> dict[str, Any]:
        self.validate_session(session_id)
        return self._cancel_active()

    def disconnect_client(self) -> None:
        if self.session_id is not None:
            try:
                self._cancel_active()
            except Exception:
                self._clear_session()

    def status(self) -> dict[str, Any]:
        engine_active = (
            self.target_engine is not None
            and self.target_engine is self.focused_engine
            and self.target_engine.focus_active
            and not self.focus_lost
        )
        return {
            "ready": True,
            "setupState": "ready",
            "sessionId": self.session_id,
            "engineActive": engine_active,
            "focusLost": self.focus_lost,
            "progressiveCommitActive": bool(self.committed_text),
            "committedCharacterCount": len(self.committed_text),
            "ownershipIntact": self.ownership_intact,
            "finalizationOutcome": None,
            "error": "",
        }

    def _require_current_target(self) -> "VocoEngine":
        engine = self.target_engine
        if (
            self.focus_lost
            or engine is None
            or engine is not self.focused_engine
            or not engine.focus_active
            or engine.bound_session_id != self.session_id
            or not engine.can_accept_preedit
        ):
            raise RuntimeError("target text field lost focus")
        return engine

    def _require_owned_target(self) -> "VocoEngine":
        engine = self._require_current_target()
        if not self.ownership_intact:
            raise RuntimeError("target cursor context changed during dictation")
        return engine

    def _invalidate_target(self, engine: Optional["VocoEngine"]) -> None:
        if engine is None:
            return
        had_owned_preedit = bool(self.provisional_text)
        self.focus_lost = True
        self.ownership_intact = False
        self.provisional_text = ""
        engine.invalidate_context()
        if had_owned_preedit:
            try:
                engine.clear_preedit()
            except Exception:
                pass

    def _cancel_active(self) -> dict[str, Any]:
        outcome = "none"
        engine = self.target_engine
        had_provisional_text = bool(self.provisional_text)
        try:
            if engine is not None:
                # Preedit is VOCO-owned and may be cleared non-destructively.
                # The engine never deletes or rewrites committed target text.
                engine.clear_preedit()
                if self.committed_text:
                    outcome = "preserved"
                elif had_provisional_text:
                    outcome = "discarded"
            result = self.status()
            result["finalizationOutcome"] = outcome
            return result
        finally:
            self._clear_session()

    def _clear_session(self) -> None:
        if self.target_engine is not None:
            self.target_engine.unbind_session()
        self.session_id = None
        self.target_engine = None
        self.committed_text = ""
        self.provisional_text = ""
        self.finalization_pending = False
        self.ownership_intact = True
        self.focus_lost = False


class VocoEngine(IBus.Engine):
    def __init__(
        self,
        bus: IBus.Bus,
        object_path: str,
        coordinator: VocoCoordinator,
    ) -> None:
        kwargs: dict[str, Any] = {
            "connection": bus.get_connection(),
            "object_path": object_path,
        }
        if hasattr(IBus.Engine.props, "has_focus_id"):
            kwargs["has_focus_id"] = True
        super().__init__(**kwargs)
        self.coordinator = coordinator
        self.ownership_lease = OwnedPreeditLease()
        self.context_revision = 0
        self.focus_active = False
        self.focus_identity: Optional[tuple[str, ...]] = None
        self.bound_session_id: Optional[int] = None
        self._voco_client_capabilities = 0
        # IBus suppresses same-valued SetContentType callbacks. Keep the
        # daemon's cached candidate, but never treat it as proof for a new
        # focus until the revision-bound low-priority barrier has run.
        self._voco_input_purpose = IBus.InputPurpose.FREE_FORM
        self._voco_input_hints = int(IBus.InputHints.NONE)
        self._voco_content_type_known = True
        self._voco_content_type_revision: Optional[int] = None
        self._voco_destroyed = False

    def do_process_key_event(self, keyval: int, _keycode: int, state: int) -> bool:
        self.coordinator.register_key_event(keyval, state)
        return False

    def do_focus_in(self) -> None:
        self._enter_focus(("legacy",))
        self.coordinator.activate_engine(self)

    def do_focus_in_id(self, object_path: str, client: str) -> None:
        self._enter_focus(("id", object_path, client))
        self.coordinator.activate_engine(self)

    def do_focus_out(self) -> None:
        try:
            self._clear_owned_preedit_before_focus_loss()
        finally:
            self._leave_focus()
            self.coordinator.deactivate_engine(self)

    def do_focus_out_id(self, _object_path: str) -> None:
        try:
            self._clear_owned_preedit_before_focus_loss()
        finally:
            self._leave_focus()
            self.coordinator.deactivate_engine(self)

    def _enter_focus(self, identity: tuple[str, ...]) -> None:
        if not self.focus_active:
            self.context_revision += 1
            self.focus_active = True
            self.focus_identity = identity
            self._reset_content_type_proof()
            self._schedule_content_type_promotion()
            return
        if self.bound_session_id is not None:
            # Once text is owned, a legacy callback cannot prove it still
            # names the same target. Only an exact repeated ID is harmless.
            if identity[0] == "id" and identity == self.focus_identity:
                return
            self._replace_focus_identity(identity)
            return
        if self.focus_identity == ("legacy",) and identity[0] == "id":
            # Some clients deliver the legacy callback immediately before the
            # ID-bearing callback for the same focus transition.
            self.focus_identity = identity
            return
        if identity == ("legacy",) or identity == self.focus_identity:
            return

        self._replace_focus_identity(identity)

    def _replace_focus_identity(self, identity: tuple[str, ...]) -> None:
        # A target changed without a matching focus-out. Invalidate before
        # accepting another app command for the new context. Clearing preedit
        # is non-destructive; committed application text is untouched.
        try:
            self._clear_owned_preedit_before_focus_loss()
        except Exception:
            pass
        finally:
            self.context_revision += 1
            self.focus_identity = identity
            self._reset_content_type_proof()
            self._schedule_content_type_promotion()
            self.ownership_lease.invalidate()
            self.coordinator.deactivate_engine(self)

    def _leave_focus(self) -> None:
        if self.focus_active:
            self.context_revision += 1
        self.focus_active = False
        self.focus_identity = None
        self._reset_content_type_proof()
        self.ownership_lease.invalidate()

    def _clear_owned_preedit_before_focus_loss(self) -> None:
        if self.bound_session_id is not None:
            self.clear_preedit()

    def bind_session(self, session_id: int) -> None:
        self.bound_session_id = session_id
        self.ownership_lease.bind_session(session_id, self.context_revision)

    def unbind_session(self) -> None:
        self.bound_session_id = None
        self.ownership_lease.unbind_session()

    def invalidate_context(self) -> None:
        self.ownership_lease.invalidate()

    def do_reset(self) -> None:
        self.coordinator.register_context_reset(self)
        self.clear_preedit()

    def do_enable(self) -> None:
        pass

    def do_disable(self) -> None:
        try:
            self._clear_owned_preedit_before_focus_loss()
        finally:
            self._leave_focus()
            self.coordinator.disable_engine(self)

    def do_destroy(self) -> None:
        if self._voco_destroyed:
            return
        self._voco_destroyed = True
        try:
            try:
                self._clear_owned_preedit_before_focus_loss()
            except Exception:
                pass
            finally:
                self._leave_focus()
                self.coordinator.deactivate_engine(self)
        finally:
            super().destroy()

    @property
    def can_accept_preedit(self) -> bool:
        preedit_supported = bool(
            self._voco_client_capabilities & int(IBus.Capabilite.PREEDIT_TEXT)
        )
        sensitive = self._voco_input_purpose in {
            IBus.InputPurpose.PASSWORD,
            IBus.InputPurpose.PIN,
        }
        sensitive_hint = bool(int(self._voco_input_hints) & SENSITIVE_INPUT_HINT_MASK)
        content_type_is_current = (
            self._voco_content_type_revision == self.context_revision
        )
        return (
            preedit_supported
            and content_type_is_current
            and self._voco_content_type_known
            and not sensitive
            and not sensitive_hint
        )

    def do_set_capabilities(self, capabilities: int) -> None:
        self._voco_client_capabilities = int(capabilities)
        if self.bound_session_id is not None and not self.can_accept_preedit:
            try:
                self.clear_preedit()
            finally:
                self.coordinator.deactivate_engine(self)

    def do_set_content_type(self, purpose: int, hints: int) -> None:
        raw_hints = int(hints)
        try:
            self._voco_input_purpose = IBus.InputPurpose(int(purpose))
            self._voco_content_type_known = not bool(
                raw_hints & ~KNOWN_INPUT_HINT_MASK
            )
        except (TypeError, ValueError, OverflowError):
            self._voco_input_purpose = None
            self._voco_content_type_known = False
        self._voco_input_hints = raw_hints
        self._voco_content_type_revision = (
            self.context_revision if self.focus_active else None
        )
        if self.bound_session_id is not None and not self.can_accept_preedit:
            try:
                self.clear_preedit()
            finally:
                self.coordinator.deactivate_engine(self)

    def _reset_content_type_proof(self) -> None:
        self._voco_content_type_revision = None

    def _schedule_content_type_promotion(self) -> None:
        GLib.idle_add(
            self._promote_content_type_after_focus,
            self.context_revision,
            priority=GLib.PRIORITY_LOW,
        )

    def _promote_content_type_after_focus(self, revision: int) -> bool:
        if self.focus_active and self.context_revision == revision:
            self._voco_content_type_revision = revision
        return GLib.SOURCE_REMOVE

    def set_preedit(self, text: str) -> None:
        value = IBus.Text.new_from_string(text)
        self.update_preedit_text_with_mode(
            value,
            len(text),
            bool(text),
            IBus.PreeditFocusMode.CLEAR,
        )

    def clear_preedit(self) -> None:
        self.update_preedit_text_with_mode(
            IBus.Text.new_from_string(""),
            0,
            False,
            IBus.PreeditFocusMode.CLEAR,
        )

    def commit_value(self, text: str) -> None:
        if text:
            self.commit_text(IBus.Text.new_from_string(text))

    def advance_preedit(self, append_text: str, preedit_text: str) -> None:
        if append_text:
            self.clear_preedit()
            self.commit_value(append_text)
        self.set_preedit(preedit_text)

    def plan_finalization(
        self,
        session_id: int,
        owned_text: str,
        final_text: str,
        ownership_intact: bool,
    ) -> FinalizationPlan:
        return self.ownership_lease.plan(
            session_id,
            self.context_revision,
            ownership_intact,
            owned_text,
            final_text,
        )

    def execute_finalization(self, plan: FinalizationPlan) -> None:
        for command in plan.commands():
            if command.operation == "commit-text":
                self.commit_value(command.text)
            else:
                raise RuntimeError("invalid finalization command")


class VocoFactory(IBus.Factory):
    def __init__(self, bus: IBus.Bus, coordinator: VocoCoordinator) -> None:
        super().__init__(connection=bus.get_connection(), object_path=IBus.PATH_FACTORY)
        self.bus = bus
        self.coordinator = coordinator
        self.next_engine_id = 1

    def do_create_engine(self, engine_name: str) -> VocoEngine:
        if engine_name != ENGINE_NAME:
            raise RuntimeError("unknown VOCO engine")
        path = f"{ENGINE_PATH_PREFIX}{self.next_engine_id}"
        self.next_engine_id += 1
        return VocoEngine(self.bus, path, self.coordinator)


def validate_text(value: Any) -> str:
    if not isinstance(value, str):
        raise ValueError("text must be a string")
    if len(value.encode("utf-8")) > MAX_TEXT_BYTES:
        raise ValueError("text exceeds the VOCO preedit safety limit")
    return value


def is_positive_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and value > 0


def is_session_control_key(keyval: int, state: int) -> bool:
    if int(state) & int(IBus.ModifierType.RELEASE_MASK):
        return True
    if keyval in SESSION_CONTROL_KEYVALS:
        return True
    alt_pressed = bool(int(state) & int(IBus.ModifierType.MOD1_MASK))
    return alt_pressed and keyval in {
        IBus.keyval_from_name("d"),
        IBus.keyval_from_name("D"),
    }


def dispatch_command(
    coordinator: VocoCoordinator,
    command: dict[str, Any],
) -> dict[str, Any]:
    operation = command.get("operation")
    if operation == "start":
        return coordinator.start(command.get("clientSessionId"))
    if operation == "update":
        return coordinator.update(
            command.get("sessionId"),
            command.get("confirmedText"),
            command.get("preeditText"),
            command.get("provisionalText"),
        )
    if operation == "commit":
        return coordinator.commit(command.get("sessionId"), command.get("text"))
    if operation == "cancel":
        return coordinator.cancel(command.get("sessionId"))
    if operation in {"hello", "status"}:
        return coordinator.status()
    raise ValueError("unsupported operation")


def main() -> int:
    IBus.init()
    loop = GLib.MainLoop()
    bus = IBus.Bus()
    if not bus.is_connected():
        return 1

    coordinator = VocoCoordinator()
    _factory = VocoFactory(bus, coordinator)
    name_reply = IBus.BusRequestNameReply(bus.request_name(ENGINE_BUS_NAME, 0))
    if name_reply not in {
        IBus.BusRequestNameReply.PRIMARY_OWNER,
        IBus.BusRequestNameReply.ALREADY_OWNER,
    }:
        return 1

    server = PrivateSocketServer()
    try:
        listener = server.start()
    except (OSError, ProtocolError):
        return 1

    def disconnect_client() -> None:
        coordinator.disconnect_client()
        server.disconnect()

    def handle_client(_source: Any, condition: GLib.IOCondition) -> bool:
        if condition & (GLib.IOCondition.HUP | GLib.IOCondition.ERR):
            disconnect_client()
            return GLib.SOURCE_REMOVE
        try:
            commands = server.receive()
        except BlockingIOError:
            return GLib.SOURCE_CONTINUE
        except (EOFError, OSError, ProtocolError):
            disconnect_client()
            return GLib.SOURCE_REMOVE

        for command in commands:
            request_id = command.get("id")
            close_after_response = False
            try:
                if not is_positive_integer(request_id):
                    close_after_response = True
                    raise ProtocolError("request id must be a positive integer")
                if (
                    not isinstance(command.get("version"), int)
                    or isinstance(command.get("version"), bool)
                    or command.get("version") != PROTOCOL_VERSION
                ):
                    close_after_response = True
                    raise ProtocolError("unsupported VOCO input method protocol version")
                if not server.negotiated:
                    if command.get("operation") != "hello":
                        close_after_response = True
                        raise ProtocolError("protocol hello must be the first request")
                    server.negotiated = True
                result = dispatch_command(coordinator, command)
                server.send(
                    {
                        "version": PROTOCOL_VERSION,
                        "id": request_id,
                        "ok": True,
                        "result": result,
                    }
                )
            except Exception as error:
                try:
                    server.send(
                        {
                            "version": PROTOCOL_VERSION,
                            "id": request_id,
                            "ok": False,
                            "error": str(error),
                        }
                    )
                except (OSError, ProtocolError):
                    close_after_response = True
            if close_after_response:
                disconnect_client()
                return GLib.SOURCE_REMOVE
        return GLib.SOURCE_CONTINUE

    def handle_listener(_source: Any, condition: GLib.IOCondition) -> bool:
        if condition & (GLib.IOCondition.HUP | GLib.IOCondition.ERR):
            loop.quit()
            return GLib.SOURCE_REMOVE
        try:
            client = server.accept()
        except BlockingIOError:
            return GLib.SOURCE_CONTINUE
        except (OSError, ProtocolError):
            return GLib.SOURCE_CONTINUE
        if client is not None:
            GLib.io_add_watch(
                client.fileno(),
                GLib.IOCondition.IN | GLib.IOCondition.HUP | GLib.IOCondition.ERR,
                handle_client,
            )
        return GLib.SOURCE_CONTINUE

    def stop() -> None:
        try:
            coordinator.disconnect_client()
        finally:
            server.close()
            loop.quit()

    GLib.io_add_watch(
        listener.fileno(),
        GLib.IOCondition.IN | GLib.IOCondition.HUP | GLib.IOCondition.ERR,
        handle_listener,
    )
    bus.connect("disconnected", lambda *_args: stop())
    signal.signal(signal.SIGTERM, lambda *_args: stop())
    signal.signal(signal.SIGINT, lambda *_args: stop())
    loop.run()
    server.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
