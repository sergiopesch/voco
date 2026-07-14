from __future__ import annotations

import unittest
from unittest.mock import patch

import gi

gi.require_version("IBus", "1.0")
from gi.repository import IBus

from voco_ibus_engine import (
    KNOWN_INPUT_HINT_MASK,
    SENSITIVE_INPUT_HINT_MASK,
    VocoCoordinator,
    VocoEngine,
)
from voco_ibus_ownership import OwnedPreeditLease


class FakeEngine:
    def __init__(self, context_revision: int = 1) -> None:
        self.context_revision = context_revision
        self.focus_active = True
        self.can_accept_preedit = True
        self.bound_session_id = None
        self.lease = OwnedPreeditLease()
        self.commands: list[tuple[str, str, str] | tuple[str]] = []
        self.fail_clear = False

    def bind_session(self, session_id: int) -> None:
        self.bound_session_id = session_id
        self.lease.bind_session(session_id, self.context_revision)

    def unbind_session(self) -> None:
        self.bound_session_id = None
        self.lease.unbind_session()

    def invalidate_context(self) -> None:
        self.lease.invalidate()

    def clear_preedit(self) -> None:
        self.commands.append(("clear-preedit",))
        if self.fail_clear:
            raise RuntimeError("synthetic clear failure")

    def advance_preedit(self, append_text: str, preedit_text: str) -> None:
        self.commands.append(("advance-preedit", append_text, preedit_text))

    def plan_finalization(
        self,
        session_id: int,
        committed_text: str,
        final_text: str,
        ownership_intact: bool,
    ):
        return self.lease.plan(
            session_id,
            self.context_revision,
            ownership_intact,
            committed_text,
            final_text,
        )

    def execute_finalization(self, plan) -> None:
        for command in plan.commands():
            self.commands.append((command.operation, command.text, ""))


class CoordinatorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.coordinator = VocoCoordinator()
        self.engine = FakeEngine()
        self.coordinator.activate_engine(self.engine)

    def start(self, session_id: int = 41) -> int:
        status = self.coordinator.start(session_id)
        self.assertTrue(status["engineActive"])
        self.assertEqual(status["sessionId"], session_id)
        return session_id

    def assert_no_destructive_command(self) -> None:
        operations = [command[0] for command in self.engine.commands]
        self.assertNotIn("delete-surrounding-text", operations)
        self.assertNotIn("delete", operations)

    def test_start_requires_an_enabled_focused_engine(self) -> None:
        coordinator = VocoCoordinator()
        with self.assertRaisesRegex(ValueError, "positive integer"):
            coordinator.start(True)
        with self.assertRaisesRegex(RuntimeError, "Enable the VOCO Dictation"):
            coordinator.start(1)

        self.engine.focus_active = False
        with self.assertRaisesRegex(RuntimeError, "Enable the VOCO Dictation"):
            self.coordinator.start(1)

        self.engine.focus_active = True
        self.engine.can_accept_preedit = False
        with self.assertRaisesRegex(RuntimeError, "safe non-sensitive preedit"):
            self.coordinator.start(1)

    def test_update_advances_only_the_bound_owned_ranges(self) -> None:
        session_id = self.start()
        self.coordinator.update(
            session_id,
            "",
            "stable provisional",
            "stable provisional",
        )
        status = self.coordinator.update(
            session_id,
            "stable ",
            "provisional",
            "stable provisional",
        )
        self.assertEqual(
            self.engine.commands,
            [
                ("advance-preedit", "", "stable provisional"),
                ("advance-preedit", "stable ", "provisional"),
            ],
        )
        self.assertTrue(status["progressiveCommitActive"])
        self.assert_no_destructive_command()

    def test_mismatched_ranges_emit_no_target_command(self) -> None:
        session_id = self.start()
        with self.assertRaisesRegex(ValueError, "owned ranges"):
            self.coordinator.update(session_id, "stable", "tail", "different")
        self.assertEqual(self.engine.commands, [])

    def test_confirmed_append_must_be_owned_by_the_previous_preedit(self) -> None:
        session_id = self.start()
        self.coordinator.update(session_id, "", "owned tail", "owned tail")
        command_count = len(self.engine.commands)
        with self.assertRaisesRegex(ValueError, "previously owned preedit"):
            self.coordinator.update(
                session_id,
                "arbitrary ",
                "replacement",
                "arbitrary replacement",
            )
        self.assertEqual(len(self.engine.commands), command_count)
        self.assert_no_destructive_command()

    def test_unicode_and_punctuation_prefix_is_consumed_exactly(self) -> None:
        session_id = self.start()
        owned = "Café 👩\u200d💻 — ready, provisional"
        prefix = "Café 👩\u200d💻 — ready, "
        self.coordinator.update(session_id, "", owned, owned)
        self.coordinator.update(
            session_id,
            prefix,
            "final tail",
            prefix + "final tail",
        )
        self.assertEqual(
            self.engine.commands[-1],
            ("advance-preedit", prefix, "final tail"),
        )
        command_count = len(self.engine.commands)
        with self.assertRaisesRegex(ValueError, "previously owned preedit"):
            self.coordinator.update(
                session_id,
                prefix + "x",
                "final tail",
                prefix + "xfinal tail",
            )
        self.assertEqual(len(self.engine.commands), command_count)

    def test_focus_change_rejects_update_and_finalization(self) -> None:
        session_id = self.start()
        self.coordinator.deactivate_engine(self.engine)
        with self.assertRaisesRegex(RuntimeError, "lost focus"):
            self.coordinator.update(session_id, "", "tail", "tail")
        with self.assertRaisesRegex(RuntimeError, "lost focus"):
            self.coordinator.commit(session_id, "final")
        self.assertEqual(self.engine.commands, [])
        self.assert_no_destructive_command()

    def test_context_reset_and_key_activity_fail_closed(self) -> None:
        session_id = self.start()
        self.coordinator.register_context_reset(self.engine)
        with self.assertRaisesRegex(RuntimeError, "cursor context changed"):
            self.coordinator.update(session_id, "", "tail", "tail")
        self.assertEqual(self.engine.commands, [])

        self.coordinator.cancel(session_id)
        session_id = self.start(42)
        self.coordinator.register_key_event(ord("x"), 0)
        with self.assertRaisesRegex(RuntimeError, "cursor context changed"):
            self.coordinator.update(session_id, "", "tail", "tail")
        self.assertEqual(self.engine.commands[-1], ("clear-preedit",))
        self.assert_no_destructive_command()

    def test_changed_final_preserves_progressive_commits(self) -> None:
        session_id = self.start()
        self.coordinator.update(session_id, "", "live words tail", "live words tail")
        self.coordinator.update(session_id, "live words", " tail", "live words tail")
        status = self.coordinator.commit(session_id, "authoritative final")
        self.assertEqual(status["finalizationOutcome"], "preserved")
        operations = [command[0] for command in self.engine.commands]
        self.assertEqual(
            operations,
            ["advance-preedit", "advance-preedit", "clear-preedit"],
        )
        self.assert_no_destructive_command()

    def test_final_without_progressive_commit_replaces_only_preedit(self) -> None:
        session_id = self.start()
        self.coordinator.update(session_id, "", "draft", "draft")
        status = self.coordinator.commit(session_id, "authoritative final")
        self.assertEqual(status["finalizationOutcome"], "committed")
        operations = [command[0] for command in self.engine.commands]
        self.assertEqual(
            operations,
            ["advance-preedit", "clear-preedit", "commit-text"],
        )
        self.assert_no_destructive_command()

    def test_disconnect_clears_only_preedit_and_preserves_commits(self) -> None:
        session_id = self.start()
        self.coordinator.update(session_id, "", "confirmed tail", "confirmed tail")
        self.coordinator.update(session_id, "confirmed", " tail", "confirmed tail")
        self.coordinator.disconnect_client()
        self.assertIsNone(self.coordinator.session_id)
        self.assertEqual(self.engine.commands[-1], ("clear-preedit",))
        self.assert_no_destructive_command()

    def test_disconnect_invalidates_session_even_if_preedit_clear_fails(self) -> None:
        session_id = self.start()
        self.coordinator.update(session_id, "", "tail", "tail")
        self.engine.fail_clear = True
        self.coordinator.disconnect_client()
        self.assertIsNone(self.coordinator.session_id)
        self.assertIsNone(self.engine.bound_session_id)
        self.assert_no_destructive_command()

    def test_repeated_start_does_not_cancel_the_active_session(self) -> None:
        active_session = self.start(100)
        command_count = len(self.engine.commands)
        with self.assertRaisesRegex(RuntimeError, "must be canceled"):
            self.coordinator.start(101)
        self.assertEqual(self.coordinator.session_id, active_session)
        self.assertEqual(len(self.engine.commands), command_count)
        self.coordinator.cancel(active_session)
        self.assert_no_destructive_command()

    def test_delayed_old_final_cannot_mutate_a_new_session(self) -> None:
        old_session = self.start(100)
        self.coordinator.cancel(old_session)
        new_session = self.start(101)
        command_count = len(self.engine.commands)
        with self.assertRaisesRegex(ValueError, "stale or inactive"):
            self.coordinator.commit(old_session, "delayed old final")
        self.assertEqual(len(self.engine.commands), command_count)
        self.coordinator.update(new_session, "", "new owned tail", "new owned tail")
        self.coordinator.cancel(new_session)
        self.assert_no_destructive_command()


