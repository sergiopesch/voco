#!/usr/bin/python3.12
"""Build results/summary.md from the JSON files in results/.

    /usr/bin/python3.12 summarize.py            # writes results/summary.md
    /usr/bin/python3.12 summarize.py --print    # also prints it

Every table cell comes from a result file; a missing file reads "not run".
The only hand-written text is notes.json (what was unavailable and why, and
what was not measured).
"""
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(HERE, "results")
NOTES_FILE = os.path.join(HERE, "notes.json")

ORDER = [
    "gnome-text-editor", "gtk4-textview", "gtk4-entry",
    "gedit", "mousepad", "gtk3-textview", "gtk3-entry",
    "featherpad", "libreoffice-writer",
    "gnome-terminal", "xfce4-terminal", "xterm",
    "chromium-textarea", "chromium-input", "chromium-contenteditable",
    "epiphany-textarea", "epiphany-input", "epiphany-contenteditable",
]


def load():
    data = {}
    for path in sorted(glob.glob(os.path.join(RESULTS, "*.json"))):
        d = json.load(open(path, encoding="utf-8"))
        data[(d.get("case"), d.get("scenario"), d.get("config"))] = d
    return data


def yn(value):
    if value is None:
        return "not run"
    return "yes" if value else "NO"


def launch_failed(d):
    if d is None:
        return "not run"
    if d.get("harness_error"):
        return "harness error"
    if d.get("launch", {}).get("error"):
        return "no window"
    return None


def probe_ok(d):
    """A probe exposed the field: found, and its text read back as pasted."""
    if launch_failed(d) or not d.get("lookup", {}).get("found"):
        return False
    v = d.get("verify_before_caret", {})
    return bool(v.get("text_before_caret_ends_with_pasted_nbsp_folded"))


def enabled_cell(case, data):
    probes = {cfg: d for (c, s, cfg), d in data.items() if c == case and s == "probe"}
    if not probes:
        return "not run"
    ok = sorted(cfg for cfg, d in probes.items() if probe_ok(d))
    bad = sorted(cfg for cfg, d in probes.items() if not probe_ok(d))
    fmt = lambda names: ", ".join(f"`{n}`" for n in names)  # noqa: E731
    if not ok:
        return f"never readable ({len(bad)} configs tried: {fmt(bad)})"
    if "plain" in ok and not bad:
        return f"nothing (readable under all {len(ok)} configs tried: {fmt(ok)})"
    if "plain" in ok:
        return f"nothing under `plain`; readable under {fmt(ok)}; NOT under {fmt(bad)}"
    return f"readable only under {fmt(ok)}; NOT under {fmt(bad)}"


