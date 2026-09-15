from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from typing import Optional
from unittest.mock import patch

import gi

gi.require_version("IBus", "1.0")
from gi.repository import IBus

from voco_ibus_engine import (
    KNOWN_INPUT_HINT_MASK,
    SENSITIVE_INPUT_HINT_MASK,
    VocoCoordinator,
    VocoEngine,
    configured_dictation_hotkey,
    is_session_control_key,
    session_control_hotkey_specs,
)
from voco_ibus_ownership import OwnedPreeditLease


class FakeEngine:
    def __init__(self, context_revision: int = 1) -> None:
        self.context_revision = context_revision
        self.focus_active = True
        self.can_accept_preedit = True
        self.bound_session_id = None
        self.lease = OwnedPreeditLease()
        self._voco_session_control_hotkeys = session_control_hotkey_specs("Alt+D")
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

    def commit_canonical_append(self, append_text: str) -> None:
        self.clear_preedit()
        if append_text:
            self.commands.append(("commit-text", append_text, ""))

    def plan_finalization(
        self,
        session_id: int,
        committed_text: str,
        owned_preedit_text: str,
        final_text: str,
        ownership_intact: bool,
    ):
        return self.lease.plan(
            session_id,
            self.context_revision,
            ownership_intact,
            committed_text,
            owned_preedit_text,
            final_text,
        )

    def execute_finalization(self, plan) -> None:
        for command in plan.commands():
            self.commands.append((command.operation, command.text, ""))


