from __future__ import annotations

import unittest

from voco_ibus_ownership import (
    FinalizationAction,
    OwnedPreeditLease,
)


SESSION_ID = 73
CONTEXT_REVISION = 11


def deletion_commands(plan):
    return [
        command
        for command in plan.commands()
        if command.operation == "delete-surrounding-text"
    ]


class OwnedPreeditLeaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.lease = OwnedPreeditLease()
        self.lease.bind_session(SESSION_ID, CONTEXT_REVISION)

    def plan(
        self,
        committed_text: str,
        final_text: str,
        *,
        session_id: int = SESSION_ID,
        context_revision: int = CONTEXT_REVISION,
        ownership_intact: bool = True,
    ):
        return self.lease.plan(
            session_id,
            context_revision,
            ownership_intact,
            committed_text,
            final_text,
        )

    def assert_preserved_without_commands(self, plan) -> None:
        self.assertEqual(plan.action, FinalizationAction.PRESERVE)
        self.assertEqual(plan.commands(), ())
        self.assertEqual(deletion_commands(plan), [])

    def test_final_without_progressive_commits_replaces_only_owned_preedit(self) -> None:
        plan = self.plan("", "authoritative final words")

        self.assertEqual(plan.action, FinalizationAction.COMMIT)
        self.assertEqual(len(plan.commands()), 1)
        self.assertEqual(plan.commands()[0].operation, "commit-text")
        self.assertEqual(plan.commands()[0].text, "authoritative final words")
        self.assertEqual(deletion_commands(plan), [])

    def test_exact_final_needs_no_target_command(self) -> None:
        plan = self.plan("already committed", "already committed")

        self.assertEqual(plan.action, FinalizationAction.COMMIT)
        self.assertEqual(plan.commands(), ())

    def test_changed_final_never_rewrites_progressively_committed_text(self) -> None:
        self.assert_preserved_without_commands(
            self.plan("committed live words", "authoritative final words")
        )

    def test_final_suffix_is_not_injected_after_progressive_commits(self) -> None:
        self.assert_preserved_without_commands(
            self.plan("committed prefix", "committed prefix final suffix")
        )

    def test_stale_session_is_rejected(self) -> None:
        self.assert_preserved_without_commands(
            self.plan("", "final", session_id=SESSION_ID + 1)
        )

    def test_changed_focus_context_is_rejected(self) -> None:
        self.assert_preserved_without_commands(
            self.plan("", "final", context_revision=CONTEXT_REVISION + 1)
        )

    def test_cursor_or_selection_reset_invalidates_the_lease(self) -> None:
        self.lease.invalidate()
        self.assert_preserved_without_commands(self.plan("", "final"))

    def test_external_key_activity_is_rejected(self) -> None:
        self.assert_preserved_without_commands(
            self.plan("", "final", ownership_intact=False)
        )

    def test_target_close_or_cancellation_unbinds_the_lease(self) -> None:
        self.lease.unbind_session()
        self.assert_preserved_without_commands(self.plan("", "final"))

    def test_finalization_after_a_new_session_begins_is_rejected(self) -> None:
        self.lease.bind_session(SESSION_ID + 1, CONTEXT_REVISION + 1)
        self.assert_preserved_without_commands(self.plan("", "old final"))

    def test_repeated_finalization_is_rejected(self) -> None:
        first = self.plan("", "final")
        second = self.plan("", "delayed final")

        self.assertEqual(first.action, FinalizationAction.COMMIT)
        self.assert_preserved_without_commands(second)

    def test_empty_final_emits_no_command(self) -> None:
        plan = self.plan("", "")
        self.assertEqual(plan.action, FinalizationAction.COMMIT)
        self.assertEqual(plan.commands(), ())

    def test_unicode_and_punctuation_never_produce_offsets(self) -> None:
        plan = self.plan("“café 👩\u200d💻 — done!”", "A different final.")
        self.assert_preserved_without_commands(plan)
        self.assertFalse(any(hasattr(command, "offset") for command in plan.commands()))

    def test_partial_match_is_preserved(self) -> None:
        self.assert_preserved_without_commands(
            self.plan("complete owned text", "owned text")
        )

    def test_long_synthetic_mismatch_emits_no_command(self) -> None:
        live = " ".join(f"live{index}" for index in range(220)) + " provisional tail"
        final = " ".join(f"exact{index}" for index in range(180))
        self.assert_preserved_without_commands(self.plan(live, final))


if __name__ == "__main__":
    unittest.main()