def main_row(case, config, data):
    a = data.get((case, "atspi", config))
    b = data.get((case, "blind", config))
    label = (a or b or {}).get("label", case)
    cells = [f"{label}", f"`{config}`"]
    fail = launch_failed(a)
    if fail:
        cells += [fail] * 6
        lookup = replace_ms = "-"
    else:
        found = a.get("lookup", {}).get("found")
        read = a.get("read", {})
        v = a.get("verify_before_caret", {})
        text_ok = isinstance(read.get("text"), str) and "error" not in read
        caret_ok = isinstance(read.get("caret"), int) and read.get("caret", -1) >= 0
        if a["kind"] == "terminal":
            matched = v.get("text_before_caret_ends_with_pasted") and v.get("text_after_caret_is_blank")
            matched_txt = ("yes: the screen text before the caret ends with it, nothing after the caret"
                           if matched else "NO")
        else:
            matched = v.get("text_equals_expected") and v.get("caret_at_end_of_text")
            matched_txt = yn(bool(matched))
            if not matched and v.get("text_equals_expected_nbsp_folded") and v.get("caret_at_end_of_text"):
                matched_txt = (f"only with U+00A0 read as a space: {v.get('no_break_spaces_in_text')} "
                               "no-break space(s) where a chunk began or ended with a space; caret at end")
        rep = a.get("replace", {})
        if not found:
            cells += ["NO", "-", "-", "-", "-", "-"]
        else:
            cells.append("yes")
            cells.append(yn(text_ok) if read.get("has_text") else "NO (no Text interface)")
            cells.append(yn(caret_ok) if read.get("has_text") else "-")
            cells.append(matched_txt if text_ok else "-")
            if "attempts" in rep:
                if rep.get("worked_method") and rep.get("independent_is_final"):
                    cells.append(f"yes: {rep['worked_method']}")
                elif rep.get("worked_method"):
                    cells.append(f"AT-SPI says yes ({rep['worked_method']}), independent check NO")
                else:
                    tried = ", ".join(x["method"] for x in rep["attempts"])
                    cells.append("NO (tried " + tried + ")" if read.get("has_editable_text")
                                 else "NO: no EditableText interface (calls tried and failed)")
            else:
                cells.append("not attempted: " + str(rep.get("skipped", "no text")))
            c = a.get("caret")
            if c and rep.get("worked_method"):
                ind = c.get("independent_text_before_caret_is_final")
                if c.get("at_end_without_help"):
                    cells.append("yes, by itself" + ("" if ind else " (AT-SPI; independent check NO)"))
                elif c.get("at_end_finally_atspi"):
                    cells.append(f"yes, after set_caret_offset (was at {c.get('after_replace')})"
                                 + ("" if ind else " (AT-SPI; independent check NO)"))
                else:
                    cells.append(f"NO (at {c.get('after_set_caret_offset', c.get('after_replace'))})")
            else:
                cells.append("-")
        lo = a.get("lookup", {})
        lookup = (f"{lo['cold']['median_ms']:.1f} / {lo['warm']['median_ms']:.1f}"
                  f" ({lo['cold']['runs'][-1].get('nodes')} nodes)") if lo.get("found") else "-"
        replace_ms = f"{rep['ms']:.1f}" if rep.get("ms") is not None else "-"
    fail_b = launch_failed(b)
    if fail_b:
        cells.append(fail_b)
    else:
        bl = b.get("blind", {})
        if bl.get("field_exact"):
            cells.append("yes" + ("" if bl.get("caret_at_end") else " (caret NOT at end)"))
        elif bl.get("field_exact_ignoring_trailing_newline"):
            cells.append("yes (copy adds a newline)")
        else:
            cells.append("NO")
    cells += [lookup, replace_ms, enabled_cell(case, data)]
    return "| " + " | ".join(cells) + " |"


def short(text, n=70):
    text = repr(text)
    return text if len(text) <= n else text[:n] + "…'"


def method_row(case, config, data):
    out = [case, f"`{config}`"]
    for scenario in ("atspi", "atspi_settext", "atspi_selpaste"):
        d = data.get((case, scenario, config))
        fail = launch_failed(d)
        if fail:
            out.append(fail)
            continue
        rep = d.get("replace")
        if not rep:
            out.append("no field found" if not d.get("lookup", {}).get("found") else "no Text")
            continue
        if "attempts" not in rep:
            out.append("not attempted")
            continue
        parts = []
        for at in rep["attempts"]:
            ok = at.get("text_is_final")
            err = at.get("error")
            txt = f"{at['method']}: " + ("ok" if ok else "FAILED")
            if ok:
                txt += f", {at.get('ms')} ms, caret then at {at.get('caret_after')}"
            elif err is not None:
                txt += f" (error: {(err or 'empty message')[:90]})"
            else:
                rets = [str(at[k]) for k in ("delete_returned", "insert_returned", "returned", "select_returned") if k in at]
                txt += f" (returned {'/'.join(rets)}; text then {short(at.get('text_after'))})"
            parts.append(txt)
        ind = rep.get("independent_is_final")
        c = d.get("caret", {})
        tail = f"; independent read: {'final text' if ind else short(d.get('independent_after', {}).get('full'))}"
        if rep.get("worked_method"):
            tail += ("; caret at end " + ("by itself" if c.get("at_end_without_help") else
                                           "after set_caret_offset" if c.get("at_end_finally_atspi") else "NO")
                     + (" (independent: yes)" if c.get("independent_text_before_caret_is_final")
                        else " (independent: NO)"))
        out.append("; ".join(parts) + tail)
    return "| " + " | ".join(out) + " |"


def hazard_row(case, config, data):
    out = [case, f"`{config}`"]
    d = data.get((case, "hazard_atspi", config))
    fail = launch_failed(d)
    if fail:
        out.append(fail)
    elif "hazard_atspi" not in d:
        out.append("no readable field: nothing to check, nothing edited")
    else:
        h = d["hazard_atspi"]
        out.append(f"caret seen at {h['caret_seen']}; {h['decision']}; field untouched: {yn(h.get('field_untouched'))}")
    d = data.get((case, "hazard_blind", config))
    fail = launch_failed(d)
    if fail:
        out.append(fail)
    else:
        out.append("`" + str(d.get("independent_after", {}).get("full")).replace("\n", "\\n") + "`")
    return "| " + " | ".join(out) + " |"


