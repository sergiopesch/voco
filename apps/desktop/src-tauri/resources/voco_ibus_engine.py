#!/usr/bin/python3
"""VOCO-owned IBus preedit engine.

The parent VOCO process owns this sidecar over stdin/stdout. Only structured
status is returned; transcript text is never written to logs or responses.
"""

from __future__ import annotations

import json
import signal
import sys
from typing import Any, Optional

import gi

gi.require_version("IBus", "1.0")
from gi.repository import GLib, IBus  # noqa: E402

from voco_ibus_ownership import (  # noqa: E402
    FinalizationAction,
    FinalizationPlan,
    OwnedPreeditLease,
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


def write_response(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def current_engine_name(bus: IBus.Bus) -> str:
    engine = bus.get_global_engine()
    return engine.get_name() if engine is not None else ""


class VocoCoordinator:
    def __init__(
        self,
        bus: IBus.Bus,
        loop: GLib.MainLoop,
        default_engine: str,
    ) -> None:
        self.bus = bus
        self.loop = loop
        self.default_engine = default_engine
        self.session_id: Optional[int] = None
        self.previous_engine = ""
        self.target_engine: Optional[VocoEngine] = None
        self.confirmed_text = ""
        self.committed_text = ""
        self.provisional_text = ""
        self.finalization_pending = False
        self.ownership_intact = True
        self.focus_lost = False
        self.switching = False
        self.switch_error = ""
        self.restore_attempts = 0
        self.shutdown_requested = False
        self.lifecycle_generation = 0

    def activate_engine(self, engine: "VocoEngine") -> None:
        if self.session_id is None:
            return
        if self.target_engine is None:
            self.target_engine = engine
            self.focus_lost = False
            engine.bind_session(self.session_id)
            if self.provisional_text:
                engine.set_preedit(self.provisional_text)
        elif self.target_engine is not engine:
            self.focus_lost = True

    def deactivate_engine(self, engine: "VocoEngine") -> None:
        if self.target_engine is engine and self.session_id is not None:
            self.focus_lost = True

    def register_key_event(self, keyval: int, state: int) -> None:
        if self.session_id is None or is_session_control_key(keyval, state):
            return
        # User input is allowed to pass through, but it ends VOCO's exclusive
        # ownership lease. Finalization then preserves normal target text.
        self.ownership_intact = False
        if self.target_engine is not None:
            self.target_engine.invalidate_context()

    def register_context_reset(self, engine: "VocoEngine") -> None:
        if self.session_id is None or self.target_engine is not engine:
            return
        # IBus reset is the only portable signal for cursor/selection changes
        # inside one focused client. Once observed, stop all target mutation.
        self.ownership_intact = False
        engine.invalidate_context()

    def validate_session(self, raw_session_id: Any) -> int:
        if not isinstance(raw_session_id, int) or raw_session_id <= 0:
            raise ValueError("sessionId must be a positive integer")
        if self.session_id != raw_session_id:
            raise ValueError("stale or inactive session")
        return raw_session_id

    def start(self, session_id: Any) -> dict[str, Any]:
        if not isinstance(session_id, int) or session_id <= 0:
            raise ValueError("sessionId must be a positive integer")
        if self.session_id is not None:
            self.cancel(self.session_id)

        current = current_engine_name(self.bus)
        if current and current != ENGINE_NAME:
            self.default_engine = current
        self.previous_engine = (
            current if current and current != ENGINE_NAME else self.default_engine
        )
        self.session_id = session_id
        self.lifecycle_generation += 1
        self.target_engine = None
        self.confirmed_text = ""
        self.committed_text = ""
        self.provisional_text = ""
        self.finalization_pending = False
        self.ownership_intact = True
        self.focus_lost = False
        self.switching = True
        self.switch_error = ""
        self.bus.set_global_engine_async(
            ENGINE_NAME,
            1_000,
            None,
            self._finish_engine_switch,
            self.lifecycle_generation,
        )

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
        if self.focus_lost or self.target_engine is None:
            raise RuntimeError("target text field is not connected to VOCO")
        if not self.ownership_intact:
            raise RuntimeError("target cursor context changed during dictation")
        if provisional_text != confirmed_text + preedit_text:
            raise ValueError("provisional text does not match its owned ranges")
        if not confirmed_text.startswith(self.confirmed_text):
            raise ValueError("confirmed text cannot revise an already sealed segment")

        engine = self.target_engine
        if not confirmed_text.startswith(self.committed_text):
            raise ValueError("confirmed text does not extend committed target text")
        append_text = confirmed_text[len(self.committed_text) :]
        engine.advance_preedit(append_text, preedit_text)
        self.committed_text = confirmed_text
        self.provisional_text = preedit_text
        self.confirmed_text = confirmed_text
        return self.status()

    def commit(self, session_id: Any, text: Any) -> dict[str, Any]:
        self.validate_session(session_id)
        text = validate_text(text)
        if self.focus_lost or self.target_engine is None:
            raise RuntimeError("target text field lost focus before final commit")

        engine = self.target_engine
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
        previous_engine = self.previous_engine
        restore_generation = self.lifecycle_generation
        self._clear_session()
        GLib.timeout_add(
            50,
            self._restore_engine_once,
            previous_engine,
            restore_generation,
        )
        return result

    def cancel(self, session_id: Any) -> dict[str, Any]:
        self.validate_session(session_id)
        outcome = "none"
        if self.target_engine is not None:
            had_provisional_text = bool(self.provisional_text)
            self.target_engine.clear_preedit()
            if self.committed_text:
                # Progressive commits are already normal target text. Cancel,
                # teardown, and error recovery never delete them.
                outcome = "preserved"
            elif had_provisional_text:
                outcome = "discarded"
        result = self.status()
        result["finalizationOutcome"] = outcome
        previous_engine = self.previous_engine
        restore_generation = self.lifecycle_generation
        self._clear_session()
        GLib.timeout_add(
            0,
            self._restore_engine_once,
            previous_engine,
            restore_generation,
        )
        return result

    def status(self) -> dict[str, Any]:
        return {
            "ready": True,
            "sessionId": self.session_id,
            "engineActive": self.target_engine is not None and not self.focus_lost,
            "focusLost": self.focus_lost,
            "switching": self.switching,
            "progressiveCommitActive": bool(self.committed_text),
            "committedCharacterCount": len(self.committed_text),
            "ownershipIntact": self.ownership_intact,
            "finalizationOutcome": None,
            "error": self.switch_error,
            "currentEngine": current_engine_name(self.bus),
            "defaultEngine": self.default_engine,
        }

    def shutdown(self) -> dict[str, Any]:
        self.shutdown_requested = True
        if self.session_id is not None:
            try:
                self.cancel(self.session_id)
            except Exception:
                self._clear_session()
        else:
            GLib.timeout_add(
                0,
                self._restore_engine_once,
                self.default_engine,
                self.lifecycle_generation,
            )
        # The callback normally quits immediately after restoration. This is a
        # bounded fallback for a disconnected or unresponsive IBus daemon.
        GLib.timeout_add(500, self._quit_once)
        return {"ready": False}

    def _clear_session(self) -> None:
        if self.target_engine is not None:
            self.target_engine.unbind_session()
        self.session_id = None
        self.previous_engine = ""
        self.target_engine = None
        self.confirmed_text = ""
        self.committed_text = ""
        self.provisional_text = ""
        self.finalization_pending = False
        self.ownership_intact = True
        self.focus_lost = False
        self.switching = False
        self.switch_error = ""

    def _finish_engine_switch(
        self,
        bus: IBus.Bus,
        result: Any,
        generation: Any,
    ) -> None:
        switch_error = ""
        try:
            switched = bool(bus.set_global_engine_async_finish(result))
            if not switched:
                raise RuntimeError("IBus refused the VOCO engine")
        except Exception as error:
            switch_error = str(error)
        if generation != self.lifecycle_generation:
            return
        self.switch_error = switch_error
        self.switching = False

    def _restore_engine_once(self, engine_name: str, generation: int) -> bool:
        if not self.shutdown_requested and generation != self.lifecycle_generation:
            return GLib.SOURCE_REMOVE
        current_engine = current_engine_name(self.bus)
        if engine_name and (current_engine == ENGINE_NAME or not current_engine):
            try:
                restored = bool(self.bus.set_global_engine(engine_name))
            except Exception:
                restored = False
            if not restored and self.shutdown_requested and self.restore_attempts < 4:
                self.restore_attempts += 1
                GLib.timeout_add(
                    50,
                    self._restore_engine_once,
                    engine_name,
                    generation,
                )
                return GLib.SOURCE_REMOVE
        if self.shutdown_requested:
            self.loop.quit()
        return GLib.SOURCE_REMOVE

    def _quit_once(self) -> bool:
        self.loop.quit()
        return GLib.SOURCE_REMOVE


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
        self._leave_focus()
        self.coordinator.deactivate_engine(self)

    def do_focus_out_id(self, _object_path: str) -> None:
        self._leave_focus()
        self.coordinator.deactivate_engine(self)

    def _enter_focus(self, identity: tuple[str, ...]) -> None:
        if not self.focus_active:
            self.context_revision += 1
            self.focus_active = True
            self.focus_identity = identity
            return
        if self.focus_identity == ("legacy",) and identity[0] == "id":
            # Some clients deliver the legacy callback immediately before the
            # ID-bearing callback for the same focus transition.
            self.focus_identity = identity
            return
        if identity == ("legacy",) or identity == self.focus_identity:
            return

        # An ID-bearing target changed without a matching focus-out. Preserve
        # target text and invalidate the active session rather than carrying
        # an ownership lease into the new input context.
        self.context_revision += 1
        self.focus_identity = identity
        self.ownership_lease.invalidate()
        self.coordinator.deactivate_engine(self)

    def _leave_focus(self) -> None:
        if self.focus_active:
            self.context_revision += 1
        self.focus_active = False
        self.focus_identity = None
        self.ownership_lease.invalidate()

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


def is_session_control_key(keyval: int, state: int) -> bool:
    if keyval in SESSION_CONTROL_KEYVALS:
        return True
    alt_pressed = bool(int(state) & int(IBus.ModifierType.MOD1_MASK))
    return alt_pressed and keyval in {
        IBus.keyval_from_name("d"),
        IBus.keyval_from_name("D"),
    }


def register_component(bus: IBus.Bus) -> None:
    component = IBus.Component(
        name=ENGINE_BUS_NAME,
        description="VOCO owned dictation preedit",
        version="1",
        license="MIT",
        author="VOCO Contributors",
        homepage="https://github.com/sergiopesch/voco",
        textdomain="voco",
    )
    component.add_engine(
        IBus.EngineDesc(
            name=ENGINE_NAME,
            longname="VOCO Dictation",
            description="Automatic local dictation at the cursor",
            language="en",
            license="MIT",
            author="VOCO Contributors",
            icon="",
            layout="default",
            symbol="VO",
            rank=0,
        )
    )
    bus.register_component(component)
    bus.request_name(ENGINE_BUS_NAME, 0)


def dispatch_command(coordinator: VocoCoordinator, command: dict[str, Any]) -> dict[str, Any]:
    operation = command.get("operation")
    if operation == "start":
        return coordinator.start(command.get("sessionId"))
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
    if operation == "status":
        return coordinator.status()
    if operation == "shutdown":
        return coordinator.shutdown()
    raise ValueError("unsupported operation")


def main() -> int:
    IBus.init()
    loop = GLib.MainLoop()
    bus = IBus.Bus()
    if not bus.is_connected():
        write_response({"event": "startup", "ok": False, "error": "IBus is unavailable"})
        return 1

    # Dynamic component registration can temporarily clear the global engine.
    # Capture the user's engine first so every exit path can restore it.
    default_engine = current_engine_name(bus)
    if not default_engine:
        write_response(
            {
                "event": "startup",
                "ok": False,
                "error": "IBus has no active desktop input engine",
            }
        )
        return 1
    coordinator = VocoCoordinator(bus, loop, default_engine)
    factory = VocoFactory(bus, coordinator)
    register_component(bus)
    if default_engine and not current_engine_name(bus):
        if not bus.set_global_engine(default_engine):
            write_response(
                {
                    "event": "startup",
                    "ok": False,
                    "error": "IBus did not restore the desktop input engine",
                }
            )
            return 1

    def handle_stdin(_source: Any, condition: GLib.IOCondition) -> bool:
        if condition & (GLib.IOCondition.HUP | GLib.IOCondition.ERR):
            coordinator.shutdown()
            return GLib.SOURCE_REMOVE
        line = sys.stdin.readline()
        if not line:
            coordinator.shutdown()
            return GLib.SOURCE_REMOVE
        request_id: Any = None
        try:
            command = json.loads(line)
            if not isinstance(command, dict):
                raise ValueError("command must be a JSON object")
            request_id = command.get("id")
            result = dispatch_command(coordinator, command)
            write_response({"id": request_id, "ok": True, "result": result})
        except Exception as error:
            write_response({"id": request_id, "ok": False, "error": str(error)})
        return GLib.SOURCE_CONTINUE

    stdin_channel = GLib.IOChannel.unix_new(sys.stdin.fileno())
    stdin_channel.set_encoding("utf-8")
    GLib.io_add_watch(
        stdin_channel,
        GLib.IOCondition.IN | GLib.IOCondition.HUP | GLib.IOCondition.ERR,
        handle_stdin,
    )

    signal.signal(signal.SIGTERM, lambda *_args: coordinator.shutdown())
    signal.signal(signal.SIGINT, lambda *_args: coordinator.shutdown())
    write_response({"event": "startup", "ok": True, "engine": ENGINE_NAME})
    loop.run()
    _ = factory
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
