---------------------------- MODULE NativeCapture ----------------------------
(***************************************************************************)
(* One native capture in the renderer: the session `beginNativeCapture`    *)
(* returns in apps/desktop/src/lib/nativeCapture.ts.                       *)
(*                                                                         *)
(* It polls Rust for audio between activation and Stop.  Stop is asked     *)
(* for once and drains the tail; Cancel ends the capture from any phase.   *)
(* An interruption, an unhealthy receipt or a failed drain, is reported    *)
(* once: a failed capture polls no more, and its owner stops or cancels    *)
(* it.                                                                     *)
(***************************************************************************)
EXTENDS Naturals

VARIABLES phase,     \* "begun", "delivering", "stopping", "stopped", "cancelled"
          failed,    \* an interruption was recorded
          reported,  \* how often the owner heard of an interruption
          polling,   \* a poll is scheduled or in flight
          stop       \* Stop's answer: "none", "waiting", "confirmed", "rejected"

vars == <<phase, failed, reported, polling, stop>>

Init ==
  /\ phase = "begun"
  /\ failed = FALSE
  /\ reported = 0
  /\ polling = FALSE
  /\ stop = "none"

(* interrupt(): recorded and reported once, never for a cancelled capture. *)
Interrupt ==
  IF failed \/ phase = "cancelled"
  THEN UNCHANGED <<failed, reported>>
  ELSE failed' = TRUE /\ reported' = reported + 1

(* startDelivery() *)
StartDelivery ==
  /\ phase = "begun"
  /\ phase' = "delivering"
  /\ polling' = ~failed
  /\ UNCHANGED <<failed, reported, stop>>

(* A poll answers with audio and schedules the next. *)
PollDelivers ==
  /\ polling /\ phase = "delivering" /\ ~failed
  /\ UNCHANGED vars

(* A poll finds the capture unhealthy, a gap, or no answer in time. *)
PollFails ==
  /\ polling
  /\ Interrupt
  /\ polling' = FALSE
  /\ UNCHANGED <<phase, stop>>

(* A poll in flight when Stop or Cancel came returns to a capture that no
   longer polls. *)
PollEnds ==
  /\ polling /\ phase # "delivering"
  /\ polling' = FALSE
  /\ UNCHANGED <<phase, failed, reported, stop>>

(* stopAndDrain(), the first time: later calls get the same answer. *)
Stop ==
  /\ phase \in {"begun", "delivering"}
  /\ phase' = "stopping"
  /\ stop' = "waiting"
  /\ UNCHANGED <<failed, reported, polling>>

(* Rust confirmed the tail and every block is acknowledged. *)
TailConfirmed ==
  /\ phase = "stopping" /\ stop = "waiting" /\ ~failed
  /\ ~polling
  /\ phase' = "stopped"
  /\ stop' = "confirmed"
  /\ UNCHANGED <<failed, reported, polling>>

(* The tail wasn't confirmed in time, or the capture had failed. *)
StopRejected ==
  /\ phase = "stopping" /\ stop = "waiting"
  /\ ~polling
  /\ Interrupt
  /\ stop' = "rejected"
  /\ UNCHANGED <<phase, polling>>

(* Stop was asked of a capture already cancelled, or cancelled while it waited. *)
StopCancelled ==
  /\ phase = "cancelled" /\ stop \in {"none", "waiting"}
  /\ stop' = "rejected"
  /\ UNCHANGED <<phase, failed, reported, polling>>

(* cancel() *)
Cancel ==
  /\ phase # "cancelled"
  /\ phase' = "cancelled"
  /\ UNCHANGED <<failed, reported, polling, stop>>

Next ==
  \/ StartDelivery \/ PollDelivers \/ PollFails \/ PollEnds
  \/ Stop \/ TailConfirmed \/ StopRejected \/ StopCancelled \/ Cancel

Spec == Init /\ [][Next]_vars /\ WF_vars(PollEnds) /\ WF_vars(PollFails)

-----------------------------------------------------------------------------
TypeOK ==
  /\ phase \in {"begun", "delivering", "stopping", "stopped", "cancelled"}
  /\ stop \in {"none", "waiting", "confirmed", "rejected"}
  /\ reported \in 0..1

(* The owner hears of an interruption once, and only of one that happened. *)
ReportedOnce == reported = IF failed THEN 1 ELSE 0

(* A capture that stopped is one whose tail was confirmed and that never
   failed: a failed capture is never taken for a complete recording. *)
StoppedMeansComplete ==
  /\ phase = "stopped" => stop = "confirmed" /\ ~failed /\ ~polling
  /\ stop = "confirmed" => phase \in {"stopped", "cancelled"}

(* Stop has an answer only once it was asked for, or of a cancelled capture. *)
StopFollowsItsPhase ==
  /\ phase \in {"begun", "delivering"} => stop = "none"
  /\ phase = "stopping" => stop \in {"waiting", "rejected"}

(* Polling starts only at activation: never before it, and never again. *)
PollsOnlyAfterActivation ==
  [][polling' /\ ~polling => phase = "begun" /\ phase' = "delivering"]_vars

(* The phases only move forward, and Cancel is final. *)
PhasesInOrder ==
  [][/\ phase = "cancelled" => phase' = "cancelled"
     /\ phase = "stopped" => phase' \in {"stopped", "cancelled"}
     /\ phase = "stopping" => phase' \in {"stopping", "stopped", "cancelled"}
     /\ phase = "delivering" => phase' # "begun"]_vars

(* An interruption is never reported for a cancelled capture. *)
NoReportAfterCancel ==
  [][phase = "cancelled" => reported' = reported]_vars
=============================================================================