class DisabledTransportSinkTests(unittest.TestCase):
    def test_lifecycle_clear_cannot_send_composition_and_mutations_reject(self):
        class ForbiddenTarget:
            def __getattr__(self, name):
                raise AssertionError('target operation attempted: ' + name)
        target = ForbiddenTarget()
        VocoEngine.clear_preedit(target)
        for operation in (VocoEngine.set_preedit, VocoEngine.commit_value):
            with self.assertRaisesRegex(RuntimeError, 'original text field'):
                operation(target, 'never insert')


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

    def test_canonical_checkpoints_append_exact_text_and_retain_the_lease(self) -> None:
        session_id = self.start()
        self.coordinator.update(session_id, "", "preview draft", "preview draft")

        first_status = self.coordinator.checkpoint(session_id, "", "Canonical ")
        self.assertEqual(
            self.engine.commands[-2:],
            [("clear-preedit",), ("commit-text", "Canonical ", "")],
        )
        self.assertEqual(first_status["sessionId"], session_id)
        self.assertEqual(first_status["committedCharacterCount"], len("Canonical "))
        self.assertTrue(first_status["progressiveCommitActive"])
        self.assertEqual(self.coordinator.committed_text, "Canonical ")
        self.assertEqual(self.coordinator.provisional_text, "")
        self.assertEqual(self.engine.bound_session_id, session_id)

        self.coordinator.update(
            session_id,
            "Canonical ",
            "new preview",
            "Canonical new preview",
        )
        second_status = self.coordinator.checkpoint(
            session_id,
            "Canonical ",
            "checkpoint",
        )
        self.assertEqual(
            self.engine.commands[-2:],
            [("clear-preedit",), ("commit-text", "checkpoint", "")],
        )
        self.assertEqual(self.coordinator.committed_text, "Canonical checkpoint")
        self.assertEqual(
            second_status["committedCharacterCount"],
            len("Canonical checkpoint"),
        )
        self.assertEqual(self.engine.bound_session_id, session_id)
        self.assert_no_destructive_command()

    def test_empty_canonical_checkpoint_clears_only_the_owned_draft(self) -> None:
        session_id = self.start()
        self.coordinator.update(session_id, "", "preview draft", "preview draft")
        command_count = len(self.engine.commands)

        status = self.coordinator.checkpoint(session_id, "", "")

        self.assertEqual(self.engine.commands[command_count:], [("clear-preedit",)])
        self.assertEqual(self.coordinator.committed_text, "")
        self.assertEqual(self.coordinator.provisional_text, "")
        self.assertFalse(status["progressiveCommitActive"])
        self.assertEqual(self.engine.bound_session_id, session_id)
        self.assert_no_destructive_command()

    def test_finish_canonical_appends_exact_suffix_and_unbinds_the_session(self) -> None:
        session_id = self.start()
        self.coordinator.checkpoint(session_id, "", "Canonical ")
        self.coordinator.update(
            session_id,
            "Canonical ",
            "preview tail",
            "Canonical preview tail",
        )

        status = self.coordinator.finish_canonical(
            session_id,
            "Canonical ",
            "final",
        )

        self.assertEqual(status["finalizationOutcome"], "committed")
        self.assertEqual(status["sessionId"], session_id)
        self.assertEqual(
            status["committedCharacterCount"],
            len("Canonical final"),
        )
        self.assertEqual(
            self.engine.commands[-2:],
            [("clear-preedit",), ("commit-text", "final", "")],
        )
        self.assertIsNone(self.coordinator.session_id)
        self.assertIsNone(self.engine.bound_session_id)
        self.assert_no_destructive_command()

    def test_empty_canonical_finish_clears_draft_and_unbinds_without_commit(self) -> None:
        session_id = self.start()
        self.coordinator.update(session_id, "", "preview draft", "preview draft")
        command_count = len(self.engine.commands)

        status = self.coordinator.finish_canonical(session_id, "", "")

        self.assertEqual(status["finalizationOutcome"], "committed")
        self.assertEqual(self.engine.commands[command_count:], [("clear-preedit",)])
        self.assertIsNone(self.coordinator.session_id)
        self.assertIsNone(self.engine.bound_session_id)
        self.assert_no_destructive_command()

    def test_canonical_expected_text_and_payloads_are_validated_before_mutation(self) -> None:
        session_id = self.start()
        self.coordinator.checkpoint(session_id, "", "sealed")

        for operation in (
            self.coordinator.checkpoint,
            self.coordinator.finish_canonical,
        ):
            with self.subTest(operation=operation.__name__, case="expected-mismatch"):
                command_count = len(self.engine.commands)
                with self.assertRaisesRegex(ValueError, "expected committed text"):
                    operation(session_id, "different", " suffix")
                self.assertEqual(len(self.engine.commands), command_count)

            for expected_text, append_text in ((None, " suffix"), ("sealed", None)):
                with self.subTest(
                    operation=operation.__name__,
                    expected_text=expected_text,
                    append_text=append_text,
                ):
                    command_count = len(self.engine.commands)
                    with self.assertRaisesRegex(ValueError, "text must be a string"):
                        operation(session_id, expected_text, append_text)
                    self.assertEqual(len(self.engine.commands), command_count)
        self.assert_no_destructive_command()

    def test_stale_or_invalidated_canonical_operations_emit_no_new_command(self) -> None:
        stale_session = self.start(100)
        self.coordinator.cancel(stale_session)
        active_session = self.start(101)
        command_count = len(self.engine.commands)
        with self.assertRaisesRegex(ValueError, "stale or inactive"):
            self.coordinator.checkpoint(stale_session, "", "delayed")
        self.assertEqual(len(self.engine.commands), command_count)

        self.coordinator.update(active_session, "", "focus draft", "focus draft")
        self.coordinator.deactivate_engine(self.engine)
        command_count = len(self.engine.commands)
        with self.assertRaisesRegex(RuntimeError, "lost focus"):
            self.coordinator.finish_canonical(active_session, "", "final")
        self.assertEqual(len(self.engine.commands), command_count)

        self.coordinator.cancel(active_session)
        self.coordinator.activate_engine(self.engine)
        key_session = self.start(102)
        self.coordinator.update(key_session, "", "key draft", "key draft")
        self.coordinator.register_key_event(ord("x"), 0)
        command_count = len(self.engine.commands)
        with self.assertRaisesRegex(RuntimeError, "cursor context changed"):
            self.coordinator.checkpoint(key_session, "", "checkpoint")
        self.assertEqual(len(self.engine.commands), command_count)

        self.coordinator.cancel(key_session)
        reset_session = self.start(103)
        self.coordinator.register_context_reset(self.engine)
        command_count = len(self.engine.commands)
        with self.assertRaisesRegex(RuntimeError, "cursor context changed"):
            self.coordinator.finish_canonical(reset_session, "", "final")
        self.assertEqual(len(self.engine.commands), command_count)
        self.assert_no_destructive_command()

    def test_cancel_after_checkpoint_preserves_only_committed_normal_text(self) -> None:
        session_id = self.start()
        self.coordinator.checkpoint(session_id, "", "sealed canonical text")
        self.coordinator.update(
            session_id,
            "sealed canonical text",
            " discard this draft",
            "sealed canonical text discard this draft",
        )
        commit_commands = [
            command for command in self.engine.commands if command[0] == "commit-text"
        ]

        status = self.coordinator.cancel(session_id)

        self.assertEqual(status["finalizationOutcome"], "preserved")
        self.assertEqual(
            commit_commands,
            [("commit-text", "sealed canonical text", "")],
        )
        self.assertEqual(self.engine.commands[-1], ("clear-preedit",))
        self.assertIsNone(self.coordinator.session_id)
        self.assert_no_destructive_command()

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
        self.assertEqual(status["committedCharacterCount"], len("live words tail"))
        self.assertNotEqual(status["committedCharacterCount"], len("authoritative final"))
        operations = [command[0] for command in self.engine.commands]
        self.assertEqual(
            operations,
            [
                "advance-preedit",
                "advance-preedit",
                "clear-preedit",
                "commit-text",
            ],
        )
        self.assertEqual(self.engine.commands[-1], ("commit-text", " tail", ""))
        self.assert_no_destructive_command()

    def test_exact_final_commits_the_remaining_owned_tail(self) -> None:
        session_id = self.start()
        self.coordinator.update(session_id, "", "live words tail", "live words tail")
        self.coordinator.update(session_id, "live words", " tail", "live words tail")
        status = self.coordinator.commit(session_id, "live words tail")
        self.assertEqual(status["finalizationOutcome"], "committed")
        self.assertEqual(status["committedCharacterCount"], len("live words tail"))
        self.assertEqual(self.engine.commands[-2:], [
            ("clear-preedit",),
            ("commit-text", " tail", ""),
        ])
        self.assert_no_destructive_command()

    def test_final_without_progressive_commit_replaces_only_preedit(self) -> None:
        session_id = self.start()
        self.coordinator.update(session_id, "", "draft", "draft")
        status = self.coordinator.commit(session_id, "authoritative final")
        self.assertEqual(status["finalizationOutcome"], "committed")
        self.assertEqual(status["committedCharacterCount"], len("authoritative final"))
        operations = [command[0] for command in self.engine.commands]
        self.assertEqual(
            operations,
            ["advance-preedit", "clear-preedit", "commit-text"],
        )
        self.assert_no_destructive_command()

    def test_one_shot_without_preview_acknowledges_exact_unicode_count(self) -> None:
        session_id = self.start()
        text = "A café 👩‍💻 é"
        status = self.coordinator.commit(session_id, text)
        self.assertEqual(status["sessionId"], session_id)
        self.assertEqual(status["finalizationOutcome"], "committed")
        self.assertEqual(status["committedCharacterCount"], len(text))
        self.assertTrue(status["ownershipIntact"])
        self.assertEqual(self.engine.commands[-1], ("commit-text", text, ""))
        self.assertIsNone(self.coordinator.session_id)

    def test_failed_final_dispatch_does_not_acknowledge_requested_text(self) -> None:
        session_id = self.start()
        with patch.object(self.engine, "execute_finalization", side_effect=RuntimeError("dispatch failed")):
            with self.assertRaisesRegex(RuntimeError, "dispatch failed"):
                self.coordinator.commit(session_id, "unconfirmed final")
        self.assertEqual(self.coordinator.status()["committedCharacterCount"], 0)
        self.assertIsNone(self.coordinator.status()["finalizationOutcome"])
        self.assertTrue(self.coordinator.finalization_pending)
        with self.assertRaisesRegex(RuntimeError, "already being prepared"):
            self.coordinator.update(session_id, "", "retry", "retry")

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
        self._voco_content_type_observed = True
        self._voco_content_type_known = True
        self._voco_content_type_established = True
        self._voco_content_type_revision = self.context_revision
        self._voco_target_identity = self.focus_identity
        self._voco_target_capabilities = int(IBus.Capabilite.PREEDIT_TEXT)
        self.clears = 0

    def clear_preedit(self) -> None:
        self.clears += 1

    def _clear_owned_preedit_before_focus_loss(self) -> None:
        VocoEngine._clear_owned_preedit_before_focus_loss(self)

    def _clear_content_type_observation(self) -> None:
        VocoEngine._clear_content_type_observation(self)

    def _adopt_focus_target(self, identity: tuple[str, ...]) -> None:
        VocoEngine._adopt_focus_target(self, identity)

    def _is_fake_focus(self, identity: Optional[tuple[str, ...]]) -> bool:
        return VocoEngine._is_fake_focus(identity)

    def _focus_routes_to_target(self) -> bool:
        return VocoEngine._focus_routes_to_target(self)

    def _replace_focus_identity(self, identity: tuple[str, ...]) -> None:
        VocoEngine._replace_focus_identity(self, identity)

    def invalidate_context(self) -> None:
        self.ownership_lease.invalidate()

    @property
    def can_accept_preedit(self) -> bool:
        return VocoEngine.can_accept_preedit.fget(self)


