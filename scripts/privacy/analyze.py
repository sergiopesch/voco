#!/usr/bin/env python3
"""Judge one privacy run: what VOCO reached on the network and when it listened.

Reads what scripts/privacy/inner.sh recorded in a run folder: strace.txt (every
network call and process of VOCO and its children), dns.txt (the DNS queries and
answers tcpdump saw), streams.jsonl (microphone streams as PipeWire reported
them) and marks.jsonl (when dictation started and stopped). Prints the verdict as
JSON and exits 1 when a rule fails.

offline: update checks off and no network. No process may connect, send or bind
         to an internet address, or ask DNS anything, idle or dictating.
online:  update checks on, with a network. Only api.github.com may be resolved
         and reached, and the speech worker reaches nothing.
Both:    a microphone stream exists only while dictation runs, and the speech
         worker's own log shows it recognized the clip while traced.
"""
import json
import re
import sys
from pathlib import Path

GITHUB = "api.github.com"
INTERNET_CALLS = {"connect", "sendto", "sendmsg", "sendmmsg", "bind"}
NETWORK_CALLS = INTERNET_CALLS | {"socket", "socketpair", "accept", "accept4", "listen"}
# A stream may still close this long after dictation stops: capture ends after
# the last audio is flushed.
STOP_GRACE = 5.0
# The virtual microphone's own loopback (pipewire.conf), open for the whole run.
HARNESS_STREAM = "fixture_loopback_capture"


def lines(path):
    try:
        return Path(path).read_text(errors="replace").splitlines()
    except FileNotFoundError:
        return []


def records(path):
    return [json.loads(line) for line in lines(path) if line.strip()]


def processes(trace):
    """Each traced process's executable and parent, from execve and clone."""
    executables, parents = {}, {}
    for line in trace:
        match = re.match(r"(\d+)\s+\S+\s+(.*)", line)
        if not match:
            continue
        pid, call = match.groups()
        started = re.match(r'execve\("([^"]+)", \[(.*?)\]', call)
        if started and not re.search(r"= -1 ", call):
            executables[pid] = (started.group(1), started.group(2))
        child = re.match(r"(?:clone3?|fork|vfork)\(.*\) = (\d+)", call)
        if child:
            parents[child.group(1)] = pid
    return executables, parents


def owner(pid, executables, parents):
    """The executable a thread or process runs: its own, or its nearest ancestor's."""
    seen = set()
    while pid and pid not in executables and pid not in seen:
        seen.add(pid)
        pid = parents.get(pid)
    return executables.get(pid, ("?", ""))


