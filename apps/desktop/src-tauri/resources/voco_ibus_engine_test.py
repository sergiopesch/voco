from __future__ import annotations

import unittest
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
    session_control_hotkey_specs,
)


class FakeEngine:
    def __init__(self, context_revision: int = 1) -> None:
        self.context_revision = context_revision
        self.focus_active = True
        self.can_accept_preedit = True


class FocusEngineDouble:
    def __init__(self) -> None:
        self.context_revision = 7
        self.focus_active = True
        self.focus_identity = ("id", "/old", "client")
        self.coordinator = VocoCoordinator()
        self.coordinator.focused_engine = self
        self._voco_input_purpose = IBus.InputPurpose.FREE_FORM
        self._voco_input_hints = int(IBus.InputHints.NONE)
        self._voco_content_type_observed = True
        self._voco_content_type_known = True
        self._voco_content_type_established = True
        self._voco_content_type_revision = self.context_revision
        self._voco_target_identity = self.focus_identity
        self._voco_target_capabilities = int(IBus.Capabilite.PREEDIT_TEXT)

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

    @property
    def can_accept_preedit(self) -> bool:
        return VocoEngine.can_accept_preedit.fget(self)


class EngineContextTransitionTests(unittest.TestCase):
    def test_equal_transport_capabilities_survive_context_switch_but_metadata_does_not(self):
        engine = FocusEngineDouble()
        VocoEngine._leave_focus(engine)
        VocoEngine._enter_focus(engine, ("id", "/new-widget", "gtk3"))
        self.assertFalse(engine.can_accept_preedit)
        self.assertEqual(engine._voco_target_capabilities, int(IBus.Capabilite.PREEDIT_TEXT))
        VocoEngine.do_set_content_type(engine, int(IBus.InputPurpose.FREE_FORM), int(IBus.InputHints.SPELLCHECK))
        self.assertTrue(engine.can_accept_preedit)


    def test_id_change_without_focus_out_revokes_content_proof(self) -> None:
        engine = FocusEngineDouble()
        VocoEngine._enter_focus(engine, ("id", "/new", "client"))
        self.assertEqual(engine.context_revision, 8)
        self.assertEqual(engine.focus_identity, ("id", "/new", "client"))
        self.assertIsNone(engine._voco_content_type_revision)
        self.assertFalse(engine._voco_content_type_observed)
        self.assertIsNone(engine.coordinator.focused_engine)

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

    def test_content_type_proof_must_match_current_context_revision(self) -> None:
        engine = FocusEngineDouble()
        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))
        engine.context_revision += 1
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))

    def test_same_real_target_requires_fresh_content_type_after_focus_loss(
        self,
    ) -> None:
        engine = FocusEngineDouble()
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
        self.assertFalse(engine.coordinator.poll_trigger("Alt+D")["armed"])

        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.SPELLCHECK),
        )
        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))

    def test_ambiguous_default_revokes_established_safe_proof(self) -> None:
        engine = FocusEngineDouble()
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
        self.assertFalse(engine.coordinator.poll_trigger("Alt+D")["armed"])

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
                self.assertFalse(engine.coordinator.poll_trigger("Alt+D")["armed"])

                VocoEngine.do_set_content_type(
                    engine,
                    int(IBus.InputPurpose.FREE_FORM),
                    int(IBus.InputHints.NONE),
                )

                self.assertIsNone(engine._voco_content_type_revision)
                self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))

    def test_new_id_context_cannot_reuse_another_contexts_content_type(self) -> None:
        engine = FocusEngineDouble()
        engine.coordinator = VocoCoordinator()
        engine.focus_active = False
        engine.focus_identity = None

        VocoEngine._enter_focus(engine, ("id", "/new", "client"))
        engine.coordinator.activate_engine(engine)

        self.assertFalse(engine._voco_content_type_observed)
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        self.assertFalse(engine.coordinator.poll_trigger("Alt+D")["armed"])

    def test_preedit_capable_client_without_content_type_callback_fails_closed(
        self,
    ) -> None:
        engine = FocusEngineDouble()
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
        self.assertFalse(engine.coordinator.poll_trigger("Alt+D")["armed"])

    def test_fresh_default_content_type_cannot_become_proof_through_fake_proxy(
        self,
    ) -> None:
        engine = FocusEngineDouble()
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
        self.assertFalse(engine.coordinator.poll_trigger("Alt+D")["armed"])

        VocoEngine._leave_focus(engine)
        engine.coordinator.deactivate_engine(engine)
        VocoEngine._enter_focus(engine, ("id", "/safe", "client"))
        engine.coordinator.activate_engine(engine)

        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        self.assertFalse(engine._voco_content_type_observed)
        self.assertIsNone(engine._voco_content_type_revision)
        self.assertFalse(VocoEngine.can_accept_preedit.fget(engine))
        self.assertFalse(engine.coordinator.poll_trigger("Alt+D")["armed"])

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
        self.assertFalse(engine.coordinator.poll_trigger("Alt+D")["armed"])

        VocoEngine.do_set_content_type(
            engine,
            int(IBus.InputPurpose.FREE_FORM),
            int(IBus.InputHints.SPELLCHECK),
        )
        self.assertTrue(VocoEngine.can_accept_preedit.fget(engine))

    def test_fake_proxy_cannot_supply_preedit_capability_for_real_target(self) -> None:
        engine = FocusEngineDouble()
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



