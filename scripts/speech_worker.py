"""Bounded JSON response framing for local speech qualification workers."""
import json
import os
import select
import time


class WorkerResponses:
    """Bound the complete response, including a stalled partial JSON line."""

    def __init__(self, stream, max_bytes=8 * 1024 * 1024):
        self.stream = stream
        self.pending = bytearray()
        self.max_bytes = max_bytes

    def read(self, timeout=120):
        deadline = time.monotonic() + timeout
        while True:
            newline = self.pending.find(b'\n')
            if newline >= 0:
                if newline > self.max_bytes:
                    raise RuntimeError('Worker response exceeded the size bound')
                line = bytes(self.pending[:newline])
                del self.pending[:newline + 1]
                return json.loads(line)
            if len(self.pending) > self.max_bytes:
                raise RuntimeError('Worker response exceeded the size bound')
            remaining = deadline - time.monotonic()
            if remaining <= 0 or not select.select([self.stream], [], [], remaining)[0]:
                raise RuntimeError('Worker exceeded the complete-response time bound')
            chunk = os.read(self.stream.fileno(), 65536)
            if not chunk:
                raise RuntimeError('Worker closed stdout before a complete response')
            self.pending.extend(chunk)