def analyze(case, folder):
    folder = Path(folder)
    trace = lines(folder / "strace.txt")
    executables, parents = processes(trace)
    internet, worker_calls, worker_blocked = [], [], 0
    for line in trace:
        # A call strace splits keeps its arguments on the first, unfinished line.
        match = re.match(r"(\d+)\s+\S+\s+(\w+)\((.*)", line)
        if not match or match.group(2) not in NETWORK_CALLS:
            continue
        pid, call, arguments = match.groups()
        program, argv = owner(pid, executables, parents)
        if "stream_worker.py" in argv:
            # The worker's seccomp filter refuses sockets; a refused call reaches nothing.
            if "= -1 EPERM" in arguments:
                worker_blocked += 1
            else:
                worker_calls.append(line.strip()[:300])
        if call in INTERNET_CALLS and re.search(r"sa_family=AF_INET6?\b", arguments[:600]):
            port = re.search(r"sin6?_port=htons\((\d+)\)", arguments)
            address = re.search(r'(?:sin_addr=inet_addr\(|inet_pton\(AF_INET6, )"([^"]+)"', arguments)
            internet.append({"pid": pid, "program": program, "call": call,
                             "port": int(port.group(1)) if port else None,
                             "address": address.group(1) if address else None})
    dns = lines(folder / "dns.txt")
    # Every query type, as tcpdump prints it: "A? name.", "TXT? name.", "PTR? name." and so on.
    asked = sorted({name.rstrip(".") for name in re.findall(r"\b[A-Z][A-Z0-9]*\? (\S+) ", "\n".join(dns))})
    answers = {}
    for name, address in re.findall(r"(\S+)\. (?:A|AAAA) ([0-9a-f:.]+)", "\n".join(dns)):
        answers.setdefault(address, name)
    marks = {mark["mark"]: mark["t"] for mark in records(folder / "marks.jsonl")}
    streams = [stream for stream in records(folder / "streams.jsonl") if stream.get("node.name") != HARNESS_STREAM]
    log = "\n".join(lines(folder / "app.log"))
    failures = []
    if "Bundled Nemotron streaming model ready" not in log:
        failures.append("the speech model never became ready, so nothing was measured while dictating")
    if "toggle_on" not in marks or "toggle_off" not in marks:
        failures.append("the run never started and stopped a dictation")
    elif not any(event.get("event") == "first_hypothesis" for event in records(folder / "worker-performance.jsonl")):
        failures.append("the speech worker recognized nothing, so it never ran while traced")
    # inner.sh sends a sentinel on loopback after VOCO stops; capturing it shows
    # tcpdump ran to the end.
    if "voco-privacy-sentinel" not in "\n".join(lines(folder / "sentinel.txt")):
        failures.append("the packet capture didn't run to the end, so DNS may have gone unseen")
    if worker_calls:
        failures.append(f"the speech worker made {len(worker_calls)} network calls")
    reached = [call for call in internet if call["port"] != 53]
    if case == "offline":
        if internet:
            failures.append(f"{len(internet)} internet socket calls with no network and update checks off")
        if asked:
            failures.append(f"DNS queries with update checks off: {asked}")
    else:
        strangers = [name for name in asked if name != GITHUB and not name.startswith(GITHUB + ".")]
        if strangers:
            failures.append(f"DNS queries for hosts other than {GITHUB}: {strangers}")
        github = {address for address, name in answers.items() if name == GITHUB}
        elsewhere = [call for call in reached if call["address"] not in github]
        if elsewhere:
            failures.append(f"connections to addresses DNS didn't give for {GITHUB}: "
                            f"{sorted({(call['address'], call['port']) for call in elsewhere})}")
        if not github or not reached:
            failures.append(f"the update check never reached {GITHUB}, so the online case proves nothing")
    if "toggle_on" in marks and "toggle_off" in marks:
        opened = [stream for stream in streams if stream.get("event") == "open"]
        closed = [stream for stream in streams if stream.get("event") == "close"]
        if not opened:
            failures.append("no microphone stream opened while dictating")
        idle = [stream for stream in opened if not marks["toggle_on"] <= stream["t"] <= marks["toggle_off"] + STOP_GRACE]
        late = [stream for stream in closed if stream["t"] > marks["toggle_off"] + STOP_GRACE]
        if idle or late or len(closed) < len(opened):
            failures.append("a microphone stream was open outside the dictation")
    return {
        "case": case,
        "result": "FAIL" if failures else "PASS",
        "failures": failures,
        "internet_calls": internet,
        "dns_queries": asked,
        "dns_answers": answers,
        "speech_worker_network_calls": len(worker_calls),
        "speech_worker_calls_its_sandbox_refused": worker_blocked,
        "microphone_streams": len([stream for stream in streams if stream.get("event") == "open"]),
        "clipboard_characters": len("\n".join(lines(folder / "clipboard.txt")).strip()),
        "programs": sorted({program for program, _ in executables.values()}),
    }


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in ("offline", "online"):
        sys.exit("usage: analyze.py offline|online RUN_FOLDER")
    verdict = analyze(sys.argv[1], sys.argv[2])
    json.dump(verdict, sys.stdout, indent=1)
    print()
    sys.exit(0 if verdict["result"] == "PASS" else 1)


if __name__ == "__main__":
    main()
