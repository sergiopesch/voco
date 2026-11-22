#!/usr/bin/python3.12
"""results/*.json -> results/summary.md.  Counts only what the files hold;
notes.md (hand-written after reading the results) is appended as it is."""
import collections
import glob
import json
import os
import statistics
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ladder  # noqa: E402  (the harness: its classify() is the one rule)
BRIEF = ["plain", "home", "typed-after", "cleared", "other-field", "prefilled", "text-after"]
EXTRA = "other-unreadable"

# The rows of the main table: (case, config, note on the config).
BASE = ["gnome-text-editor", "gtk4-textview", "gtk4-entry", "gedit", "gtk3-textview", "gtk3-entry"]
ROWS = [(c, "plain", "") for c in BASE]
ROWS += [("featherpad", "plain", "native Wayland client"),
         ("featherpad", "xwayland-root-property", "through XWayland, AT_SPI_BUS set on the X root window"),
         ("libreoffice-writer", "plain", ""), ("gnome-terminal", "plain", "")]
for f in ("textarea", "input", "contenteditable"):
    ROWS.append((f"chromium-{f}", "status-force-renderer", "IsEnabled=true + --force-renderer-accessibility"))
for f in ("textarea", "input", "contenteditable"):
    ROWS.append((f"epiphany-{f}", "plain", ""))
for f in ("textarea", "input", "contenteditable"):
    ROWS.append((f"electron-{f}", "status-a11y-api", "IsEnabled=true + app.setAccessibilitySupportEnabled(true)"))
for f in ("textarea", "input", "contenteditable"):
    ROWS.append((f"electron-{f}", "status-force-renderer", "IsEnabled=true + --force-renderer-accessibility, no API call"))
MAIN = {(c, cfg) for c, cfg, _ in ROWS}
GUARD = {(c, cfg + "+guard") for c, cfg, _ in ROWS}


def load():
    runs = []
    for path in sorted(glob.glob(os.path.join(HERE, "results", "*.json"))):
        with open(path, encoding="utf-8") as f:
            r = json.load(f)
        r["_file"] = os.path.basename(path)
        if "ladder" in r and "independent_after" in r:
            # Classified again from the raw reads, with the harness's current rule.
            r["classification"] = ladder.classify(r["scenario"], r["ladder"], r["independent_after"],
                                                  r.get("independent_other_field"))
        runs.append(r)
    return runs


def ok(r):
    return "ladder" in r and "classification" in r


def problem(r):
    return (r.get("harness_error") or (r.get("launch") or {}).get("error")
            or (r.get("window_error") or {}).get("error") or r.get("setup_error")
            or r.get("independent_error") or ("no ladder result" if not ok(r) else None))


def short_reason(reason):
    reason = reason or ""
    if reason.startswith("unreadable"):
        return "unreadable"
    if reason.startswith("moved or changed"):
        return "moved or changed"
    if reason.startswith("text follows"):
        return "text after caret"
    if reason.startswith("the selection failed"):
        return "selection failed, text after caret"
    if reason.startswith("not the active window"):
        return "window not ACTIVE"
    if reason.startswith("the selection attempt"):
        return "selection moved the caret"
    return reason[:40]


def cell_key(r):
    l, c = r["ladder"], r["classification"]
    if l["outcome"] == "CHANGED-VERIFIED":
        lad = f"changed (rung {l['rung']})"
    elif l["outcome"] == "REFUSED":
        lad = f"refused ({short_reason(l['reason'])})"
    else:
        lad = f"FAILED-DETECTED (rung {l['rung']})"
    cls = c["class"]
    if c.get("setup_differs_from_intended"):
        cls += " [setup differed]"
    return f"{lad} → {cls}"


def cell(group):
    if not group:
        return "not run"
    good = [r for r in group if ok(r)]
    parts = []
    counts = collections.Counter(cell_key(r) for r in good)
    for key, n in counts.most_common():
        parts.append(f"{key} {n}/{len(group)}")
    bad = len(group) - len(good)
    if bad:
        parts.append(f"no result {bad}/{len(group)}")
    return "; ".join(parts)