class FocusEngineDouble:
    def __init__(self) -> None:
        self.context_revision = 7
        self.focus_active = True
        self.focus_identity = ("id", "/old", "client")
        self.bound_session_id = 41
        self.ownership_lease = OwnedPreeditLease()
        self.ownership_lease.bind_session(41, self.context_revision)
        self.coordinator = VocoCoordinator()
        self.coordinator.focused_engine = self
        self.coordinator.target_engine = self
        self.coordinator.session_id = 41
        self._voco_input_purpose = IBus.InputPurpose.FREE_FORM
        self._voco_input_hints = int(IBus.InputHints.NONE)
        self._voco_content_type_known = True
        self._voco_content_type_revision = self.context_revision
        self._voco_client_capabilities = int(IBus.Capabilite.PREEDIT_TEXT)
        self.clears = 0
        self.scheduled_promotions = 0

    def clear_preedit(self) -> None:
        self.clears += 1

    def _clear_owned_preedit_before_focus_loss(self) -> None:
        VocoEngine._clear_owned_preedit_before_focus_loss(self)

    def _reset_content_type_proof(self) -> None:
        VocoEngine._reset_content_type_proof(self)

    def _replace_focus_identity(self, identity: tuple[str, ...]) -> None:
        VocoEngine._replace_focus_identity(self, identity)

    def _schedule_content_type_promotion(self) -> None:
        self.scheduled_promotions += 1

    def invalidate_context(self) -> None:
        self.ownership_lease.invalidate()

    @property
    def can_accept_preedit(self) -> bool:
        return VocoEngine.can_accept_preedit.fget(self)


