#!/usr/bin/env python3
"""Add NVIDIA's SentencePiece tokenizer to the pinned Nemotron GGUF.

  graft-model-tokenizer.py MODEL [--tokenizer FILE]

To boost phrases, NeMo-Speech.cpp turns them into the model's pieces with the
SentencePiece model it reads from the GGUF key `asr.tokenizer.spm_model`.
NVIDIA's GGUF carries the decoder's vocabulary but not that model, so this
adds the checkpoint's own `tokenizer.model` under that key. Every other
metadata entry, every tensor description and all tensor data are copied byte
for byte. `runtime/speech/MODEL-IDENTITY.json` pins the NVIDIA file, the
tokenizer and the result.

MODEL is replaced in place, and only by a result with the pinned SHA-256. A
model that already is the pinned result is left alone; any other is refused.
Without --tokenizer, the tokenizer comes from the pinned revision of NVIDIA's
checkpoint: one HTTP range request reads its tar member's header and bytes, so
the 2.5 GB archive is never downloaded. A --tokenizer file must match the pin.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
IDENTITY = ROOT / "runtime/speech/MODEL-IDENTITY.json"
KEY = "asr.tokenizer.spm_model"
STRING, ARRAY = 8, 9
SCALARS = {0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f", 7: "?", 10: "Q", 11: "q", 12: "d"}
CHUNK = 1 << 20


def file_sha256(path):
    with open(path, "rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class Reader:
    """Reads a GGUF header from a stream, keeping every byte it read."""

    def __init__(self, stream):
        self.stream, self.raw = stream, bytearray()

    def take(self, size):
        data = self.stream.read(size)
        if len(data) != size:
            raise ValueError("the GGUF header is truncated")
        self.raw += data
        return data

    def unpack(self, fmt):
        return struct.unpack("<" + fmt, self.take(struct.calcsize("<" + fmt)))[0]

    def string(self):
        return self.take(self.unpack("Q")).decode("utf-8")

    def value(self, kind):
        if kind == STRING:
            return self.string()
        if kind == ARRAY:
            item, count = self.unpack("I"), self.unpack("Q")
            return [self.value(item) for _ in range(count)]
        if kind not in SCALARS:
            raise ValueError(f"unknown GGUF value type {kind}")
        return self.unpack(SCALARS[kind])


def read_header(stream):
    """A GGUF 3 header: its metadata, each entry's raw bytes, the tensor
    descriptions and the offset where tensor data starts."""
    reader = Reader(stream)
    if reader.take(4) != b"GGUF":
        raise ValueError("not a GGUF file")
    version, tensors, entries = reader.unpack("I"), reader.unpack("Q"), reader.unpack("Q")
    if version != 3:
        raise ValueError(f"unsupported GGUF version {version}")
    metadata, spans = {}, []
    for _ in range(entries):
        start = len(reader.raw)
        key = reader.string()
        metadata[key] = reader.value(reader.unpack("I"))
        spans.append(bytes(reader.raw[start:]))
    start = len(reader.raw)
    for _ in range(tensors):
        reader.string()
        reader.take(8 * reader.unpack("I") + 4 + 8)  # dimensions, type and data offset
    alignment = metadata.get("general.alignment", 32)
    return {"version": version, "tensors": tensors, "metadata": metadata, "spans": spans,
            "info": bytes(reader.raw[start:]), "alignment": alignment,
            "data_start": -(-len(reader.raw) // alignment) * alignment}


def pieces(proto):
    """The piece strings of a SentencePiece ModelProto: each field 1, then that
    message's field 1, read straight from the protobuf wire format."""
    def varint(buffer, at):
        shift = value = 0
        while True:
            if at >= len(buffer):
                raise ValueError("the tokenizer is truncated")
            byte = buffer[at]
            at += 1
            value |= (byte & 0x7F) << shift
            shift += 7
            if not byte & 0x80:
                return value, at

    def fields(buffer):
        at = 0
        while at < len(buffer):
            tag, at = varint(buffer, at)
            number, wire = tag >> 3, tag & 7
            if wire == 0:
                value, at = varint(buffer, at)
            elif wire == 1:
                value, at = buffer[at:at + 8], at + 8
            elif wire == 2:
                length, at = varint(buffer, at)
                value, at = buffer[at:at + length], at + length
            elif wire == 5:
                value, at = buffer[at:at + 4], at + 4
            else:
                raise ValueError(f"unexpected protobuf wire type {wire} in the tokenizer")
            if at > len(buffer):
                raise ValueError("the tokenizer is truncated")
            yield number, wire, value

    out = []
    for number, wire, value in fields(proto):
        if number == 1 and wire == 2:
            piece = next((v for n, w, v in fields(value) if n == 1 and w == 2), b"")
            out.append(piece.decode("utf-8"))
    return out


def encode_string(text):
    raw = text.encode("utf-8")
    return struct.pack("<Q", len(raw)) + raw


