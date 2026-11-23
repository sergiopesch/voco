--------------------------- MODULE ShortcutPresses ---------------------------
(***************************************************************************)
(* The `Toggle` calls of the snap's GNOME shortcut: `Presses` in           *)
(* apps/desktop/src-tauri/src/gnome_shortcut.rs.                           *)
(*                                                                         *)
(* GNOME runs the shortcut's command for the chord's press and again for   *)
(* each repeat while it is held, and reports no release.  It can deliver   *)
(* one press twice, at once.  VOCO tells a press from a repeat by GNOME's  *)
(* repeat timing alone here: this is the route where GNOME says nothing    *)
(* of the modifiers, as on GNOME 46.                                       *)
(*                                                                         *)
(* The model holds a chord down and lets it go, as a person does, and      *)
(* GNOME's keyboard repeat makes the calls.  Time is counted in ticks.     *)
(***************************************************************************)
EXTENDS Naturals, Sequences

CONSTANTS Delay,     \* the keyboard's repeat delay
          Interval,  \* its repeat interval
          Margin,    \* REPEAT_MARGIN
          Jitter,    \* how far a repeat may run early or late
          MaxTime, MaxPresses, MaxCalls

Max(a, b) == IF a > b THEN a ELSE b
Minus(a, b) == IF a > b THEN a - b ELSE 0

Train == Interval + Margin
\* A chord silent this long has been let go: the longest wait for any repeat.
Silence == Max(Delay, Interval) + Margin

ASSUME /\ Delay \in Nat /\ Interval \in Nat /\ Margin \in Nat /\ Jitter \in Nat
       /\ 0 < Interval /\ Interval <= Delay
       /\ Jitter < Margin

VARIABLES now,
          presses,   \* Presses: Idle, Pressed {at, seen}, Repeating {last}
          key,       \* the chord: "up" or "down"
          due,       \* while down, when GNOME's next repeat is due
          twice,     \* GNOME may still deliver this press a second time
          lastCall,  \* the last call's time
          pressed,   \* how often the chord was pressed
          toggled,   \* how often VOCO toggled
          calls      \* how many calls were made

vars == <<now, presses, key, due, twice, lastCall, pressed, toggled, calls>>

Idle == [state |-> "Idle", at |-> 0, seen |-> 0]
Pressed(at, seen) == [state |-> "Pressed", at |-> at, seen |-> seen]
Repeating(last) == [state |-> "Repeating", at |-> last, seen |-> last]

(* Presses::classify *)
Classify ==
  CASE presses.state = "Idle" -> "Press"
    [] presses.state = "Pressed" ->
         LET gap == now - presses.at IN
         IF gap + Margin >= Delay /\ gap < Max(Delay, Interval) + Margin THEN "Repeat"
         ELSE IF gap < Train THEN "SamePress"
         ELSE "Press"
    [] presses.state = "Repeating" ->
         IF now - presses.at < Max(Minus(Delay, Margin), Train) THEN "Repeat" ELSE "Press"

(* Presses::call, with no word from GNOME on the modifiers. *)
Call ==
  LET call == Classify IN
  /\ presses' = CASE call = "SamePress" -> Pressed(presses.at, now)
                  [] call = "Repeat" -> Repeating(now)
                  [] OTHER -> Pressed(now, now)
  /\ toggled' = IF call = "Press" THEN toggled + 1 ELSE toggled
  /\ lastCall' = now
  /\ calls' = calls + 1

Init ==
  /\ now = 0
  /\ presses = Idle
  /\ key = "up"
  /\ due = 0
  /\ twice = FALSE
  /\ lastCall = 0
  /\ pressed = 0
  /\ toggled = 0
  /\ calls = 0

(* The chord goes down once the calls of the last press have gone silent. *)
PressChord ==
  /\ key = "up"
  /\ pressed < MaxPresses /\ calls < MaxCalls
  /\ pressed = 0 \/ now - lastCall >= Silence
  /\ key' = "down"
  /\ due' = now + Delay
  /\ twice' = TRUE
  /\ pressed' = pressed + 1
  /\ Call
  /\ UNCHANGED now

(* GNOME delivers the same press again, at once: before a repeat could come. *)
DeliverTwice ==
  /\ key = "down" /\ twice
  /\ calls < MaxCalls
  /\ now - presses.at < Train
  /\ now + Margin < presses.at + Delay
  /\ presses.state = "Pressed"
  /\ twice' = FALSE
  /\ Call
  /\ UNCHANGED <<now, key, due, pressed>>

(* GNOME's keyboard repeat, up to Jitter early or late. *)
RepeatChord ==
  /\ key = "down"
  /\ calls < MaxCalls
  /\ now + Jitter >= due
  /\ due' = now + Interval
  /\ twice' = FALSE
  /\ Call
  /\ UNCHANGED <<now, key, pressed>>

ReleaseChord ==
  /\ key = "down"
  /\ key' = "up"
  /\ UNCHANGED <<now, presses, due, twice, lastCall, pressed, toggled, calls>>

(* Time passes, but never past a repeat that GNOME owes a held chord. *)
Tick ==
  /\ now < MaxTime
  /\ key = "down" => now < due + Jitter
  /\ now' = now + 1
  /\ UNCHANGED <<presses, key, due, twice, lastCall, pressed, toggled, calls>>

Next == PressChord \/ DeliverTwice \/ RepeatChord \/ ReleaseChord \/ Tick

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK ==
  /\ presses.state \in {"Idle", "Pressed", "Repeating"}
  /\ key \in {"up", "down"}
  /\ presses.state = "Idle" <=> calls = 0

(* The last call is the one the state remembers. *)
StateMatchesHistory ==
  presses.state # "Idle" => presses.seen = lastCall /\ presses.at <= presses.seen

(* However long a chord is held, and whether or not GNOME delivered its
   press twice, it toggles once. *)
EveryPressTogglesOnce == toggled = pressed
=============================================================================