class EngineContextTransitionTests(unittest.TestCase):
    def test_id_change_without_focus_out_clears_and_invalidates_preedit(self) -> None:
        engine = FocusEngineDouble()
        VocoEngine._enter_focus(engine, ("id", "/new", "client"))
        self.assertEqual(engine.clears, 1)
        self.assertEqual(engine.context_revision, 8)
        self.assertEqual(engine.focus_identity, ("id", "/new", "client"))
        self.assertIsNone(engine._voco_content_type_revision)
        self.assertEqual(engine.scheduled_promotions, 1)
        self.assertFalse(engine.coordinator.ownership_intact)
        self.assertTrue(engine.coordinator.focus_lost)

    def test_bound_legacy_to_id_callback_fails_closed(self) -> None:
        engine = FocusEngineDouble()
        engine.focus_identity = ("legacy",)
        VocoEngine._enter_focus(engine, ("id", "/target", "client"))
        self.assertEqual(engine.clears, 1)
        self.assertEqual(engine.context_revision, 8)
        self.assertTrue(engine.coordinator.focus_lost)

    def test_bound_id_to_legacy_to_new_id_callbacks_fail_closed(self) -> None:
        engine = FocusEngineDouble()
        VocoEngine._enter_focus(engine, ("legacy",))
        VocoEngine._enter_focus(engine, ("id", "/new", "client"))
        self.assertEqual(engine.clears, 2)
        self.assertEqual(engine.context_revision, 9)
        self.assertEqual(engine.focus_identity, ("id", "/new", "client"))
        self.assertTrue(engine.coordinator.focus_lost)

    def test_exact_repeated_id_is_the_only_bound_focus_noop(self) -> None:
        engine = FocusEngineDouble()
        VocoEngine._enter_focus(engine, engine.focus_identity)
        self.assertEqual(engine.clears, 0)
        self.assertEqual(engine.context_revision, 7)
        self.assertFalse(engine.coordinator.focus_lost)

    def test_private_hint_is_not_a_safe_preedit_context(self) -> None:
        engine = FocusEngineDouble()
        engine._voco_input_hints = IBus.InputHints.PRIVATE
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))

    def test_hidden_text_hint_is_rejected_when_supported_by_ibus(self) -> None:
        hidden_text = getattr(IBus.InputHints, "HIDDEN_TEXT", None)
        if hidden_text is None:
            self.assertEqual(SENSITIVE_INPUT_HINT_MASK, int(IBus.InputHints.PRIVATE))
            return
        engine = FocusEngineDouble()
        engine._voco_input_hints = hidden_text
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))

    def test_unknown_content_purpose_invalidates_an_active_lease(self) -> None:
        engine = FocusEngineDouble()
        VocoEngine.do_set_content_type(engine, 1_000_000, 0)
        self.assertFalse(engine.can_accept_preedit)
        self.assertEqual(engine.clears, 1)
        self.assertTrue(engine.coordinator.focus_lost)

    def test_unknown_content_hint_invalidates_an_active_lease(self) -> None:
        engine = FocusEngineDouble()
        unknown_hint = 1
        while KNOWN_INPUT_HINT_MASK & unknown_hint:
            unknown_hint <<= 1
        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            unknown_hint,
        )
        self.assertFalse(engine.can_accept_preedit)
        self.assertEqual(engine.clears, 1)
        self.assertTrue(engine.coordinator.focus_lost)

    def test_content_type_proof_must_match_current_context_revision(self) -> None:
        engine = FocusEngineDouble()
        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))
        engine.context_revision += 1
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))

    def test_focus_barrier_promotes_cached_non_sensitive_content_type(self) -> None:
        engine = FocusEngineDouble()
        engine.focus_active = False
        engine.focus_identity = None
        VocoEngine._enter_focus(engine, ("id", "/new", "client"))
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        VocoEngine._promote_content_type_after_focus(engine, engine.context_revision)
        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))

    def test_stale_focus_barrier_cannot_promote_a_newer_context(self) -> None:
        engine = FocusEngineDouble()
        stale_revision = engine.context_revision
        engine.context_revision += 1
        engine._voco_content_type_revision = None
        VocoEngine._promote_content_type_after_focus(engine, stale_revision)
        self.assertIsNone(engine._voco_content_type_revision)

    def test_peer_transition_clear_failure_still_invalidates(self) -> None:
        engine = FocusEngineDouble()
        with patch.object(engine, "clear_preedit", side_effect=RuntimeError("clear failed")):
            VocoEngine._enter_focus(engine, ("id", "/new", "client"))
        self.assertEqual(engine.context_revision, 8)
        self.assertTrue(engine.coordinator.focus_lost)


if __name__ == "__main__":
    unittest.main()