def grafted_header(header, tokenizer):
    """The header with the tokenizer appended as the last metadata entry, padded
    to the alignment, so the tensor data that follows needs no change."""
    if KEY in header["metadata"]:
        raise ValueError(f"the model already has {KEY}")
    if pieces(tokenizer) != header["metadata"].get("asr.tokenizer.vocab"):
        raise ValueError("the tokenizer's pieces differ from the model's vocabulary")
    entry = (encode_string(KEY) + struct.pack("<I", STRING)
             + encode_string(base64.b64encode(tokenizer).decode("ascii")))
    body = (b"GGUF" + struct.pack("<IQQ", header["version"], header["tensors"], len(header["spans"]) + 1)
            + b"".join(header["spans"]) + entry + header["info"])
    return body + b"\0" * (-len(body) % header["alignment"])


def graft(model, tokenizer, out):
    """Write MODEL plus the tokenizer to OUT, prove OUT differs from MODEL only
    by that one metadata entry, and return OUT's SHA-256."""
    with open(model, "rb") as source:
        header = read_header(source)
        out.write(grafted_header(header, tokenizer))
        source.seek(header["data_start"])
        tensors = hashlib.sha256()
        while block := source.read(CHUNK):
            tensors.update(block)
            out.write(block)
    out.flush()
    os.fsync(out.fileno())
    with open(out.name, "rb") as result:
        check = read_header(result)
        added = {key: value for key, value in check["metadata"].items() if key not in header["metadata"]}
        if (list(added) != [KEY] or base64.b64decode(added[KEY]) != tokenizer
                or check["spans"][:-1] != header["spans"] or check["info"] != header["info"]
                or check["tensors"] != header["tensors"]):
            raise ValueError("the result's header differs from the model's by more than the tokenizer")
        result.seek(0)
        whole, data, at = hashlib.sha256(), hashlib.sha256(), 0
        while block := result.read(CHUNK):
            whole.update(block)
            data.update(block[max(0, check["data_start"] - at):])
            at += len(block)
    if data.hexdigest() != tensors.hexdigest():
        raise ValueError("the result's tensor data differs from the model's")
    return whole.hexdigest()


def tar_member(data, pin):
    """The tokenizer's bytes from its 512-byte tar header and the member that follows."""
    if len(data) != 512 + pin["size"]:
        raise ValueError(f"expected {512 + pin['size']} bytes of the checkpoint, got {len(data)}")
    header, body = data[:512], data[512:]

    def octal(field):
        return int(field.split(b"\0")[0].strip() or b"0", 8)

    if octal(header[148:156]) != sum(header[:148]) + 8 * 32 + sum(header[156:]):
        raise ValueError("the tokenizer's tar header is corrupt")
    member = (header[:100].split(b"\0")[0].decode("utf-8", "replace"), octal(header[124:136]), header[156:157])
    if member != (pin["member"], pin["size"], b"0"):
        raise ValueError("the checkpoint doesn't hold the pinned tokenizer at the pinned offset")
    if hashlib.sha256(body).hexdigest() != pin["sha256"]:
        raise ValueError("the tokenizer's SHA-256 differs from the pin")
    return body


def fetch_tokenizer(identity, run=subprocess.run):
    """One range request for the tokenizer's tar header and bytes. A server that
    ignored the range would send the whole archive, so curl stops at the size."""
    pin = identity["tokenizer"]
    url = f"{identity['source']}/resolve/{identity['revision']}/{pin['archive']}"
    start, end = pin["offset"] - 512, pin["offset"] + pin["size"] - 1
    result = run(["curl", "--fail", "--silent", "--show-error", "--location", "--retry", "3",
                  "--max-time", "300", "--max-filesize", str(end - start + 1),
                  "--range", f"{start}-{end}", url], check=True, capture_output=True)
    return tar_member(result.stdout, pin)


def upgrade(model, identity, tokenizer=None, fetch=fetch_tokenizer):
    """Replace NVIDIA's file at MODEL with the pinned model; 'pinned' if it
    already is, 'grafted' when replaced."""
    model = Path(model)
    current = file_sha256(model)
    if current == identity["model_sha256"]:
        return "pinned"
    if current != identity["base_model_sha256"]:
        raise ValueError(f"{model} is neither the pinned model nor the NVIDIA file it's built from")
    if tokenizer is None:
        tokenizer = fetch(identity)
    elif hashlib.sha256(tokenizer).hexdigest() != identity["tokenizer"]["sha256"]:
        raise ValueError("the tokenizer's SHA-256 differs from the pin")
    with tempfile.NamedTemporaryFile(prefix=".graft-", dir=model.parent, delete=False) as out:
        try:
            if graft(model, tokenizer, out) != identity["model_sha256"]:
                raise ValueError("the result's SHA-256 differs from the pin")
            os.chmod(out.name, model.stat().st_mode & 0o777)
            os.replace(out.name, model)
        except BaseException:
            os.unlink(out.name)
            raise
    return "grafted"


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("model", type=Path)
    parser.add_argument("--tokenizer", type=Path, help="a copy of the pinned tokenizer.model")
    args = parser.parse_args()
    identity = json.loads(IDENTITY.read_text())
    try:
        tokenizer = args.tokenizer.read_bytes() if args.tokenizer else None
        outcome = upgrade(args.model, identity, tokenizer)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        detail = getattr(error, "stderr", None)
        raise SystemExit(f"graft-model-tokenizer: {error}" + (f": {detail.decode().strip()}" if detail else ""))
    print(f"{args.model}: {'already the pinned model' if outcome == 'pinned' else 'tokenizer added'}, "
          f"SHA-256 {identity['model_sha256']}")


if __name__ == "__main__":
    main()