def focus_row(case, config, data):
    d = data.get((case, "atspi", config))
    if launch_failed(d):
        return f"| {case} | `{config}` | {launch_failed(d)} | - | - | - | - |"
    fe = d.get("focus_events", {})
    lo = d.get("lookup", {})
    run = (lo.get("cold", {}).get("runs") or [{}])[-1]
    fl = d.get("first_lookup", {})
    f = d.get("focused") or {}
    return "| " + " | ".join([
        case, f"`{config}`",
        f"{f.get('role')} ({f.get('toolkit')} {f.get('toolkit_version')})" if f else "none",
        str(fe.get("count", "-")),
        yn(fe.get("last_event_source_is_walk_result")) if lo.get("found") else "-",
        f"{run.get('focused_seen', 0)}; picked {run.get('picked', '-')}",
        f"{fl.get('after_s')} s" if fl.get("found") else f"not within {fl.get('waited_up_to_s')} s",
    ]) + " |"


def probe_rows(data):
    rows = []
    key = lambda kv: (ORDER.index(kv[0][0]) if kv[0][0] in ORDER else 99, kv[0][2])  # noqa: E731
    for (case, scenario, config), d in sorted(data.items(), key=key):
        if scenario != "probe":
            continue
        env = d.get("environment", {})
        start = env.get("at_app_start", {})
        fail = launch_failed(d)
        found = d.get("lookup", {}).get("found")
        listed = [a["name"] for a in d.get("desktop_apps", [])]
        added = {k: v for k, v in d.get("launch", {}).get("env_added", {}).items()
                 if k in d.get("config_detail", {}).get("env", {})}
        extra = []
        if d.get("config_detail", {}).get("screen_reader"):
            extra.append("ScreenReaderEnabled=true before launch")
        if d.get("config_detail", {}).get("screen_reader_after"):
            extra.append("ScreenReaderEnabled=true after launch")
        rows.append("| " + " | ".join([
            case, f"`{config}`", d.get("client_connects", "?"),
            yn(start.get("a11y_bus_running")),
            str(start.get("a11y_status", {}).get("IsEnabled", "-")),
            "; ".join([f"{k}={v}" for k, v in added.items()]
                      + d.get("config_detail", {}).get("args", []) + extra) or "-",
            fail or (", ".join(str(x) for x in listed) or "none"),
            fail or yn(found),
            fail or (yn(probe_ok(d)) if found else "-"),
        ]) + " |")
    return rows


def launch_rows(data, pairs):
    rows = []
    for case, config in pairs:
        d = data.get((case, "atspi", config)) or data.get((case, "blind", config))
        la = d.get("launch", {})
        cmd = " ".join(os.path.basename(x) if x.startswith("/") and i == 0 else x
                       for i, x in enumerate(la.get("cmd", [])))
        cmd = cmd.replace(HERE, ".")
        click = la.get("click")
        rows.append("| " + " | ".join([
            case, f"`{cmd[:230]}`",
            "; ".join(f"{k}={v}" for k, v in la.get("env_added", {}).items()) or "-",
            "; ".join(" ".join(p["cmd"]) for p in la.get("pre", [])) or "-",
            f"click at {click['x']},{click['y']} in the window" if click else "none (the app or page focuses it)",
        ]) + " |")
    return rows


