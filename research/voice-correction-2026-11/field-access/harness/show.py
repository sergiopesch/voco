#!/usr/bin/python3.12
"""Print the facts of result files compactly: show.py results/a.json ..."""
import json
import sys

for path in sys.argv[1:]:
    d = json.load(open(path))
    print(f"== {d.get('case')} / {d.get('scenario')} / {d.get('config')}")
    for k in ("harness_error",):
        if d.get(k):
            print("  ", k, d[k], d.get("traceback", "")[-600:])
    la = d.get("launch", {})
    if la.get("error"):
        print("   launch error:", la["error"], "| active:", la.get("active_window_seen"))
    env = d.get("environment", {})
    print("   status start/after-launch:", env.get("a11y_status_at_start"), env.get("a11y_status_after_launch"))
    if "desktop_apps" in d:
        print("   apps:", [(a["name"], a["toolkit"], a["toolkit_version"]) for a in d["desktop_apps"]])
    if "lookup" in d:
        lo = d["lookup"]
        print(f"   lookup found={lo['found']} cold={lo['cold']['median_ms']}ms warm={lo['warm']['median_ms']}ms nodes={lo['cold']['runs'][-1].get('nodes')}")
    f = d.get("focused")
    if f:
        print(f"   focused: role={f['role']} name={f['name']!r} toolkit={f['toolkit']} {f['toolkit_version']}")
        print(f"            ifaces={f['interfaces']}")
        print(f"            states={f['states']}")
        print(f"            ancestry={f['ancestry']}")
    fe = d.get("focus_events")
    if fe:
        print(f"   focus events: n={fe['count']} last_is_walk={fe['last_event_source_is_walk_result']} any={fe['any_event_source_is_walk_result']}")
    r = d.get("read")
    if r:
        t = r.get("text")
        print(f"   read: text={t if t is None or len(t) < 200 else t[:80] + '...(' + str(len(t)) + ')'!r} caret={r.get('caret')} err={r.get('error')} ms={r.get('read_ms')}")
        print("   verify:", d.get("verify_before_caret"))
    if "hazard_atspi" in d:
        print("   hazard_atspi:", d["hazard_atspi"])
    rp = d.get("replace")
    if rp:
        if "attempts" in rp:
            for a in rp["attempts"]:
                print("   attempt:", {k: v for k, v in a.items()})
            print(f"   replace worked={rp['worked_method']} ms={rp['ms']} indep_final={rp.get('independent_is_final')}")
        else:
            print("   replace:", rp)
    if "caret" in d:
        print("   caret:", d["caret"])
    if "blind" in d:
        print("   blind:", d["blind"])
    if "independent_after" in d:
        print("   independent:", d["independent_after"])
    if d.get("app_log_tail", "").strip():
        print("   app log tail:", d["app_log_tail"].strip()[-400:].replace("\n", " | "))
