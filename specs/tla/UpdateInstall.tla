---------------------------- MODULE UpdateInstall ----------------------------
(***************************************************************************)
(* Install update and the recognition sessions it excludes: `Install` and  *)
(* `Gate` in apps/desktop/src-tauri/src/update_install.rs.                 *)
(*                                                                         *)
(* An install downloads and checks a release, which Cancel still stops,    *)
(* then closes the gate for the system's password prompt and the package   *)
(* manager.  From there nothing cancels it and no recognition starts.      *)
(* Once the release is installed this VOCO only waits to be replaced.      *)
(***************************************************************************)
EXTENDS Naturals

CONSTANT MaxInstalls  \* bounds the model

VARIABLES install,    \* Install: "Idle", "Fetching", "Installing", "Installed"
          cancelled,  \* the current install's Cancel was chosen
          accepted,   \* Cancel answered that the install will stop
          session,    \* a recognition session: "none", "fresh" or "stale"
          dictating,  \* the renderer reports dictation
          installs    \* how many installs have started

vars == <<install, cancelled, accepted, session, dictating, installs>>

Init ==
  /\ install = "Idle"
  /\ cancelled = FALSE
  /\ accepted = FALSE
  /\ session = "none"
  /\ dictating = FALSE
  /\ installs = 0

(* Gate::begin *)
Begin ==
  /\ install = "Idle"
  /\ installs < MaxInstalls
  /\ ~dictating
  /\ install' = "Fetching"
  /\ cancelled' = FALSE
  /\ accepted' = FALSE
  /\ installs' = installs + 1
  /\ UNCHANGED <<session, dictating>>

(* Gate::cancel: accepted only while the release downloads or is checked. *)
Cancel ==
  /\ install = "Fetching"
  /\ cancelled' = TRUE
  /\ accepted' = TRUE
  /\ UNCHANGED <<install, session, dictating, installs>>

(* Gate::abandon: the download failed, or stopped because it was cancelled. *)
Abandon ==
  /\ install = "Fetching"
  /\ install' = "Idle"
  /\ UNCHANGED <<cancelled, accepted, session, dictating, installs>>

(* Gate::close: downloaded and checked, at the password prompt's door. *)
Close ==
  /\ install = "Fetching"
  /\ install' = IF cancelled \/ dictating \/ session = "fresh" THEN "Idle" ELSE "Installing"
  /\ UNCHANGED <<cancelled, accepted, session, dictating, installs>>

(* Gate::reopen: the helper installed nothing. *)
HelperFails ==
  /\ install = "Installing"
  /\ install' = "Idle"
  /\ UNCHANGED <<cancelled, accepted, session, dictating, installs>>

(* Gate::installed *)
HelperSucceeds ==
  /\ install = "Installing"
  /\ install' = "Installed"
  /\ UNCHANGED <<cancelled, accepted, session, dictating, installs>>

(* Gate::start: a speech `start`, refused at the prompt and after. *)
SessionStarts ==
  /\ install \in {"Idle", "Fetching"}
  /\ session' = "fresh"
  /\ UNCHANGED <<install, cancelled, accepted, dictating, installs>>

(* The renderer reports dictation soon after its session started.  The model
   assumes what FRESH_SESSION is for: the report lags the start by less than
   that, or never comes, the renderer having abandoned the session.  A report
   later than that would find the gate already closed; the restart after an
   install waits for dictation to end for that reason. *)
RendererReports ==
  /\ session = "fresh" /\ ~dictating
  /\ dictating' = TRUE
  /\ UNCHANGED <<install, cancelled, accepted, session, installs>>

(* FRESH_SESSION passes. *)
SessionAges ==
  /\ session = "fresh"
  /\ session' = "stale"
  /\ UNCHANGED <<install, cancelled, accepted, dictating, installs>>

(* Gate::end: the session finished, was cancelled, or failed to start. *)
SessionEnds ==
  /\ session # "none"
  /\ session' = "none"
  /\ dictating' = FALSE
  /\ UNCHANGED <<install, cancelled, accepted, installs>>

Next ==
  \/ Begin \/ Cancel \/ Abandon \/ Close \/ HelperFails \/ HelperSucceeds
  \/ SessionStarts \/ RendererReports \/ SessionAges \/ SessionEnds

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
TypeOK ==
  /\ install \in {"Idle", "Fetching", "Installing", "Installed"}
  /\ session \in {"none", "fresh", "stale"}
  /\ dictating => session # "none"

(* An install whose Cancel was accepted never reaches the password prompt. *)
AnAcceptedCancelStopsTheInstall ==
  accepted => install \in {"Idle", "Fetching"}

(* The prompt opens only when no session may be running, and from then on
   none starts: a session at the prompt or after it is one the renderer
   abandoned, already stale when the gate closed. *)
NoRecognitionWhileInstalling ==
  install \in {"Installing", "Installed"} => session # "fresh" /\ ~dictating

GateClosesOnlyWhenQuiet ==
  [][install = "Fetching" /\ install' = "Installing" =>
       ~cancelled /\ ~dictating /\ session # "fresh"]_vars

(* Nothing follows an install that succeeded: no other install, and the gate
   never reopens for this process. *)
InstalledIsFinal == [][install = "Installed" => install' = "Installed"]_vars

(* The stages follow each other in one order. *)
StagesInOrder ==
  [][/\ install' = "Installing" => install \in {"Fetching", "Installing"}
     /\ install' = "Installed" => install \in {"Installing", "Installed"}
     /\ install' = "Fetching" => install \in {"Idle", "Fetching"}]_vars
=============================================================================
