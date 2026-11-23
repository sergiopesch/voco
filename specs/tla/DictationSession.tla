--------------------------- MODULE DictationSession ---------------------------
(***************************************************************************)
(* One recording at a time in the renderer: the session of                 *)
(* apps/desktop/src/lib/dictationSession.ts, driven by the recorder in     *)
(* dictationRecording.ts, the hook's `toggle` in useDictation.ts and the   *)
(* request handler in App.tsx.                                             *)
(*                                                                         *)
(* Start and Stop are asynchronous.  Start checks its prerequisites before *)
(* it shows "starting", so for a moment only the session knows a           *)
(* recording has begun.  The shortcut toggles; the screen lock, the tray   *)
(* and a browser tab ask for Stop only; a failed microphone cancels.       *)
(***************************************************************************)
EXTENDS Naturals

CONSTANT MaxSessions  \* bounds the model

VARIABLES phase,      \* "idle", "starting", "recording", "stopping", "error"
          queued,     \* a Stop asked for while starting
          status,     \* what the store shows: idle, starting, recording, processing, error
          cancelled,  \* cancelledRef: this session was cancelled
          asked,      \* a Stop was asked of this session
          sessions    \* sessionId

vars == <<phase, queued, status, cancelled, asked, sessions>>

Active == phase \in {"starting", "recording", "stopping"}

Init ==
  /\ phase = "idle"
  /\ queued = FALSE
  /\ status = "idle"
  /\ cancelled = FALSE
  /\ asked = FALSE
  /\ sessions = 0

(* startRecording: startSession, with nothing shown yet. *)
Start ==
  /\ phase \in {"idle", "error"}
  /\ sessions < MaxSessions
  /\ phase' = "starting"
  /\ sessions' = sessions + 1
  /\ queued' = FALSE
  /\ cancelled' = FALSE
  /\ asked' = FALSE
  /\ UNCHANGED status

(* stopRecording: requestStop, and "processing" shown at once. *)
BeginStop ==
  /\ phase' = "stopping"
  /\ status' = "processing"
  /\ queued' = FALSE

(* requestToggle for a session that is starting or recording. *)
AskStop ==
  /\ asked' = TRUE
  /\ IF phase = "starting"
     THEN queued' = TRUE /\ UNCHANGED <<phase, status>>
     ELSE BeginStop
  /\ UNCHANGED <<cancelled, sessions>>

(* The shortcut: start, stop, or queue a Stop for a start in flight.  While
   stopping it changes nothing. *)
Toggle ==
  \/ Start
  \/ phase \in {"starting", "recording"} /\ AskStop

(* The screen lock, the tray's Stop or a tab's: App.tsx counts a session that
   has begun as active even before "starting" is shown, so this Stop is
   queued, never dropped.  With no session, or one already stopping, there is
   nothing to stop. *)
StopOnly == phase \in {"starting", "recording"} /\ AskStop

(* Start's checks passed: "starting" is shown. *)
StartShown ==
  /\ phase = "starting" /\ status \in {"idle", "error"}
  /\ status' = "starting"
  /\ UNCHANGED <<phase, queued, cancelled, asked, sessions>>

(* The microphone is live: markRecording, then consumeQueuedStop.  Every
   await of a start is followed by assertOutputAllowed, so a cancelled start
   never gets here. *)
StartSucceeds ==
  /\ phase = "starting" /\ status = "starting" /\ ~cancelled
  /\ IF queued
     THEN BeginStop
     ELSE phase' = "recording" /\ status' = "recording" /\ queued' = FALSE
  /\ UNCHANGED <<cancelled, asked, sessions>>

(* A start that fails ends idle, where it was refused or cancelled with
   nothing recorded, or in error. *)
StartFails ==
  /\ phase = "starting"
  /\ \E end \in {"idle", "error"} : phase' = end /\ status' = end
  /\ queued' = FALSE
  /\ UNCHANGED <<cancelled, asked, sessions>>

(* cancelRecording: a lost microphone or an interrupted capture. *)
Cancel ==
  /\ Active /\ ~cancelled
  /\ cancelled' = TRUE
  /\ IF phase = "recording" THEN BeginStop ELSE UNCHANGED <<phase, status, queued>>
  /\ UNCHANGED <<asked, sessions>>

(* Stop finished: finalizeIdleState, or interruptRecording. *)
StopCompletes ==
  /\ phase = "stopping"
  /\ \E end \in {"idle", "error"} : phase' = end /\ status' = end
  /\ queued' = FALSE
  /\ UNCHANGED <<cancelled, asked, sessions>>

Next ==
  \/ Toggle \/ StopOnly \/ StartShown \/ StartSucceeds \/ StartFails
  \/ Cancel \/ StopCompletes

Spec ==
  /\ Init /\ [][Next]_vars
  /\ WF_vars(StartShown)
  /\ WF_vars(StartSucceeds \/ StartFails)
  /\ WF_vars(StopCompletes)

-----------------------------------------------------------------------------
TypeOK ==
  /\ phase \in {"idle", "starting", "recording", "stopping", "error"}
  /\ status \in {"idle", "starting", "recording", "processing", "error"}
  /\ queued \in BOOLEAN /\ cancelled \in BOOLEAN /\ asked \in BOOLEAN

(* A Stop waits only for a start in flight. *)
QueuedOnlyWhileStarting == queued => phase = "starting"

(* The store shows the session's phase, but for a start not shown yet. *)
StatusFollowsPhase ==
  /\ status = "recording" <=> phase = "recording"
  /\ status = "processing" <=> phase = "stopping"
  /\ status = "starting" => phase = "starting"
  /\ phase = "idle" => status = "idle"
  /\ phase = "error" => status = "error"

(* Once a Stop was asked of a session, it never records: asked while it
   started, the Stop runs the moment the microphone is live. *)
AStopNeverLeavesItsSessionRecording == asked => phase # "recording"

(* A cancelled session never records either. *)
ACancelledSessionNeverRecords == cancelled => phase # "recording"

(* And each ends: no session is left starting or stopping for ever. *)
AStopEndsItsSession == (asked /\ Active) ~> ~Active
ACancelEndsItsSession == (cancelled /\ Active) ~> ~Active
=============================================================================
