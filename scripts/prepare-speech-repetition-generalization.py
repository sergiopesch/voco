#!/usr/bin/env python3
"""Freeze complete-utterance repetition controls without running inference."""
import argparse
import hashlib
import json
from pathlib import Path
import wave


SAMPLE_RATE = 16_000
TOTAL_SAMPLES = 30 * SAMPLE_RATE
PAUSE_SAMPLES = SAMPLE_RATE // 4
MAX_LEADING_SAMPLES = 3 * SAMPLE_RATE // 4
FIXTURE_IDS = ("777-126732-0000", "1272-128104-0000", "1993-147149-0000")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_wav(path, pcm):
    with wave.open(str(path), "wb") as wav:
        wav.setparams((1, 2, SAMPLE_RATE, 0, "NONE", "not compressed"))
        wav.writeframes(pcm)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan-dir", type=Path, required=True)
    args = parser.parse_args()
    repo = Path(__file__).resolve().parent.parent
    manifest_path = repo / "tests/fixtures/speech/adversarial/manifest.json"
    model_manifest_path = repo / "tests/fixtures/speech/manifest.json"
    manifest = json.loads(manifest_path.read_text())
    model_manifest = json.loads(model_manifest_path.read_text())
    entries = {entry["id"]: entry for entry in manifest["fixtures"]}
    sources = []
    for fixture_id in FIXTURE_IDS:
        entry = entries[fixture_id]
        path = manifest_path.parent / entry["file"]
        if digest(path.read_bytes()) != entry["sha256"]:
            raise ValueError(f"Source WAV hash mismatch: {fixture_id}")
        with wave.open(str(path), "rb") as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate(), wav.getcomptype()) != (1, 2, SAMPLE_RATE, "NONE"):
                raise ValueError(f"Unsupported source format: {fixture_id}")
            sample_count = wav.getnframes()
            pcm = wav.readframes(sample_count)
        if len(pcm) != sample_count * 2 or digest(pcm) != entry["pcmSha256"]:
            raise ValueError(f"Source PCM hash mismatch: {fixture_id}")
        repeat_count = (TOTAL_SAMPLES - MAX_LEADING_SAMPLES) // (sample_count + PAUSE_SAMPLES)
        if repeat_count < 2 or not entry["reference"].strip():
            raise ValueError(f"Fixture cannot form a repetition control: {fixture_id}")
        sources.append((entry, sample_count, pcm, repeat_count))

    out = args.plan_dir.resolve()
    out.mkdir(parents=True, exist_ok=False)
    combined = bytearray()
    cases = []
    for entry, sample_count, pcm, repeat_count in sources:
        for leading_ms in (0, 175, 500, 750):
            leading = leading_ms * SAMPLE_RATE // 1000
            audio = bytearray(leading * 2)
            ranges = []
            for _ in range(repeat_count):
                start = len(audio) // 2
                audio.extend(pcm)
                ranges.append([start, len(audio) // 2])
                audio.extend(bytes(PAUSE_SAMPLES * 2))
            trailing = TOTAL_SAMPLES - len(audio) // 2
            if trailing < 0:
                raise ValueError("Complete repetitions exceeded the declared duration")
            audio.extend(bytes(trailing * 2))
            name = f"repeat-{entry['id']}-leading-{leading_ms}"
            path = out / f"{name}.wav"
            write_wav(path, audio)
            start = len(combined) // 2
            combined.extend(audio)
            cases.append({
                "id": name, "family": "repetition-generalization", "file": path.name,
                "sha256": digest(path.read_bytes()), "pcmSha256": digest(audio),
                "startSample": start, "endSample": len(combined) // 2,
                "reference": " ".join([entry["reference"]] * repeat_count),
                "maxWer": 0.25, "expectedSpeech": True,
                "source": {"fixture": entry, "sourceSamples": sample_count,
                           "repeatCount": repeat_count, "completeUtteranceRanges": ranges,
                           "leadingSilenceSamples": leading, "silenceAfterEveryUtteranceSamples": PAUSE_SAMPLES,
                           "additionalTrailingSilenceSamples": trailing,
                           "gain": 1, "croppedSamples": 0},
            })
    write_wav(out / "combined.wav", combined)
    plan = {
        "schemaVersion": 1, "createdBeforeInference": True,
        "runnerSha256": digest(Path(__file__).read_bytes()),
        "sourceManifestSha256": digest(manifest_path.read_bytes()),
        "modelManifestSha256": digest(model_manifest_path.read_bytes()),
        "modelSha256": model_manifest["modelSha256"],
        "corpus": {key: manifest[key] for key in ("corpus", "source", "archive", "archiveMd5", "archiveSha256", "license", "copyright")},
        "sourceLicenseSha256": digest((manifest_path.parent / "LICENSE.txt").read_bytes()),
        "aggregateMaxWer": 0.25,
        "combinedSha256": digest((out / "combined.wav").read_bytes()),
        "combinedPcmSha256": digest(combined), "cases": cases,
        "notes": [
            "Prospective 12-case repetition challenge, frozen before inference; not a representative dictation benchmark.",
            "Count=floor((30-0.75)/(source duration+0.25)), computed exactly in integer samples.",
            "Each repetition preserves the entire source PCM followed by 250 ms digital silence, including the final repetition. Remaining duration is zero-padded to exactly 30 seconds.",
            "Reference is the complete corpus transcript repeated count times, never decoder output. No source samples are cropped, scaled, normalized or reordered within an utterance.",
            "Every case requires nonempty lexical output and WER <=0.25; the combined repetition-generalization family requires aggregate WER <=0.25. Report baseline failures too.",
        ],
    }
    (out / "plan.json").write_text(json.dumps(plan, indent=2) + "\n")
    print(json.dumps({"cases": len(cases), "planSha256": digest((out / "plan.json").read_bytes()),
                      "repeats": {entry["id"]: count for entry, _, _, count in sources}}))


if __name__ == "__main__":
    main()
