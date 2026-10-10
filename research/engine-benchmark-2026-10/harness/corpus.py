#!/usr/bin/env python3
"""TEST ONLY: build the benchmark's public English test subset.

  corpus.py --downloads DIR --out DIR

Verifies each pinned download by SHA-256, applies the subset rules fixed before
any inference, and writes 16 kHz mono float32 audio (`<id>.f32`) plus
`manifest.jsonl`: id, set, seconds, speaker, `ref` (the reference used for WER)
and `ref_pc` (the punctuated and cased reference, where one exists).

Subsets (IDs sorted lexicographically, as in BRIEF.md section 5):
  ls-clean   LibriSpeech-PC test-clean, every 24th utterance
  ls-other   LibriSpeech-PC test-other, every 36th utterance
  fleurs     FLEURS en_us test, every 5th sentence ID, its lowest file name
  voxpopuli  VoxPopuli en test, first 3-20 s utterance of the first 60 speakers
"""
import argparse
import csv
import hashlib
import io
import json
import pathlib
import sys
import tarfile

import numpy as np
import soundfile as sf

RATE = 16000
DOWNLOADS = {
    "test-clean.tar.gz": "39fde525e59672dc6d1551919b1478f724438a95aa55f874b576be21967e6c23",
    "test-other.tar.gz": "d09c181bba5cf717b3dee7d4d592af11a3ee3a09e08ae025c5506f6ebe961c29",
    "librispeech-pc-manifests.tar.gz": "96d4eae2222b29b66437a21959252419bcd4762e5042e71e023790171054d1c0",
    "fleurs-en_us-test.tar.gz": "d9c2e37b41aacd41bc283554a0a82b5476b36887049774ecb2819dcaaa55a356",
    "fleurs-en_us-test.tsv": "74c046239374deeb60fa63f258f907388093a32bcaa3140965f70ef05c79f7ca",
    "voxpopuli-en-test.parquet": "02cc7290425ddb95beeabda1d1e81e5e068cd7a25380bcf1fb69071b62610ffa",
}


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def to_16k_mono(data, rate):
    data = np.asarray(data, dtype=np.float32)
    if data.ndim == 2:
        data = data.mean(axis=1)
    if rate != RATE:
        raise ValueError(f"expected {RATE} Hz audio, got {rate}")
    return np.ascontiguousarray(data, dtype=np.float32)


def write(out, entries, entry, audio):
    (out / f"{entry['id']}.f32").write_bytes(audio.tobytes())
    entry["seconds"] = round(len(audio) / RATE, 3)
    entries.append(entry)


def librispeech(downloads, out, entries):
    with tarfile.open(downloads / "librispeech-pc-manifests.tar.gz") as manifests:
        texts = {}
        for member in manifests.getmembers():
            name = member.name.rsplit("/", 1)[-1]
            for split in ("test-clean", "test-other"):
                if member.isfile() and split in name and name.endswith(".json"):
                    for line in manifests.extractfile(member).read().decode().splitlines():
                        if line.strip():
                            row = json.loads(line)
                            utt = pathlib.Path(row["audio_filepath"]).stem
                            texts.setdefault(split, {})[utt] = row["text"]
    for split, step, label in (("test-clean", 24, "ls-clean"), ("test-other", 36, "ls-other")):
        chosen = sorted(texts[split])[::step]
        wanted = set(chosen)
        originals, audio = {}, {}
        with tarfile.open(downloads / f"{split}.tar.gz") as archive:
            for member in archive:
                name = member.name.rsplit("/", 1)[-1]
                if name.endswith(".trans.txt"):
                    for line in archive.extractfile(member).read().decode().splitlines():
                        utt, _, text = line.partition(" ")
                        if utt in wanted:
                            originals[utt] = text
                elif name.endswith(".flac") and name[:-5] in wanted:
                    data, rate = sf.read(io.BytesIO(archive.extractfile(member).read()), dtype="float32")
                    audio[name[:-5]] = to_16k_mono(data, rate)
        for utt in chosen:
            write(out, entries, {"id": f"{label}-{utt}", "set": label, "speaker": utt.split("-")[0],
                                 "ref": originals[utt], "ref_pc": texts[split][utt]}, audio[utt])


def fleurs(downloads, out, entries):
    with open(downloads / "fleurs-en_us-test.tsv", newline="") as stream:
        rows = list(csv.reader(stream, delimiter="\t", quoting=csv.QUOTE_NONE))
    by_sentence = {}
    for row in rows:
        by_sentence.setdefault(int(row[0]), []).append(row)
    chosen = {}
    for sentence in sorted(by_sentence)[::5]:
        row = min(by_sentence[sentence], key=lambda r: r[1])
        chosen[row[1]] = row
    with tarfile.open(downloads / "fleurs-en_us-test.tar.gz") as archive:
        for member in archive:
            name = member.name.rsplit("/", 1)[-1]
            if name in chosen:
                row = chosen[name]
                data, rate = sf.read(io.BytesIO(archive.extractfile(member).read()), dtype="float32")
                write(out, entries, {"id": f"fleurs-{row[0]}-{name[:-4]}", "set": "fleurs", "speaker": "unknown",
                                     "ref": row[2], "ref_pc": row[2]}, to_16k_mono(data, rate))
    missing = set(chosen) - {e["id"].split("-", 2)[2] + ".wav" for e in entries if e["set"] == "fleurs"}
    if missing:
        raise SystemExit(f"FLEURS audio missing for {sorted(missing)[:3]}")


def voxpopuli(downloads, out, entries):
    import pyarrow.parquet as pq
    table = pq.read_table(downloads / "voxpopuli-en-test.parquet").to_pylist()
    by_speaker = {}
    for row in sorted(table, key=lambda r: r["audio_id"]):
        if not (row.get("raw_text") or "").strip():
            continue
        data, rate = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")
        seconds = len(data) / rate
        speaker = row["speaker_id"]
        if 3 <= seconds <= 20 and speaker not in by_speaker:
            by_speaker[speaker] = (row, to_16k_mono(data, rate))
    for speaker in sorted(by_speaker, key=lambda s: int(s) if str(s).isdigit() else 10**9)[:60]:
        row, audio = by_speaker[speaker]
        write(out, entries, {"id": f"voxpopuli-{row['audio_id']}", "set": "voxpopuli", "speaker": str(speaker),
                             "ref": row["raw_text"], "ref_pc": row["raw_text"]}, audio)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--downloads", required=True, type=pathlib.Path)
    parser.add_argument("--out", required=True, type=pathlib.Path)
    args = parser.parse_args()
    for name, expected in DOWNLOADS.items():
        actual = sha256(args.downloads / name)
        if actual != expected:
            raise SystemExit(f"{name}: SHA-256 {actual} != {expected}")
    args.out.mkdir(parents=True, exist_ok=False)
    entries = []
    librispeech(args.downloads, args.out, entries)
    fleurs(args.downloads, args.out, entries)
    voxpopuli(args.downloads, args.out, entries)
    with open(args.out / "manifest.jsonl", "w") as stream:
        for entry in entries:
            stream.write(json.dumps(entry) + "\n")
    summary = {}
    for entry in entries:
        item = summary.setdefault(entry["set"], {"utterances": 0, "minutes": 0.0, "speakers": set()})
        item["utterances"] += 1
        item["minutes"] += entry["seconds"] / 60
        item["speakers"].add(entry["speaker"])
    print(json.dumps({k: {"utterances": v["utterances"], "minutes": round(v["minutes"], 1),
                          "speakers": len(v["speakers"])} for k, v in summary.items()}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
