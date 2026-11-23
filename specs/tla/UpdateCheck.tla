----------------------------- MODULE UpdateCheck -----------------------------
(***************************************************************************)
(* The update check: `UpdateCheckCoordinator` in                           *)
(* apps/desktop/src/lib/updateCheckCoordinator.ts.                         *)
(*                                                                         *)
(* A check reads the cache, shows "checking", asks GitHub, writes the      *)
(* cache and shows the result.  It awaits between those steps, and         *)
(* meanwhile the person may change the update channel or another check     *)
(* may start.  A check whose channel is no longer selected, or that a      *)
(* newer one replaced, shows no result of its own.                         *)
(***************************************************************************)
EXTENDS Naturals

CONSTANTS Channels,  \* the update channels
          Runs       \* 1..N: the checks the model starts, in order

VARIABLES selected,  \* the channel selected in Settings
          started,   \* how many checks have started: the coordinator's generation
          channel,   \* each check's channel
          pc,        \* each check: "waiting", "reading", "checking", "writing", "done"
          active,    \* CheckRun: the stage of the newest check
          shown      \* what Settings shows: "before", "checking" or a check's result

vars == <<selected, started, channel, pc, active, shown>>

None == [kind |-> "none"]
Before == [kind |-> "before"]
Checking == [kind |-> "checking"]
Result(run) == [kind |-> "result", run |-> run]

Idle == [stage |-> "idle", run |-> 0, restore |-> None]

Init ==
  /\ selected \in Channels
  /\ started = 0
  /\ channel = [run \in Runs |-> CHOOSE c \in Channels : TRUE]
  /\ pc = [run \in Runs |-> "waiting"]
  /\ active = Idle
  /\ shown = Before

(* isCurrent: the newest check, for the channel still selected. *)
Current(run) == run = started /\ channel[run] = selected

(* settle: a check that is still the newest shows its result. *)
Settle(run) ==
  /\ active' = IF active.stage # "idle" /\ active.run = run THEN Idle ELSE active
  /\ shown' = Result(run)

(* abandon: while it is still the newest, what "checking" replaced comes back. *)
Abandon(run) ==
  IF active.stage # "idle" /\ active.run = run
  THEN /\ active' = Idle
       /\ shown' = IF active.restore = None THEN shown ELSE active.restore
  ELSE UNCHANGED <<active, shown>>

(* run(): a check starts and takes over from one still in flight. *)
Start(run, c) ==
  /\ run = started + 1 /\ run \in Runs
  /\ started' = run
  /\ channel' = [channel EXCEPT ![run] = c]
  /\ pc' = [pc EXCEPT ![run] = "reading"]
  /\ active' = [stage |-> "reading", run |-> run,
                restore |-> IF active.stage = "idle" THEN None ELSE active.restore]
  /\ UNCHANGED <<selected, shown>>

(* The cache was read: a cached result settles the check, or it asks GitHub. *)
CacheHit(run) ==
  /\ pc[run] = "reading" /\ Current(run)
  /\ Settle(run)
  /\ pc' = [pc EXCEPT ![run] = "done"]
  /\ UNCHANGED <<selected, started, channel>>

ShowChecking(run) ==
  /\ pc[run] = "reading" /\ Current(run)
  /\ active' = [stage |-> "checking", run |-> run,
                restore |-> IF active.restore = None THEN shown ELSE active.restore]
  /\ shown' = Checking
  /\ pc' = [pc EXCEPT ![run] = "checking"]
  /\ UNCHANGED <<selected, started, channel>>

(* GitHub answered, or the request failed: both are a result to show. *)
Answered(run) ==
  /\ pc[run] = "checking" /\ Current(run)
  /\ pc' = [pc EXCEPT ![run] = "writing"]
  /\ UNCHANGED <<selected, started, channel, active, shown>>

Written(run) ==
  /\ pc[run] = "writing" /\ Current(run)
  /\ Settle(run)
  /\ pc' = [pc EXCEPT ![run] = "done"]
  /\ UNCHANGED <<selected, started, channel>>

(* Any await may return to a check that is no longer current. *)
Dropped(run) ==
  /\ pc[run] \in {"reading", "checking", "writing"} /\ ~Current(run)
  /\ Abandon(run)
  /\ pc' = [pc EXCEPT ![run] = "done"]
  /\ UNCHANGED <<selected, started, channel>>

ChangeChannel(c) ==
  /\ c # selected
  /\ selected' = c
  /\ UNCHANGED <<started, channel, pc, active, shown>>

Next ==
  \/ \E run \in Runs, c \in Channels : Start(run, c)
  \/ \E run \in Runs : CacheHit(run) \/ ShowChecking(run) \/ Answered(run)
                         \/ Written(run) \/ Dropped(run)
  \/ \E c \in Channels : ChangeChannel(c)

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
InFlight(run) == pc[run] \in {"reading", "checking", "writing"}

TypeOK ==
  /\ active.stage \in {"idle", "reading", "checking"}
  /\ shown.kind \in {"before", "checking", "result"}
  /\ started \in {0} \cup Runs

(* The stage belongs to the newest check, while that check is in flight. *)
StageIsTheNewestChecks ==
  active.stage # "idle" => active.run = started /\ InFlight(started)

(* "Checking" is shown only while a check will still replace it: the one
   whose stage holds what it replaced. *)
CheckingIsNeverLeftBehind ==
  shown = Checking => active.stage # "idle" /\ active.restore \notin {None, Checking}

(* So once every check has ended, Settings shows a result or what it showed
   before, never "checking". *)
NoCheckNoChecking == (\A run \in Runs : ~InFlight(run)) => shown # Checking

(* A result comes on screen from the newest check, for the channel then
   selected, or comes back when the "checking" that replaced it is dropped. *)
OnlyTheSelectedChannelsResult ==
  [][\A run \in Runs :
       shown' = Result(run) /\ shown # Result(run) =>
         \/ run = started /\ channel[run] = selected
         \/ shown = Checking /\ active.restore = Result(run)]_vars
=============================================================================
