#!/usr/bin/python3.12
"""results/*.json -> results/summary.md and results/summary.json.  Counts
only what the files hold; every run is classified again from its raw reads."""
import collections
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import ladder  # noqa: E402  (the harness: its classify() is the one rule)

CLASSES = ["correct", "untouched", "damaged", "unverified"]
NOTES = {
    "featherpad": "through XWayland, AT_SPI_BUS set on the X root window",
    "chromium": "IsEnabled=true + --force-renderer-accessibility",
    "electron": "IsEnabled=true + app.setAccessibilitySupportEnabled(true)",
}


def load():
    runs = []
    for path in sorted(glob.glob(os.path.join(HERE, "results", "*.json"))):
        if os.path.basename(path) == "summary.json":
            continue
        with open(path, encoding="utf-8") as f:
            r = json.load(f)
        r["_file"] = os.path.basename(path)
        if ok(r):
            r["classification"] = ladder.classify(r)
        runs.append(r)
    return runs


def ok(r):
    return "ladder" in r and "independent_after" in r


def problem(r):
    return (r.get("harness_error") or (r.get("launch") or {}).get("error")
            or (r.get("window_error") or {}).get("error") or r.get("setup_error")
            or r.get("independent_error") or ("no ladder result" if not ok(r) else None))


def short_reason(reason):
    reason = reason or ""
    for start, short in (("unreadable", "unreadable"), ("moved or changed", "moved or changed"),
                         ("text follows", "text after caret"), ("not the active window", "window not ACTIVE"),
                         ("selection:", "text selected"), ("offsets unsure", "offsets unsure"),
                         ("the selection or caret", "selection did not read back"),
                         ("BackSpace count", "BackSpace count unsure"), ("nothing to", "nothing to do")):
        if reason.startswith(start):
            return short
    return reason[:40]


def report(r):
    """What the ladder said, as one short label."""
    lad = r["ladder"]
    if lad["outcome"] == "CHANGED-VERIFIED":
        return f"changed (rung {lad['rung']})"
    if lad["outcome"] == "REFUSED":
        return f"refused ({short_reason(lad['reason'])})"
    return f"FAILED-DETECTED (rung {lad['rung']})"


def cell(group):
    if not group:
        return "not run"
    if all(r.get("not_applicable") for r in group):
        return "not applicable"
    good = [r for r in group if ok(r)]
    counts = collections.Counter(f"{report(r)} → {r['classification']['class']}" for r in good)
    parts = [f"{key} {n}/{len(group)}" for key, n in counts.most_common()]
    if len(group) - len(good):
        parts.append(f"no result {len(group) - len(good)}/{len(group)}")
    return "; ".join(parts)


def tally(group):
    """The counts of one cell, or of one case's trial runs."""
    good = [r for r in group if ok(r)]
    out = dict(runs=len(group), not_applicable=sum(1 for r in group if r.get("not_applicable")),
               no_result=sum(1 for r in group if not ok(r) and not r.get("not_applicable")))
    for name in CLASSES:
        out[name] = sum(1 for r in good if r["classification"]["class"] == name)
    out["outcomes"] = dict(collections.Counter(r["ladder"]["outcome"] for r in good))
    out["rungs"] = dict(collections.Counter(str(r["ladder"]["rung"]) for r in good if r["ladder"]["rung"]))
    out["refusal_reasons"] = dict(collections.Counter(
        short_reason(r["ladder"]["reason"]) for r in good if r["ladder"]["outcome"] == "REFUSED"))
    out["honesty_violations"] = sum(1 for r in good if not r["classification"]["honest"])
    out["damaged_where_the_ladder_sent_nothing"] = sum(
        1 for r in good if r["classification"]["class"] == "damaged" and r["classification"]["ladder_sent_nothing"])
    wanted = [r for r in good if "as_wanted" in r["classification"]]
    out["runs_with_a_wanted_end"] = len(wanted)
    out["ended_as_wanted"] = sum(1 for r in wanted if r["classification"]["as_wanted"])
    return out


def md_escape(text):
    return str(text).replace("|", "\\|").replace("\n", "⏎")


