"""Record when microphone streams open and close: poll pw-dump four times a second."""
import json
import subprocess
import sys
import time

out = open(sys.argv[1], "a", buffering=1)
seen = {}
while True:
    try:
        nodes = json.loads(subprocess.run(["pw-dump", "--no-colors"], capture_output=True, text=True,
                                          timeout=5).stdout or "[]")
    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
        out.write(json.dumps({"t": time.time(), "error": str(error)}) + "\n")
        time.sleep(0.5)
        continue
    now = {}
    for node in nodes:
        props = (node.get("info") or {}).get("props") or {}
        if node.get("type") == "PipeWire:Interface:Node" and props.get("media.class", "").startswith("Stream/Input"):
            now[node["id"]] = {key: props.get(key) for key in ("media.class", "application.name",
                                                               "application.process.binary", "node.name")}
    for node in now.keys() - seen.keys():
        out.write(json.dumps({"t": time.time(), "event": "open", "id": node, **now[node]}) + "\n")
    for node in seen.keys() - now.keys():
        out.write(json.dumps({"t": time.time(), "event": "close", "id": node, **seen[node]}) + "\n")
    seen = now
    time.sleep(0.25)