class EngineContextTransitionTests(unittest.TestCase):
    def test_changed_safe_metadata_revokes_active_context_ownership(self):
        engine = FocusEngineDouble()
        VocoEngine.do_set_content_type(engine, int(IBus.InputPurpose.FREE_FORM), int(IBus.InputHints.SPELLCHECK))
        self.assertTrue(engine.can_accept_preedit)
        self.assertFalse(engine.coordinator.ownership_intact)

    def test_changed_safe_metadata_revokes_unclaimed_trigger(self):
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.coordinator.session_id = None
        engine._voco_input_hints = int(IBus.InputHints.SPELLCHECK)
        engine.coordinator.poll_trigger('Alt+D')
        self.assertTrue(engine.coordinator.consume_shortcut(engine, ord('d'), int(IBus.ModifierType.MOD1_MASK)))
        token = engine.coordinator.poll_trigger('Alt+D')['trigger']['triggerId']
        VocoEngine.do_set_content_type(engine, int(IBus.InputPurpose.FREE_FORM), int(IBus.InputHints.WORD_COMPLETION))
        with self.assertRaises(RuntimeError):
            engine.coordinator.claim_trigger(token)


    def test_equal_transport_capabilities_survive_context_switch_but_metadata_does_not(self):
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        VocoEngine._leave_focus(engine)
        VocoEngine._enter_focus(engine, ("id", "/new-widget", "gtk3"))
        self.assertFalse(engine.can_accept_preedit)
        self.assertEqual(engine._voco_target_capabilities, int(IBus.Capabilite.PREEDIT_TEXT))
        VocoEngine.do_set_content_type(engine, int(IBus.InputPurpose.FREE_FORM), int(IBus.InputHints.SPELLCHECK))
        self.assertTrue(engine.can_accept_preedit)


    def test_id_change_without_focus_out_clears_and_invalidates_preedit(self) -> None:
        engine = FocusEngineDouble()
        VocoEngine._enter_focus(engine, ("id", "/new", "client"))
        self.assertEqual(engine.clears, 1)
        self.assertEqual(engine.context_revision, 8)
        self.assertEqual(engine.focus_identity, ("id", "/new", "client"))
        self.assertIsNone(engine._voco_content_type_revision)
        self.assertFalse(engine._voco_content_type_observed)
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

    def test_same_real_target_requires_fresh_content_type_after_focus_loss(
        self,
    ) -> None:
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        engine.coordinator = VocoCoordinator()
        identity = engine.focus_identity

        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))
        VocoEngine._leave_focus(engine)
        VocoEngine._enter_focus(engine, identity)
        engine.coordinator.activate_engine(engine)

        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        self.assertFalse(engine._voco_content_type_observed)
        self.assertIsNone(engine._voco_content_type_revision)
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        with self.assertRaisesRegex(RuntimeError, "safe non-sensitive preedit"):
            engine.coordinator.start(1)

        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.SPELLCHECK),
        )
        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))

    def test_ambiguous_default_revokes_established_safe_proof(self) -> None:
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        engine.coordinator = VocoCoordinator()
        engine.coordinator.activate_engine(engine)

        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.SPELLCHECK),
        )
        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))

        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.NONE),
        )

        self.assertTrue(engine._voco_content_type_observed)
        self.assertTrue(engine._voco_content_type_known)
        self.assertFalse(engine._voco_content_type_established)
        self.assertIsNone(engine._voco_content_type_revision)
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        with self.assertRaisesRegex(RuntimeError, "safe non-sensitive preedit"):
            engine.coordinator.start(1)

        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.SPELLCHECK),
        )

        self.assertTrue(engine._voco_content_type_established)
        self.assertEqual(
            engine._voco_content_type_revision,
            engine.context_revision,
        )
        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))

    def test_disallowed_callback_cannot_establish_content_type_proof(
        self,
    ) -> None:
        disallowed_cases = [
            (IBus.InputPurpose.PASSWORD, IBus.InputHints.NONE),
            (IBus.InputPurpose.PIN, IBus.InputHints.NONE),
            (IBus.InputPurpose.FREE_FORM, IBus.InputHints.PRIVATE),
        ]
        terminal_purpose = int(getattr(IBus.InputPurpose, "TERMINAL", 10))
        disallowed_cases.append((terminal_purpose, IBus.InputHints.NONE))
        for purpose, hints in disallowed_cases:
            with self.subTest(purpose=purpose, hints=hints):
                engine = FocusEngineDouble()
                engine.bound_session_id = None
                engine.ownership_lease.unbind_session()
                engine.coordinator = VocoCoordinator()
                identity = engine.focus_identity
                VocoEngine._leave_focus(engine)
                VocoEngine._enter_focus(engine, identity)
                engine.coordinator.activate_engine(engine)

                VocoEngine.do_set_content_type(
                    engine,
                    int(purpose),
                    int(hints),
                )

                self.assertIsNone(engine._voco_content_type_revision)
                self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
                with self.assertRaisesRegex(
                    RuntimeError,
                    "safe non-sensitive preedit",
                ):
                    engine.coordinator.start(1)

                VocoEngine.do_set_content_type(
                    engine,
                    int(IBus.InputPurpose.FREE_FORM),
                    int(IBus.InputHints.NONE),
                )

                self.assertIsNone(engine._voco_content_type_revision)
                self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))

    def test_new_id_context_cannot_reuse_another_contexts_content_type(self) -> None:
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        engine.coordinator = VocoCoordinator()
        engine.focus_active = False
        engine.focus_identity = None

        VocoEngine._enter_focus(engine, ("id", "/new", "client"))
        engine.coordinator.activate_engine(engine)

        self.assertFalse(engine._voco_content_type_observed)
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        with self.assertRaisesRegex(RuntimeError, "safe non-sensitive preedit"):
            engine.coordinator.start(1)

    def test_preedit_capable_client_without_content_type_callback_fails_closed(
        self,
    ) -> None:
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        engine.coordinator = VocoCoordinator()
        engine.focus_active = False
        engine.focus_identity = None
        engine._voco_content_type_observed = False
        engine._voco_content_type_known = False
        engine._voco_content_type_established = False
        engine._voco_content_type_revision = None

        VocoEngine._enter_focus(engine, ("id", "/no-content-callback", "client"))
        engine.coordinator.activate_engine(engine)

        self.assertIsNone(engine._voco_content_type_revision)
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        with self.assertRaisesRegex(RuntimeError, "safe non-sensitive preedit"):
            engine.coordinator.start(1)

    def test_fresh_default_content_type_cannot_become_proof_through_fake_proxy(
        self,
    ) -> None:
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        engine.coordinator = VocoCoordinator()
        engine.focus_active = False
        engine.focus_identity = None

        VocoEngine._enter_focus(engine, ("id", "/fresh", "client"))
        VocoEngine.do_set_capabilities(
            engine,
            int(IBus.Capabilite.PREEDIT_TEXT),
        )
        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.NONE),
        )
        self.assertTrue(engine._voco_content_type_observed)
        self.assertFalse(engine._voco_content_type_established)
        self.assertIsNone(engine._voco_content_type_revision)

        VocoEngine._leave_focus(engine)
        VocoEngine._enter_focus(engine, ("id", "/fake", "fake"))
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))

    def test_fake_focus_is_rejected_until_the_same_real_target_returns(self) -> None:
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        engine.coordinator = VocoCoordinator()
        engine.focus_active = False
        engine.focus_identity = None

        VocoEngine._enter_focus(engine, ("id", "/safe", "client"))
        VocoEngine.do_set_capabilities(
            engine,
            int(IBus.Capabilite.PREEDIT_TEXT),
        )
        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.SPELLCHECK),
        )
        engine.coordinator.activate_engine(engine)
        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))

        VocoEngine._leave_focus(engine)
        engine.coordinator.deactivate_engine(engine)
        VocoEngine._enter_focus(engine, ("id", "/fake", "fake"))
        engine.coordinator.activate_engine(engine)
        VocoEngine.do_set_capabilities(engine, int(IBus.Capabilite.FOCUS))

        self.assertEqual(
            engine._voco_target_identity,
            ("id", "/safe", "client"),
        )
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        with self.assertRaisesRegex(RuntimeError, "safe non-sensitive preedit"):
            engine.coordinator.start(1)

        VocoEngine._leave_focus(engine)
        engine.coordinator.deactivate_engine(engine)
        VocoEngine._enter_focus(engine, ("id", "/safe", "client"))
        engine.coordinator.activate_engine(engine)

        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        self.assertFalse(engine._voco_content_type_observed)
        self.assertIsNone(engine._voco_content_type_revision)
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        with self.assertRaisesRegex(RuntimeError, "safe non-sensitive preedit"):
            engine.coordinator.start(1)

        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.SPELLCHECK),
        )
        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))

    def test_fake_focus_without_focus_out_also_requires_fresh_content_type(
        self,
    ) -> None:
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        engine.coordinator = VocoCoordinator()
        real_identity = engine.focus_identity

        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))
        VocoEngine._enter_focus(engine, ("id", "/fake", "fake"))
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))

        VocoEngine._enter_focus(engine, real_identity)
        engine.coordinator.activate_engine(engine)

        self.assertFalse(engine._voco_content_type_observed)
        self.assertIsNone(engine._voco_content_type_revision)
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        with self.assertRaisesRegex(RuntimeError, "safe non-sensitive preedit"):
            engine.coordinator.start(1)

        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.SPELLCHECK),
        )
        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))

    def test_fake_proxy_cannot_supply_preedit_capability_for_real_target(self) -> None:
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        engine.coordinator = VocoCoordinator()
        engine.focus_active = False
        engine.focus_identity = None

        VocoEngine._enter_focus(engine, ("id", "/safe", "client"))
        VocoEngine.do_set_capabilities(engine, int(IBus.Capabilite.FOCUS))
        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.SPELLCHECK),
        )
        VocoEngine._leave_focus(engine)
        VocoEngine._enter_focus(engine, ("id", "/fake", "fake"))
        VocoEngine.do_set_capabilities(
            engine,
            int(IBus.Capabilite.FOCUS) | int(IBus.Capabilite.PREEDIT_TEXT),
        )

        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))

    def test_fake_proxy_content_callback_revokes_real_target_proof(self) -> None:
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        engine.coordinator = VocoCoordinator()
        engine.focus_active = False
        engine.focus_identity = None

        VocoEngine._enter_focus(engine, ("id", "/safe", "client"))
        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.SPELLCHECK),
        )
        VocoEngine._leave_focus(engine)
        VocoEngine._enter_focus(engine, ("id", "/fake", "fake"))
        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.NONE),
        )

        self.assertFalse(engine._voco_content_type_established)
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))

    def test_sensitive_content_type_never_establishes_proof(self) -> None:
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        engine.coordinator = VocoCoordinator()
        engine.focus_active = False
        engine.focus_identity = None
        engine._voco_content_type_observed = False
        engine._voco_content_type_known = False
        engine._voco_content_type_established = False
        engine._voco_content_type_revision = None
        VocoEngine._enter_focus(engine, ("id", "/password", "client"))
        VocoEngine.do_set_capabilities(
            engine,
            int(IBus.Capabilite.PREEDIT_TEXT),
        )
        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.PASSWORD),
            int(IBus.InputHints.NONE),
        )

        self.assertIsNone(engine._voco_content_type_revision)
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))

    def test_session_hotkeys_are_parsed_once_and_bound_to_the_lease(self) -> None:
        engine = FocusEngineDouble()
        engine.bound_session_id = None
        engine.ownership_lease.unbind_session()
        engine._voco_session_control_hotkeys = ()
        with patch(
            "voco_ibus_engine.configured_dictation_hotkey",
            return_value="Ctrl+Shift+V",
        ) as load_hotkey:
            VocoEngine.bind_session(engine, 77)
            self.assertEqual(load_hotkey.call_count, 1)

            state = int(IBus.ModifierType.CONTROL_MASK) | int(
                IBus.ModifierType.SHIFT_MASK
            )
            self.assertTrue(
                is_session_control_key(
                    IBus.keyval_from_name("V"),
                    state,
                    engine._voco_session_control_hotkeys,
                )
            )
            self.assertEqual(load_hotkey.call_count, 1)

        VocoEngine.unbind_session(engine)
        self.assertEqual(engine._voco_session_control_hotkeys, ())

    def test_peer_transition_clear_failure_still_invalidates(self) -> None:
        engine = FocusEngineDouble()
        with patch.object(engine, "clear_preedit", side_effect=RuntimeError("clear failed")):
            VocoEngine._enter_focus(engine, ("id", "/new", "client"))
        self.assertEqual(engine.context_revision, 8)
        self.assertTrue(engine.coordinator.focus_lost)


class SessionControlHotkeyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.coordinator = VocoCoordinator()
        self.engine = FakeEngine()
        self.coordinator.activate_engine(self.engine)
        self.coordinator.start(41)
        self.coordinator.update(41, "", "owned draft", "owned draft")

    def register(self, key_name: str, state: int) -> None:
        self.coordinator.register_key_event(IBus.keyval_from_name(key_name), state)

    def assert_ownership_intact(self) -> None:
        self.assertTrue(self.coordinator.ownership_intact)
        self.assertEqual(self.coordinator.provisional_text, "owned draft")
        self.assertEqual(self.engine.bound_session_id, 41)

    def test_configured_custom_hotkey_preserves_the_active_lease(self) -> None:
        state = int(IBus.ModifierType.CONTROL_MASK) | int(
            IBus.ModifierType.SHIFT_MASK
        )
        self.engine._voco_session_control_hotkeys = session_control_hotkey_specs(
            "Ctrl+Shift+V"
        )
        self.register("V", state)
        self.assert_ownership_intact()

    def test_retired_realtime_hotkey_does_not_preserve_the_active_lease(self) -> None:
        state = (
            int(IBus.ModifierType.MOD1_MASK)
            | int(IBus.ModifierType.SHIFT_MASK)
        )
        self.register("R", state)
        self.assertFalse(self.coordinator.ownership_intact)

    def test_configured_single_function_key_cannot_preserve_the_lease(self) -> None:
        self.engine._voco_session_control_hotkeys = session_control_hotkey_specs("F8")
        self.register("F8", 0)
        self.assertFalse(self.coordinator.ownership_intact)

    def test_shift_only_configured_key_cannot_preserve_the_lease(self) -> None:
        self.engine._voco_session_control_hotkeys = session_control_hotkey_specs(
            "Shift+D"
        )
        self.register("D", int(IBus.ModifierType.SHIFT_MASK))
        self.assertFalse(self.coordinator.ownership_intact)

    def test_supported_non_shift_modifier_aliases_are_preserved(self) -> None:
        controls = {
            name: session_control_hotkey_specs(f"{name}+D")[0][0]
            for name in (
                "Alt",
                "Option",
                "Control",
                "Ctrl",
                "Command",
                "Cmd",
                "Super",
                "CommandOrControl",
                "CommandOrCtrl",
                "CmdOrControl",
                "CmdOrCtrl",
            )
        }
        self.assertEqual(controls["Alt"], frozenset({"alt"}))
        self.assertEqual(controls["Option"], frozenset({"alt"}))
        self.assertEqual(controls["Control"], frozenset({"control"}))
        self.assertEqual(controls["Ctrl"], frozenset({"control"}))
        self.assertEqual(controls["Command"], frozenset({"super"}))
        self.assertEqual(controls["Cmd"], frozenset({"super"}))
        self.assertEqual(controls["Super"], frozenset({"super"}))
        for name in (
            "CommandOrControl",
            "CommandOrCtrl",
            "CmdOrControl",
            "CmdOrCtrl",
        ):
            self.assertEqual(controls[name], frozenset({"control"}))

    def test_nonmatching_modifier_shortcut_invalidates_the_lease(self) -> None:
        state = int(IBus.ModifierType.CONTROL_MASK)
        self.engine._voco_session_control_hotkeys = session_control_hotkey_specs(
            "Ctrl+Shift+V"
        )
        self.register("Left", state)
        self.assertFalse(self.coordinator.ownership_intact)
        self.assertEqual(self.coordinator.provisional_text, "")
        self.assertEqual(self.engine.commands[-1], ("clear-preedit",))

    def test_shifted_ordinary_text_key_does_not_preserve_the_lease(self) -> None:
        self.register("X", int(IBus.ModifierType.SHIFT_MASK))
        self.assertFalse(self.coordinator.ownership_intact)

    def test_altgr_text_key_does_not_match_a_plain_configured_key(self) -> None:
        self.engine._voco_session_control_hotkeys = session_control_hotkey_specs("E")
        self.register("e", int(IBus.ModifierType.MOD5_MASK))
        self.assertFalse(self.coordinator.ownership_intact)

    def test_configured_hotkey_is_loaded_from_xdg_config(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            config_dir = Path(temp_dir) / "voco"
            config_dir.mkdir()
            (config_dir / "config.json").write_text(
                json.dumps({"hotkey": "Ctrl+Shift+V"}),
                encoding="utf-8",
            )
            with patch.dict(os.environ, {"XDG_CONFIG_HOME": temp_dir}):
                self.assertEqual(configured_dictation_hotkey(), "Ctrl+Shift+V")

    def test_release_and_bare_modifier_events_are_non_mutating(self) -> None:
        self.assertTrue(
            is_session_control_key(
                IBus.keyval_from_name("x"),
                int(IBus.ModifierType.RELEASE_MASK),
            )
        )
        self.assertTrue(is_session_control_key(IBus.keyval_from_name("Alt_L"), 0))



class ConsumingShortcutTests(unittest.TestCase):
    def setUp(self):
        self.coordinator = VocoCoordinator()
        self.engine = FakeEngine()
        self.coordinator.activate_engine(self.engine)
        self.key = IBus.keyval_from_name('d')
        self.alt = int(IBus.ModifierType.MOD1_MASK)

    def trigger(self):
        self.coordinator.poll_trigger('Alt+D')
        self.assertTrue(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))
        return self.coordinator.poll_trigger('Alt+D')['trigger']['triggerId']

    def test_absent_or_expired_client_does_not_swallow_shortcut(self):
        self.assertFalse(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))
        self.coordinator.poll_trigger('Alt+D')
        self.coordinator.shortcut_armed_until = 0
        self.assertFalse(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))

    def test_verified_trigger_is_one_shot_and_poll_delivery_is_once(self):
        token = self.trigger()
        self.assertIsNone(self.coordinator.poll_trigger('Alt+D')['trigger'])
        self.coordinator.claim_trigger(token)
        self.coordinator.start(100)
        with self.assertRaises(RuntimeError):
            self.coordinator.claim_trigger(token)

    def test_negative_poll_disarms_until_next_eligible_poll(self):
        self.engine.can_accept_preedit = False
        self.assertFalse(self.coordinator.poll_trigger('Alt+D')['armed'])
        self.engine.can_accept_preedit = True
        self.assertFalse(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))
        self.assertTrue(self.coordinator.poll_trigger('Alt+D')['armed'])
        self.assertTrue(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))

    def test_sensitive_field_does_not_consume_shortcut(self):
        self.coordinator.poll_trigger('Alt+D')
        self.engine.can_accept_preedit = False
        self.assertFalse(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))

    def test_focus_switch_before_start_cannot_redirect(self):
        token = self.trigger()
        self.coordinator.activate_engine(FakeEngine())
        with self.assertRaises(RuntimeError):
            self.coordinator.claim_trigger(token)
        self.assertIsNone(self.coordinator.session_id)

    def test_focus_away_and_back_invalidates_even_same_engine(self):
        token = self.trigger()
        self.coordinator.deactivate_engine(self.engine)
        self.coordinator.activate_engine(self.engine)
        with self.assertRaises(RuntimeError):
            self.coordinator.claim_trigger(token)

    def test_context_revision_change_invalidates(self):
        token = self.trigger()
        self.engine.context_revision += 1
        with self.assertRaises(RuntimeError):
            self.coordinator.claim_trigger(token)

    def test_typing_before_start_invalidates(self):
        token = self.trigger()
        self.coordinator.register_key_event(IBus.keyval_from_name('x'), 0)
        with self.assertRaises(RuntimeError):
            self.coordinator.claim_trigger(token)

    def test_reset_before_start_invalidates(self):
        token = self.trigger()
        self.coordinator.register_context_reset(self.engine)
        with self.assertRaises(RuntimeError):
            self.coordinator.claim_trigger(token)

    def test_expired_or_forged_token_fails_closed(self):
        token = self.trigger()
        with self.assertRaises(RuntimeError):
            self.coordinator.claim_trigger('forged')
        with self.assertRaises(RuntimeError):
            self.coordinator.claim_trigger(token)
        self.coordinator.consumed_shortcut_keys.clear()
        token = self.trigger()
        with patch('voco_ibus_engine.time.monotonic', return_value=10**20):
            with self.assertRaises(RuntimeError):
                self.coordinator.claim_trigger(token)

    def test_repeat_and_release_are_consumed_without_duplicate_trigger(self):
        self.trigger()
        self.assertTrue(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))
        self.assertIsNone(self.coordinator.poll_trigger('Alt+D')['trigger'])
        self.assertTrue(self.coordinator.consume_shortcut(self.engine, self.key, self.alt | int(IBus.ModifierType.RELEASE_MASK)))
        self.assertFalse(self.coordinator.consume_shortcut(self.engine, self.key, self.alt | int(IBus.ModifierType.RELEASE_MASK)))

    def test_missing_release_cannot_swallow_ordinary_typing(self):
        self.trigger()
        self.assertFalse(self.coordinator.consume_shortcut(self.engine, self.key, 0))

    def test_missing_release_after_focus_change_does_not_block_new_shortcut(self):
        self.trigger()
        self.coordinator.deactivate_engine(self.engine)
        self.coordinator.activate_engine(self.engine)
        self.assertTrue(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))
        self.assertIsNotNone(self.coordinator.poll_trigger('Alt+D')['trigger'])

    def test_missing_release_after_client_expiry_does_not_swallow_keys(self):
        self.trigger()
        self.coordinator.shortcut_armed_until = 0
        self.assertFalse(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))

    def test_disconnect_disarms_and_revokes_trigger(self):
        token = self.trigger()
        self.coordinator.disconnect_client()
        with self.assertRaises(RuntimeError):
            self.coordinator.claim_trigger(token)

    def test_protocol_rejects_passive_start_without_token(self):
        from voco_ibus_engine import dispatch_command
        with self.assertRaisesRegex(RuntimeError, 'original text field'):
            dispatch_command(self.coordinator, {'operation': 'start', 'clientSessionId': 1})
        self.assertIsNone(self.coordinator.session_id)

    def test_public_mutations_reject_even_with_valid_token_or_existing_policy_session(self):
        from voco_ibus_engine import dispatch_command
        token = self.trigger()
        for active in (False, True):
            if active:
                # A policy session is deliberately injected to exercise mutation
                # guards independently of the public start guard.
                self.coordinator.start(41)
            before = list(self.engine.commands)
            for operation in ('start', 'update', 'commit', 'checkpoint', 'finish-canonical', 'cancel'):
                with self.subTest(active=active, operation=operation):
                    with self.assertRaisesRegex(RuntimeError, 'original text field'):
                        dispatch_command(self.coordinator, dict(operation=operation,
                            triggerId=token, clientSessionId=41, sessionId=41,
                            confirmedText='', preeditText='draft', provisionalText='draft',
                            text='never insert', expectedCommittedText='', appendText='never insert'))
                    self.assertEqual(self.engine.commands, before)
        status = dispatch_command(self.coordinator, {'operation': 'status'})
        self.assertFalse(status['ready'])
        self.assertFalse(status['ownershipIntact'])
        self.assertEqual(status['setupState'], 'safety-disabled')

    def test_registration_change_discards_old_trigger_and_uses_new_chord(self):
        token = self.trigger()
        self.coordinator.consumed_shortcut_keys.clear()
        self.coordinator.poll_trigger('Ctrl+Shift+V')
        with self.assertRaises(RuntimeError):
            self.coordinator.claim_trigger(token)
        self.assertFalse(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))
        self.assertTrue(self.coordinator.consume_shortcut(self.engine, IBus.keyval_from_name('v'), int(IBus.ModifierType.CONTROL_MASK | IBus.ModifierType.SHIFT_MASK)))

    def test_dead_client_does_not_consume_fresh_press_after_consumed_release(self):
        self.trigger()
        self.coordinator.disconnect_client()
        self.assertTrue(self.coordinator.consume_shortcut(self.engine, self.key, self.alt | int(IBus.ModifierType.RELEASE_MASK)))
        self.assertFalse(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))


if __name__ == "__main__":
    unittest.main()