def main():
    data = load()
    notes = json.load(open(NOTES_FILE, encoding="utf-8")) if os.path.exists(NOTES_FILE) else {}
    pairs = []
    for case in ORDER:
        configs = sorted({c for (k, s, c) in data if k == case and s in ("atspi", "blind")})
        pairs += [(case, config) for config in configs]

    any_plain = next((d for (c, s, cfg), d in sorted(data.items()) if cfg == "plain" and "environment" in d), {})
    env = any_plain.get("environment", {})
    failures = [(k, launch_failed(d)) for k, d in sorted(data.items()) if launch_failed(d)]
    versions = ""
    vpath = os.path.join(RESULTS, "versions.txt")
    if os.path.exists(vpath):
        versions = open(vpath, encoding="utf-8").read().strip()

    lines = ["# Field access through AT-SPI2: results", ""]
    lines += [
        f"- Session: {env.get('session_type')}, one fresh session per run; AT-SPI client: libatspi through "
        f"python3-gi on Python {env.get('python')}; at-spi2-core {env.get('atspi_version')}.",
        f"- `gsettings get org.gnome.desktop.interface toolkit-accessibility` in the fresh session: "
        f"`{env.get('gsettings_toolkit_accessibility')}`. It was never changed.",
        f"- `org.a11y.Status` once the client had connected: `{env.get('a11y_status_after_client_connect')}`. "
        "Connecting a client did not change it. Only the configs named `status`/`screen-reader` set it.",
        f"- Result files: {len(data)} runs over {len({k[0] for k in data})} app/field cases. "
        f"Runs with no app window or a harness error: {len(failures)}"
        + (": " + ", ".join(f"{c}/{s}/{cfg} ({why})" for (c, s, cfg), why in failures) if failures else "") + ".",
        f"- Text pasted in three chunks: `{any_plain.get('expected')}`; wanted after the correction: "
        f"`{any_plain.get('final_expected')}`.",
        "",
    ]
    lines += ["## Summary", "",
              "One row per app/field, under the launch config its scenarios ran with. "
              "Columns 3 to 8 and the timings are the `atspi` scenario; \"blind\" is the `blind` scenario "
              "in a fresh field. \"Worked\" always means the independent read (no AT-SPI) agreed. "
              "Lookup ms: median of 5 tree walks, cold / warm (libatspi's cache cleared before each walk / kept), "
              "with the nodes visited. Replace ms: the EditableText calls only.", "",
              "| App / field | Config | Focused object found | Text readable | Caret readable | Text matched, caret at end | EditableText replace worked | Caret restored to end | Blind 27 BackSpace + paste exact | Lookup ms cold / warm | Replace ms | What had to be enabled (from the probes) |",
              "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    lines += [main_row(c, cfg, data) for c, cfg in pairs]
    lines += ["", "## Replace methods, each from a fresh field", "",
              "`atspi` tries delete_text+insert_text and falls back to set_text_contents; "
              "`atspi_settext` uses set_text_contents only; `atspi_selpaste` selects the word with "
              "Text.add_selection/set_selection and then pastes the right word VOCO's way "
              "(xclip CLIPBOARD and PRIMARY, Shift+Insert). The independent read is Ctrl+A, Ctrl+C "
              "(bash's READLINE_LINE in terminals).", "",
              "| Case | Config | atspi | atspi_settext | atspi_selpaste |", "|---|---|---|---|---|"]
    lines += [method_row(c, cfg, data) for c, cfg in pairs]
    lines += ["", "## Hazard: Home pressed after the pastes (one run each)", "",
              "| Case | Config | AT-SPI path | Blind path left the field as |", "|---|---|---|---|"]
    lines += [hazard_row(c, cfg, data) for c, cfg in pairs]
    lines += ["", "## Finding the field: tree walk and focus events (`atspi` scenario)", "",
              "The listener was registered for `object:state-changed:focused` and `focus:` before the app started. "
              "\"Focused objects seen\" counts the objects with STATE_FOCUSED the walk met before it returned.", "",
              "| Case | Config | Object returned | Focus events received | Last event's source is that object | Focused objects seen; rule that picked | First found after |",
              "|---|---|---|---|---|---|---|"]
    lines += [focus_row(c, cfg, data) for c, cfg in pairs]
    lines += ["", "## Probes: what each launch config exposed", "",
              "`Client connects` = when the harness (the AT-SPI client) connected, before the app started or "
              "after the pastes. `Bus at start` = whether org.a11y.Bus had an owner when the app started. "
              "\"Text read back\" = the text before the caret ends with the pasted sentence.", "",
              "| Case | Config | Client connects | Bus at start | IsEnabled at start | Env, args or status added by the config | Apps on the AT-SPI desktop | Focused object found | Text read back |",
              "|---|---|---|---|---|---|---|---|---|"]
    lines += probe_rows(data)
    lines += ["", "## How each app was started", "",
              "| Case | Command | Env the harness always adds | Before launch | Focus |", "|---|---|---|---|---|"]
    lines += launch_rows(data, pairs)
    for title in ("Unavailable", "Not measured", "Limits of this measurement"):
        items = notes.get(title, [])
        if items:
            lines += ["", f"## {title}", ""] + [f"- {item}" for item in items]
    if versions:
        lines += ["", "## Versions", "", "```", versions, "```"]
    lines.append("")
    out = os.path.join(RESULTS, "summary.md")
    with open(out, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    if "--print" in sys.argv:
        print("\n".join(lines))
    else:
        print(out)


if __name__ == "__main__":
    main()