def qt_exposed(r):
    """other-unreadable only: the other window (FeatherPad, native Wayland) was
    on the AT-SPI desktop as a Qt app with a window in this run."""
    if r.get("case") == "featherpad":
        return False
    return any(a.get("toolkit") == "Qt" and a.get("windows") for a in (r.get("desktop_apps") or []))


def md_escape(text):
    return str(text).replace("|", "\\|").replace("\n", "⏎")


def main():
    runs = load()
    by = collections.defaultdict(list)
    for r in runs:
        by[(r.get("case"), r.get("config"), r.get("scenario"))].append(r)
    out = []
    w = out.append
    any_run = next((r for r in runs if "session" in r), {})
    env = any_run.get("environment", {})
    w("# Field ladder on GNOME Wayland: results\n")
    w(f"- Session: {any_run.get('session', {}).get('type', '?')}; {any_run.get('session', {}).get('shell', '?')}, "
      "headless with one 1280x800 virtual monitor, its own D-Bus session, a throwaway HOME and a short XDG_RUNTIME_DIR; one fresh session per run.")
    w("- Keys and clicks: Mutter's RemoteDesktop D-Bus API (NotifyKeyboardKeycode, NotifyPointerMotionRelative, NotifyPointerButton), as VOCO's CI sends them.")
    w("- Copy: xclip through XWayland, PRIMARY then CLIPBOARD, then Shift+Insert (VOCO's order on GNOME Wayland). wl-copy was not used.")
    w("- AT-SPI client: libatspi through python3-gi on Python 3.12; it connects and registers its focus listener before the app starts.")
    w(f"- In the fresh session: `toolkit-accessibility` = `{env.get('gsettings_toolkit_accessibility')}`, "
      f"org.a11y.Bus running once the Shell is up: {env.get('a11y_bus_running_after_shell_start')}, "
      f"org.a11y.Status then: `{env.get('a11y_status_after_shell_start')}`. Only configs named `status`/`screen-reader` change it.")
    w("- Text: `Let's meet at the` + ` peer on Thursday` + ` afternoon.` pasted as three chunks; the ladder is asked to make `peer` into `pier`.")
    w(f"- Result files: {len(runs)}.\n")

    main_runs = [r for r in runs if (r.get("case"), r.get("config")) in MAIN and r.get("scenario") in BRIEF]
    extra_runs = [r for r in runs if (r.get("case"), r.get("config")) in MAIN and r.get("scenario") == EXTRA]
    guard_runs = [r for r in runs if (r.get("case"), r.get("config")) in GUARD]

    def headline(title, group):
        w(f"### {title}\n")
        good = [r for r in group if ok(r)]
        n = len(group)
        w(f"- Runs: {n}; with a ladder result and an independent read: {len(good)}; without: {n - len(good)}.")
        cv = [r for r in good if r["ladder"]["outcome"] == "CHANGED-VERIFIED"]
        cv_ok = [r for r in cv if r["classification"]["class"] == "correct"]
        w(f"- Ladder said CHANGED-VERIFIED: {len(cv)}; the independent read agrees (correct text): **{len(cv_ok)}/{len(cv)}**"
          + (f"; caret at the end of the corrected text by the independent read: {sum(1 for r in cv_ok if r['classification'].get('caret_at_end_of_corrected'))}/{len(cv_ok)}" if cv_ok else "") + ".")
        by_rung = collections.Counter(r["ladder"]["rung"] for r in cv_ok)
        if by_rung:
            w("  - by rung: " + ", ".join(f"rung {k}: {v}" for k, v in sorted(by_rung.items())))
        ref = [r for r in good if r["ladder"]["outcome"] == "REFUSED"]
        ref_ok = [r for r in ref if r["classification"]["class"] == "untouched"]
        w(f"- Ladder REFUSED: {len(ref)}; the independent read shows the field untouched: {len(ref_ok)}/{len(ref)}.")
        reasons = collections.Counter(short_reason(r["ladder"]["reason"]) for r in ref)
        if reasons:
            w("  - reasons: " + ", ".join(f"{k}: {v}" for k, v in reasons.most_common()))
        fd = [r for r in good if r["ladder"]["outcome"] == "FAILED-DETECTED"]
        w(f"- Ladder FAILED-DETECTED: {len(fd)}"
          + ("; independent class: " + ", ".join(f"{k}: {v}" for k, v in collections.Counter(r['classification']['class'] for r in fd).items()) if fd else "") + ".")
        dmg = [r for r in good if r["classification"]["class"] == "DAMAGED"]
        dmg_cv = [r for r in dmg if r["ladder"]["outcome"] == "CHANGED-VERIFIED"]
        w(f"- **DAMAGED runs: {len(dmg)}/{len(good)}**; DAMAGED and reported CHANGED-VERIFIED: **{len(dmg_cv)}**.")
        for r in dmg:
            c = r["classification"]
            w(f"  - `{r['_file']}`: ladder {r['ladder']['outcome']} (rung {r['ladder']['rung']}); field now `{md_escape(c.get('independent_full'))}`"
              + (f"; other field now `{md_escape(c.get('other_field_full'))}`" if "other_field_full" in c else ""))
        unv = [r for r in good if r["classification"]["class"] == "UNVERIFIED"]
        w(f"- UNVERIFIED (the independent read gave nothing): {len(unv)}" + (": " + ", ".join(f"`{r['_file']}`" for r in unv) if unv else "") + ".")
        sd = [r for r in good if r["classification"].get("setup_differs_from_intended")]
        w(f"- Runs whose setup left other text than intended (the ladder refused, the field kept what it had): {len(sd)}"
          + (": " + ", ".join(f"`{r['_file']}`" for r in sd) if sd else "") + ".")
        dis = [r for r in good if not r["classification"].get("ladder_agrees")]
        w(f"- Runs where the ladder's outcome and the independent class disagree: {len(dis)}"
          + (": " + ", ".join(f"`{r['_file']}` ({cell_key(r)})" for r in dis) if dis else "") + ".")
        bad = [r for r in group if not ok(r)]
        for r in bad:
            w(f"  - no result: `{r['_file']}`: {md_escape(str(problem(r))[:160])}")
        w("")

    w("## Headline counts\n")
    headline("The brief's seven scenarios, each field under the config its row names", main_runs)
    headline("Extra hazard `other-unreadable` (not in the brief): focus moved to a window AT-SPI does not expose", extra_runs)

    headline("Variant with a guard (not the ladder as specified): refuse unless the field's window is ACTIVE; scenarios plain, other-field, other-unreadable", guard_runs)

    w("## Field × scenario\n")
    w("Cell: the ladder's outcome → the independent read's class, runs/attempts. `changed (rung 2)` = EditableText; "
      "`rung 3` = AT-SPI selection + paste; `rung 4` = BackSpace + paste. \"correct\" = the field holds the corrected text; "
      "\"untouched\" = it holds what the setup left.\n")
    w("| Field (client) | Config | " + " | ".join(BRIEF) + " |")
    w("|---|---|" + "---|" * len(BRIEF))
    labels = {}
    for case, cfg, note in ROWS:
        rs = [r for s in BRIEF for r in by.get((case, cfg, s), [])]
        clients = sorted({r.get("client_type") for r in rs if r.get("client_type")})
        label = next((r.get("label") for r in rs if r.get("label")), case)
        labels[(case, cfg)] = label
        w(f"| {label} ({'/'.join(clients) or '?'}) | `{cfg}`{' — ' + note if note else ''} | "
          + " | ".join(md_escape(cell(by.get((case, cfg, s), []))) for s in BRIEF) + " |")
    w("")

    w("## Extra hazard: focus moved to a window AT-SPI does not expose\n")
    w("Not in the brief's list. After the pastes a FeatherPad window (native Wayland client, which exposed nothing here) takes "
      "keyboard focus; its text area is empty. \"Old field still FOCUSED\" = the ladder's step 0 accepted the field the text was "
      "pasted into; \"its window ACTIVE\" is recorded, and the ladder as specified does not look at it.\n")
    w("| Field | Config | Ladder → independent class | Step 0 found | Old field's window ACTIVE | Other window's text after | Runs where the other window was exposed after all |")
    w("|---|---|---|---|---|---|---|")
    for case, cfg, _note in ROWS:
        g = by.get((case, cfg, EXTRA), [])
        if not g:
            continue
        good = [r for r in g if ok(r)]
        found = collections.Counter((r["ladder"].get("find") or {}).get("found_by") or "nothing" for r in good)
        active = collections.Counter(str((r["ladder"].get("target_window") or {}).get("active", "-")) for r in good)
        other = collections.Counter(repr(r["classification"].get("other_field_full")) for r in good)
        w(f"| {labels.get((case, cfg), case)} | `{cfg}` | {md_escape(cell(g))} | "
          + ", ".join(f"{k} {v}" for k, v in found.items()) + " | "
          + ", ".join(f"{k} {v}" for k, v in active.items()) + " | "
          + md_escape(", ".join(f"{k} ×{v}" for k, v in other.items())) + " | "
          + f"{sum(1 for r in good if qt_exposed(r))}/{len(good)} |")
    w("")
    w("In the runs of the last column FeatherPad did appear on the AT-SPI desktop as a Qt app (see the notes), so step 0 found "
      "its empty text area and the ladder refused as in `other-field`.\n")

    w("## Variant with a guard: refuse unless the field's top-level window is ACTIVE\n")
    w("Not the ladder as specified. After step 0 the variant climbs from the field to its top-level accessible and refuses "
      "when that has no STATE_ACTIVE. Everything else is the same code.\n")
    w("| Field | Config | plain | other-field | other-unreadable |")
    w("|---|---|---|---|---|")
    for case, cfg, _note in ROWS:
        gcfg = cfg + "+guard"
        if not any(by.get((case, gcfg, s)) for s in ("plain", "other-field", EXTRA)):
            continue
        w(f"| {labels.get((case, cfg), case)} | `{gcfg}` | "
          + " | ".join(md_escape(cell(by.get((case, gcfg, s), []))) for s in ("plain", "other-field", EXTRA))
          + f" (other window exposed after all in {sum(1 for r in by.get((case, gcfg, EXTRA), []) if ok(r) and qt_exposed(r))}) |")
    w("")

    w("## What each field looked like to the ladder (the brief's scenarios)\n")
    w("| Field | Config | Client | AT-SPI object (app, toolkit) | Step 0 found by | Own window ACTIVE (scenarios without a second window) | U+00A0 in the text read | Ladder time, changed runs (median ms) |")
    w("|---|---|---|---|---|---|---|---|")
    for case, cfg, _note in ROWS:
        rs = [r for s in BRIEF for r in by.get((case, cfg, s), []) if ok(r)]
        if not rs:
            continue
        objs = collections.Counter(
            f"{(r['ladder'].get('object') or {}).get('role')} ({(r['ladder'].get('object') or {}).get('app')}, {(r['ladder'].get('object') or {}).get('toolkit')} {(r['ladder'].get('object') or {}).get('toolkit_version') or ''})"
            for r in rs if r["scenario"] != "other-field" and r["ladder"].get("object"))
        found = collections.Counter((r["ladder"].get("find") or {}).get("found_by") or "nothing" for r in rs)
        active = collections.Counter(str((r["ladder"].get("target_window") or {}).get("active", "-"))
                                     for r in rs if r["scenario"] != "other-field" and r["ladder"].get("object"))
        nbsp = collections.Counter(r["ladder"].get("nbsp_in_text", 0) for r in rs if r["scenario"] in ("plain", "prefilled", "text-after") and "nbsp_in_text" in r["ladder"])
        ms = [r["ladder"]["ms"] for r in rs if r["ladder"]["outcome"] == "CHANGED-VERIFIED" and "ms" in r["ladder"]]
        clients = sorted({r.get("client_type") for r in rs if r.get("client_type")})
        w(f"| {labels.get((case, cfg), case)} | `{cfg}` | {'/'.join(clients)} | "
          + md_escape("; ".join(f"{k} ×{v}" for k, v in objs.most_common(2)) or "none") + " | "
          + ", ".join(f"{k} {v}" for k, v in found.most_common()) + " | "
          + (", ".join(f"{k} {v}" for k, v in active.items()) or "-") + " | "
          + (", ".join(f"{k}: {v} runs" for k, v in sorted(nbsp.items())) or "-") + " | "
          + (f"{statistics.median(ms):.0f} (n={len(ms)})" if ms else "-") + " |")
    w("")

    w("## What each app needed in order to be exposed\n")
    w("The `plain` scenario under each launch config tried. \"Exposed\" = the ladder's step 0 found a focused editable or terminal "
      "object with Text. Rows marked main are the configs of the table above (all their `plain` runs).\n")
    w("| Field | Config | What the config adds | Client | Apps on the AT-SPI desktop besides the Shell | Exposed | Ladder → independent class |")
    w("|---|---|---|---|---|---|---|")
    seen = set()
    order = sorted({(r.get("case"), r.get("config")) for r in runs
                    if r.get("scenario") == "plain" and not str(r.get("config")).endswith("+guard")},
                   key=lambda k: (k[0], k not in MAIN, k[1]))
    for case, cfg in order:
        g = by.get((case, cfg, "plain"), [])
        if (case, cfg) in seen or not g:
            continue
        seen.add((case, cfg))
        good = [r for r in g if ok(r)]
        detail = g[0].get("config_detail") or {}
        adds = []
        if detail.get("status"):
            adds.append("org.a11y.Status IsEnabled=true before launch")
        if detail.get("screen_reader"):
            adds.append("ScreenReaderEnabled=true before launch")
        if detail.get("args"):
            adds.append(" ".join(detail["args"]))
        for k, v in (detail.get("env") or {}).items():
            adds.append("app.setAccessibilitySupportEnabled(true)" if k == "FIELD_LADDER_ELECTRON_A11Y" else f"{k}={v!r}" if v == "" else f"{k}={v}")
        if detail.get("xwayland"):
            adds.append("run through XWayland")
        if detail.get("address_env"):
            adds.append("AT_SPI_BUS_ADDRESS in the app's environment")
        if detail.get("root_property"):
            adds.append("AT_SPI_BUS property set on the X root window")
        apps = collections.Counter(
            ", ".join(sorted(f"{a.get('name')} [{a.get('toolkit')}, {a.get('windows')} window(s)]" for a in (r.get("desktop_apps") or []) if a.get("name") != "gnome-shell")) or "none"
            for r in good)
        exposed = sum(1 for r in good if (r["ladder"].get("find") or {}).get("found_by"))
        clients = sorted({r.get("client_type") for r in g if r.get("client_type")})
        w(f"| {case} | `{cfg}`{' (main)' if (case, cfg) in MAIN else ''} | {md_escape('; '.join(adds) or 'nothing')} | {'/'.join(clients)} | "
          + md_escape("; ".join(f"{k} ×{v}" for k, v in apps.items())) + f" | {exposed}/{len(g)} | {md_escape(cell(g))} |")
    w("")

    notes = os.path.join(HERE, "notes.md")
    if os.path.exists(notes):
        w(open(notes, encoding="utf-8").read().rstrip() + "\n")

    versions = os.path.join(HERE, "results", "versions.txt")
    if os.path.exists(versions):
        w("## Versions\n")
        w("```")
        w(open(versions, encoding="utf-8").read().rstrip())
        w("```")
    with open(os.path.join(HERE, "results", "summary.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    print(os.path.join(HERE, "results", "summary.md"))


if __name__ == "__main__":
    main()
