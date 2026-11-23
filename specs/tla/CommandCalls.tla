---------------------------- MODULE CommandCalls ----------------------------
(***************************************************************************)
(* The `voco --toggle` calls of a desktop shortcut, outside the snap:      *)
(* `CommandTrain` in apps/desktop/src-tauri/src/shortcut_arbitration.rs.   *)
(*                                                                         *)
(* The desktop runs the command for a key's press and again for each       *)
(* repeat while it is held, and reports no release.  A call within Train   *)
(* of the last is a repeat.  One after Quiet of silence is a press.  One   *)
(* in between is a press or a held key's first repeat: a timer, Train      *)
(* later, takes it for a press unless a repeat followed it.                *)
(*                                                                         *)
(* Time is counted in ticks.  A timer never fires early and may fire as    *)
(* late as it likes, as a sleeping thread does.                            *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS Train,     \* COMMAND_TRAIN, in ticks
          Quiet,     \* COMMAND_QUIET, in ticks
          MaxTime,   \* bounds the model
          MaxCalls   \* bounds the model

ASSUME /\ Train \in Nat /\ Quiet \in Nat
       /\ 0 < Train /\ Train < Quiet

VARIABLES now,      \* the clock
          train,    \* CommandTrain: Idle, Settled {last}, Unsettled {last, serial}
          timers,   \* timers started and not yet fired: [serial, due]
          calls,    \* history: each call's time and what it was taken for
          toggles   \* history: how often each call toggled dictation

vars == <<now, train, timers, calls, toggles>>

Idle == [state |-> "Idle", last |-> 0, serial |-> 0]
Settled(last) == [state |-> "Settled", last |-> last, serial |-> 0]
Unsettled(last, serial) == [state |-> "Unsettled", last |-> last, serial |-> serial]

Init ==
  /\ now = 0
  /\ train = Idle
  /\ timers = {}
  /\ calls = <<>>
  /\ toggles = <<>>

(* CommandTrain::call.  A call's serial is its place in the history. *)
Call ==
  /\ Len(calls) < MaxCalls
  /\ LET n    == Len(calls) + 1
         seen == train.state # "Idle"
         gap  == now - train.last
         open == train.state = "Unsettled"
         \* An open call before this one was a press after all.
         earlier == IF open THEN [toggles EXCEPT ![n - 1] = @ + 1] ELSE toggles
     IN
     IF seen /\ gap < Train THEN
       /\ train' = Settled(now)
       /\ calls' = Append(calls, [at |-> now, kind |-> "Repeat"])
       /\ toggles' = Append(toggles, 0)
       /\ UNCHANGED timers
     ELSE IF seen /\ gap < Quiet THEN
       /\ train' = Unsettled(now, n)
       /\ calls' = Append(calls, [at |-> now, kind |-> "Unsettled"])
       /\ toggles' = Append(earlier, 0)
       /\ timers' = timers \cup {[serial |-> n, due |-> now + Train]}
     ELSE
       /\ train' = Settled(now)
       /\ calls' = Append(calls, [at |-> now, kind |-> "Press"])
       /\ toggles' = Append(earlier, 1)
       /\ UNCHANGED timers
  /\ UNCHANGED now

(* CommandTrain::timer. *)
Timer(t) ==
  /\ t \in timers
  /\ now >= t.due
  /\ timers' = timers \ {t}
  /\ IF train.state = "Unsettled" /\ train.serial = t.serial
     THEN /\ train' = Settled(train.last)
          /\ toggles' = [toggles EXCEPT ![t.serial] = @ + 1]
     ELSE UNCHANGED <<train, toggles>>
  /\ UNCHANGED <<now, calls>>

Tick ==
  /\ now < MaxTime
  /\ now' = now + 1
  /\ UNCHANGED <<train, timers, calls, toggles>>

Next == Call \/ Tick \/ \E t \in timers : Timer(t)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
Indexes == 1..Len(calls)

TypeOK ==
  /\ now \in 0..MaxTime
  /\ train.state \in {"Idle", "Settled", "Unsettled"}
  /\ Len(toggles) = Len(calls)
  /\ \A t \in timers : t.serial \in Indexes

(* The three states are the only ones: an open call is always the last. *)
StateMatchesHistory ==
  /\ train.state = "Idle" <=> calls = <<>>
  /\ train.state # "Idle" => train.last = calls[Len(calls)].at
  /\ train.state = "Unsettled" =>
       /\ train.serial = Len(calls)
       /\ calls[Len(calls)].kind = "Unsettled"

Gap(i) == calls[i].at - calls[i - 1].at

(* What each call is taken for depends only on the gap before it. *)
KindOK ==
  \A i \in Indexes :
    calls[i].kind = IF i = 1 THEN "Press"
                    ELSE IF Gap(i) < Train THEN "Repeat"
                    ELSE IF Gap(i) < Quiet THEN "Unsettled"
                    ELSE "Press"

TimerPending(i) == \E t \in timers : t.serial = i

(* Nothing more can change what call i did. *)
Decided(i) == calls[i].kind # "Unsettled" \/ i < Len(calls) \/ ~TimerPending(i)

(* What a decided call did: a press toggles, a repeat doesn't, and a call in
   between toggles unless a repeat followed it. *)
Expected(i) ==
  CASE calls[i].kind = "Press" -> 1
    [] calls[i].kind = "Repeat" -> 0
    [] OTHER -> IF i < Len(calls) /\ Gap(i + 1) < Train THEN 0 ELSE 1

EveryCallDecidedOnce ==
  \A i \in Indexes :
    /\ toggles[i] <= 1
    /\ toggles[i] = IF Decided(i) THEN Expected(i) ELSE 0

RECURSIVE Sum(_)
Sum(s) == IF s = <<>> THEN 0 ELSE Head(s) + Sum(Tail(s))

(* One held key: its press, a first repeat sooner than Quiet, and at least
   one more repeat, each sooner than Train after the last. *)
OneHeldKey ==
  /\ Len(calls) >= 3
  /\ Gap(2) < Quiet
  /\ \A i \in 3..Len(calls) : Gap(i) < Train

(* However long it is held, and however late its timer runs, it toggles once. *)
HeldKeyTogglesOnce == OneHeldKey => Sum(toggles) = 1

(* Taps: calls Train or more apart, the last one decided. *)
OnlyTaps ==
  /\ \A i \in 2..Len(calls) : Gap(i) >= Train
  /\ \A i \in Indexes : Decided(i)

EveryTapToggles == OnlyTaps => Sum(toggles) = Len(calls)
=============================================================================