def main():
    runs = load()
    variants = [r for r in runs if r.get("variant")]
    trials = [r for r in runs if r.get("trial") and not r.get("variant")]
    matrix = [r for r in runs if not r.get("trial") and not r.get("variant")]
    by = collections.defaultdict(list)
    for r in matrix:
        by[(r.get("case"), r.get("config"), r.get("scenario"))].append(r)
    rows = list(dict.fromkeys((r.get("case"), r.get("config")) for r in matrix))
    rows.sort(key=lambda key: list(ladder.CASES).index(key[0]) if key[0] in ladder.CASES else 999)
    labels = {key: next((r["label"] for r in matrix if (r.get("case"), r.get("config")) == key and r.get("label")), key[0])
              for key in rows}
    summary = dict(result_files=len(runs), cells=[], trials=[])
    out = []
    w = out.append
    any_run = next((r for r in runs if "session" in r), {})
    env = any_run.get("environment", {})
    w("# Field ladder v2 on GNOME Wayland: results\n")
    w(f"- Session: {any_run.get('session', {}).get('type', '?')}; {any_run.get('session', {}).get('shell', '?')}, "
      "headless with one 1280x800 virtual monitor, its own D-Bus session, a throwaway HOME and a short XDG_RUNTIME_DIR; one fresh session per run.")
    w("- Keys and clicks: Mutter's RemoteDesktop D-Bus API (NotifyKeyboardKeycode, NotifyPointerMotionRelative, NotifyPointerButton), as VOCO's CI sends them.")
    w("- Copy: xclip through XWayland, PRIMARY then CLIPBOARD, then Shift+Insert (VOCO's order on GNOME Wayland).")
    w("- AT-SPI client: libatspi through python3-gi on Python 3.12; it connects and registers its focus listener before the app starts.")
    w(f"- In the fresh session: `toolkit-accessibility` = `{env.get('gsettings_toolkit_accessibility')}`, "
      f"org.a11y.Bus running once the Shell is up: {env.get('a11y_bus_running_after_shell_start')}, "
      f"org.a11y.Status then: `{env.get('a11y_status_after_shell_start')}`.")
    w("- Classes, from the read that doesn't use the accessibility interface: **correct** = the field holds the changed text; "
      "**untouched** = it holds everything pasted and nothing changed; **damaged** = anything else; unverified = that read gave nothing.")
    w(f"- Result files: {len(runs)} ({len(matrix)} of the matrix, {len(trials)} trial runs, {len(variants)} with `--before`).\n")

    def headline(title, group):
        w(f"### {title}\n")
        good = [r for r in group if ok(r)]
        na = sum(1 for r in group if r.get("not_applicable"))
        w(f"- Runs: {len(group)}; not applicable: {na}; with a ladder report and an independent read: {len(good)}; without: {len(group) - len(good) - na}.")
        for outcome in ("CHANGED-VERIFIED", "REFUSED", "FAILED-DETECTED"):
            sub = [r for r in good if r["ladder"]["outcome"] == outcome]
            classes = collections.Counter(r["classification"]["class"] for r in sub)
            w(f"- Ladder said {outcome}: {len(sub)}"
              + ("; independent class: " + ", ".join(f"{k}: {classes[k]}" for k in CLASSES if classes[k]) if sub else "") + ".")
            if outcome == "CHANGED-VERIFIED" and sub:
                rungs = collections.Counter(r["ladder"]["rung"] for r in sub)
                w("  - by rung: " + ", ".join(f"rung {k}: {v}" for k, v in sorted(rungs.items())))
                at_end = sum(1 for r in sub if r["classification"].get("caret_at_end_of_corrected"))
                w(f"  - caret at the end of the changed text by the independent read: {at_end}/{classes['correct']} of the correct ones")
            if outcome == "REFUSED" and sub:
                reasons = collections.Counter(short_reason(r["ladder"]["reason"]) for r in sub)
                w("  - reasons: " + ", ".join(f"{k}: {v}" for k, v in reasons.most_common()))
        dmg = [r for r in good if r["classification"]["class"] == "damaged"]
        w(f"- **Damaged: {len(dmg)}/{len(good)}**; of them, where the ladder sent nothing: "
          f"{sum(1 for r in dmg if r['classification']['ladder_sent_nothing'])}.")
        for r in dmg:
            c = r["classification"]
            w(f"  - `{r['_file']}`: ladder {report(r)}; field now `{md_escape(c.get('independent_full'))}`"
              + (f"; other field now `{md_escape(c.get('other_field_full'))}`" if "other_field_full" in c else ""))
        liars = [r for r in good if not r["classification"]["honest"]]
        w(f"- **Honesty violations (changed and verified on an untouched or damaged field): {len(liars)}**"
          + (": " + ", ".join(f"`{r['_file']}`" for r in liars) if liars else "") + ".")
        unv = [r for r in good if r["classification"]["class"] == "unverified"]
        w(f"- Unverified: {len(unv)}" + (": " + ", ".join(f"`{r['_file']}`" for r in unv) if unv else "") + ".")
        wanted = [r for r in good if "as_wanted" in r["classification"]]
        w(f"- Runs with a stated right end (a refusal scenario, or a trial): {len(wanted)}; ended there: "
          f"{sum(1 for r in wanted if r['classification']['as_wanted'])}.")
        for r in group:
            if not ok(r) and not r.get("not_applicable"):
                w(f"  - no result: `{r['_file']}`: {md_escape(str(problem(r))[:160])}")
        w("")

    w("## Headline counts\n")
    headline("The matrix: every field × every scenario", matrix)
    if trials:
        headline("Trial runs", trials)

    w("## Field × scenario\n")
    w("Cell: the ladder's report → the independent read's class, runs/attempts. `changed (rung 2)` = EditableText; "
      "`rung 3` = selection or caret through the interface, then paste; `rung 4` = BackSpace, then paste.\n")
    w("| Field (client) | Config | " + " | ".join(ladder.SCENARIOS) + " |")
    w("|---|---|" + "---|" * len(ladder.SCENARIOS))
    disagree = []
    for case, cfg in rows:
        rs = [r for s in ladder.SCENARIOS for r in by.get((case, cfg, s), [])]
        clients = sorted({r.get("client_type") for r in rs if r.get("client_type")})
        note = NOTES.get(case.split("-")[0])
        w(f"| {labels[(case, cfg)]} ({'/'.join(clients) or '?'}) | `{cfg}`{' — ' + note if note else ''} | "
          + " | ".join(md_escape(cell(by.get((case, cfg, s), []))) for s in ladder.SCENARIOS) + " |")
        for s in ladder.SCENARIOS:
            group = by.get((case, cfg, s), [])
            if not group:
                continue
            kinds = {(report(r), r["classification"]["class"]) if ok(r) else ("no result", r.get("not_applicable"))
                     for r in group}
            entry = dict(case=case, config=cfg, scenario=s, **tally(group), all_reps_agree=len(kinds) == 1)
            summary["cells"].append(entry)
            if not entry["all_reps_agree"]:
                disagree.append(f"{case} × {s}")
    w("")
    w(f"Cells whose repeats did not all end alike: {len(disagree)}" + (": " + ", ".join(disagree) if disagree else "") + ".\n")

    w("## What each field looked like to the ladder\n")
    w("The unit is the one whose offsets read the pasted text back; it is shown for the runs where units give "
      "different offsets (a character outside ASCII before the pasted text's end), and `any` where they never did.\n")
    w("| Field | Config | Client | AT-SPI object (app, toolkit) | Step 0 found by | Offset unit where units differ | U+00A0 in the text read |")
    w("|---|---|---|---|---|---|---|")
    for case, cfg in rows:
        rs = [r for s in ladder.SCENARIOS for r in by.get((case, cfg, s), []) if ok(r)]
        if not rs:
            continue
        own = [r for r in rs if r["scenario"] not in ladder.OTHER_SCENARIOS and r["ladder"].get("object")]
        objs = collections.Counter(
            "{role} ({app}, {toolkit} {toolkit_version})".format(**{k: (r["ladder"]["object"].get(k) or "") for k in
                                                                    ("role", "app", "toolkit", "toolkit_version")})
            for r in own)
        found = collections.Counter((r["ladder"].get("find") or {}).get("found_by") or "nothing" for r in rs)
        units = collections.Counter(
            " = ".join(r["ladder"]["offsets"]["units_agreeing"]) for r in own
            if (r["ladder"].get("offsets") or {}).get("units_differ_here"))
        nbsp = collections.Counter(r["ladder"]["nbsp_in_text"] for r in own if "nbsp_in_text" in r["ladder"])
        clients = sorted({r.get("client_type") for r in rs if r.get("client_type")})
        w(f"| {labels[(case, cfg)]} | `{cfg}` | {'/'.join(clients)} | "
          + md_escape("; ".join(f"{k} ×{v}" for k, v in objs.most_common(2)) or "none") + " | "
          + ", ".join(f"{k} {v}" for k, v in found.most_common()) + " | "
          + (", ".join(f"{k}: {v} runs" for k, v in units.most_common()) or "any") + " | "
          + (", ".join(f"{k}: {v} runs" for k, v in sorted(nbsp.items())) or "-") + " |")
    w("")

    if trials:
        w("## Trials\n")
        w("Each trial file once per field, in scenario `plain`: its parts pasted, the ladder, its `rest` pasted, the "
          "independent read. Counts of runs by the ladder's report and the independent read's class.\n")
        w("| Field | Config | Runs | Ladder report | correct | untouched | damaged | unverified |")
        w("|---|---|---|---|---|---|---|---|")
        tby = collections.defaultdict(list)
        for r in trials:
            tby[(r.get("case"), r.get("config"))].append(r)
        for (case, cfg), group in sorted(tby.items(), key=lambda kv: list(ladder.CASES).index(kv[0][0]) if kv[0][0] in ladder.CASES else 999):
            entry = dict(case=case, config=cfg, **tally(group), by_report=[],
                         trial_files=sorted({(r["trial"]["id"], r["trial"]["sha256"]) for r in group}))
            reports = collections.defaultdict(list)
            for r in group:
                if ok(r):
                    reports[(r["ladder"]["outcome"], r["ladder"]["rung"])].append(r)
            for (outcome, rung), sub in sorted(reports.items(), key=lambda kv: (kv[0][0], str(kv[0][1]))):
                counts = {name: sum(1 for r in sub if r["classification"]["class"] == name) for name in CLASSES}
                entry["by_report"].append(dict(outcome=outcome, rung=rung, runs=len(sub), **counts))
                w(f"| {case} | `{cfg}` | {len(group)} | {outcome}{f' (rung {rung})' if rung else ''}: {len(sub)} | "
                  + " | ".join(str(counts[name]) for name in CLASSES) + " |")
            if entry["no_result"] or entry["not_applicable"]:
                w(f"| {case} | `{cfg}` | {len(group)} | no result: {entry['no_result']}, not applicable: {entry['not_applicable']} | | | | |")
            summary["trials"].append(entry)
        w("")
        bad = [r for r in trials if ok(r) and r["classification"]["class"] != r["classification"].get("wanted")]
        w(f"Trial runs that did not end as wanted: {len(bad)}.\n")
        for r in bad:
            c = r["classification"]
            w(f"- `{r['_file']}`: ladder {report(r)}, {c['class']}; field now `{md_escape(c.get('independent_full'))}`")
        if bad:
            w("")
        mismatched = sorted({r["trial"]["id"] for r in trials if not r["trial"].get("expected_is_corrected_plus_rest")})
        if mismatched:
            w("Trial files whose `expected` is not their corrected text plus `rest`: " + ", ".join(mismatched) + ".\n")

    if variants:
        w("## Other text before the paste (`--before`)\n")
        w("| File | Text before | Ladder report | Class | Offset unit |")
        w("|---|---|---|---|---|")
        for r in variants:
            if ok(r):
                w(f"| `{r['_file']}` | `{md_escape(ascii(r.get('before')))}` | {report(r)} | {r['classification']['class']} | "
                  f"{' = '.join((r['ladder'].get('offsets') or {}).get('units_agreeing') or ['-'])} |")
            else:
                w(f"| `{r['_file']}` | `{md_escape(ascii(r.get('before')))}` | no result | | |")
        w("")

    versions = os.path.join(HERE, "results", "versions.txt")
    if os.path.exists(versions):
        w("## Versions\n")
        w("```")
        w(open(versions, encoding="utf-8").read().rstrip())
        w("```")

    summary["totals"] = dict(matrix=tally(matrix), trials=tally(trials))
    summary["cells_whose_reps_disagree"] = disagree
    with open(os.path.join(HERE, "results", "summary.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(out) + "\n")
    with open(os.path.join(HERE, "results", "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=1, ensure_ascii=False)
    print(os.path.join(HERE, "results", "summary.md"))


if __name__ == "__main__":
    main()
