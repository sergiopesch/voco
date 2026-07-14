"""Pure finalization model for VOCO's IBus-owned preedit.

Generic IBus surrounding text is cached and has no target-bound revision or
freshness acknowledgement. It therefore cannot authorize destructive editing.
This model can only commit text that is still wholly owned as preedit, or
preserve the target unchanged.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class FinalizationAction(str, Enum):
    COMMIT = "commit"
    PRESERVE = "preserve"


@dataclass(frozen=True)
class FinalizationCommand:
    operation: str
    text: str = ""


@dataclass(frozen=True)
class FinalizationPlan:
    action: FinalizationAction
    commit_text: str = ""

    def commands(self) -> tuple[FinalizationCommand, ...]:
        if self.action == FinalizationAction.COMMIT and self.commit_text:
            return (FinalizationCommand("commit-text", text=self.commit_text),)
        return ()


class OwnedPreeditLease:
    """Binds non-destructive finalization to one active input context."""

    def __init__(self) -> None:
        self._session_id: Optional[int] = None
        self._context_revision: Optional[int] = None
        self._ownership_intact = False

    def bind_session(self, session_id: int, context_revision: int) -> None:
        self._session_id = session_id
        self._context_revision = context_revision
        self._ownership_intact = True

    def unbind_session(self) -> None:
        self._session_id = None
        self._context_revision = None
        self._ownership_intact = False

    def invalidate(self) -> None:
        self._ownership_intact = False

    def plan(
        self,
        session_id: int,
        context_revision: int,
        ownership_intact: bool,
        committed_text: str,
        final_text: str,
    ) -> FinalizationPlan:
        preserve = FinalizationPlan(FinalizationAction.PRESERVE)
        if (
            not ownership_intact
            or not self._ownership_intact
            or session_id != self._session_id
            or context_revision != self._context_revision
        ):
            return preserve

        # Progressively committed text is already ordinary application text.
        # Without a fresh, atomic editor lease IBus cannot prove that it remains
        # next to the cursor, so VOCO never rewrites or appends to that range.
        # An exact final needs no target mutation and is safe to acknowledge.
        if committed_text:
            if final_text == committed_text:
                self._ownership_intact = False
                return FinalizationPlan(FinalizationAction.COMMIT)
            return preserve

        # With no normal target text to reconcile, the full final replaces only
        # VOCO's currently owned preedit. The engine clears that preedit before
        # executing this non-destructive commit command.
        self._ownership_intact = False
        return FinalizationPlan(
            FinalizationAction.COMMIT,
            commit_text=final_text,
        )