class SessionControlHotkeyTests(unittest.TestCase):
    def test_unmodified_or_shift_only_hotkeys_cannot_arm(self) -> None:
        coordinator = VocoCoordinator()
        for hotkey in ("F8", "Shift+D", "E"):
            with self.subTest(hotkey=hotkey):
                with self.assertRaises(ValueError):
                    coordinator.poll_trigger(hotkey)

    def test_shifted_or_altgr_key_does_not_match_a_modified_shortcut(self) -> None:
        coordinator = VocoCoordinator()
        engine = FakeEngine()
        coordinator.activate_engine(engine)
        coordinator.poll_trigger("Alt+E")
        key = IBus.keyval_from_name("e")
        alt = int(IBus.ModifierType.MOD1_MASK)
        for extra in (IBus.ModifierType.MOD5_MASK, IBus.ModifierType.SHIFT_MASK):
            self.assertFalse(coordinator.consume_shortcut(engine, key, alt | int(extra)))
        self.assertTrue(coordinator.consume_shortcut(engine, key, alt))

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
        self.trigger()
        self.assertIsNone(self.coordinator.poll_trigger('Alt+D')['trigger'])

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

    def test_protocol_rejects_passive_start_without_token(self):
        from voco_ibus_engine import dispatch_command
        with self.assertRaisesRegex(RuntimeError, 'original text field'):
            dispatch_command(self.coordinator, {'operation': 'start', 'clientSessionId': 1})

    def test_public_mutations_reject_even_with_valid_token(self):
        from voco_ibus_engine import dispatch_command
        token = self.trigger()
        for operation in ('start', 'update', 'commit', 'checkpoint', 'finish-canonical', 'cancel'):
            with self.subTest(operation=operation):
                with self.assertRaisesRegex(RuntimeError, 'original text field'):
                    dispatch_command(self.coordinator, dict(operation=operation,
                        triggerId=token, clientSessionId=41, sessionId=41,
                        confirmedText='', preeditText='draft', provisionalText='draft',
                        text='never insert', expectedCommittedText='', appendText='never insert'))
        status = dispatch_command(self.coordinator, {'operation': 'status'})
        self.assertFalse(status['ready'])
        self.assertFalse(status['ownershipIntact'])
        self.assertEqual(status['setupState'], 'safety-disabled')
        self.assertIsNone(status['sessionId'])

    def test_status_reply_bytes_stay_decodable_by_earlier_protocol_6_apps(self):
        from voco_ibus_engine import dispatch_command
        from voco_ibus_protocol import MAX_RESPONSE_BYTES, encode_message
        expected = (
            '{"ready":false,"setupState":"safety-disabled","sessionId":null,'
            '"engineActive":false,"focusLost":%s,"progressiveCommitActive":false,'
            '"committedCharacterCount":0,"ownershipIntact":false,"finalizationOutcome":null,'
            '"error":"Automatic IBus delivery is disabled because the original text field '
            'cannot be verified. Recording remains available; review and copy the '
            'transcript in VOCO."}\n'
        )
        for focus_lost in (False, True):
            self.coordinator.focus_lost = focus_lost
            for operation in ('hello', 'status'):
                with self.subTest(operation=operation, focus_lost=focus_lost):
                    reply = dispatch_command(self.coordinator, {'operation': operation})
                    self.assertEqual(encode_message(reply, MAX_RESPONSE_BYTES),
                                     (expected % str(focus_lost).lower()).encode())

    def test_registration_change_discards_old_trigger_and_uses_new_chord(self):
        self.trigger()
        self.coordinator.consumed_shortcut_keys.clear()
        self.coordinator.poll_trigger('Ctrl+Shift+V')
        self.assertFalse(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))
        self.assertTrue(self.coordinator.consume_shortcut(self.engine, IBus.keyval_from_name('v'), int(IBus.ModifierType.CONTROL_MASK | IBus.ModifierType.SHIFT_MASK)))

    def test_dead_client_does_not_consume_fresh_press_after_consumed_release(self):
        self.trigger()
        self.coordinator.disconnect_client()
        self.assertTrue(self.coordinator.consume_shortcut(self.engine, self.key, self.alt | int(IBus.ModifierType.RELEASE_MASK)))
        self.assertFalse(self.coordinator.consume_shortcut(self.engine, self.key, self.alt))


if __name__ == "__main__":
    unittest.main()
