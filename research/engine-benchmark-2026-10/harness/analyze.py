#!/usr/bin/env python3
"""TEST ONLY: paired bootstrap of WER differences against a baseline run.

  analyze.py --corpus DIR BASELINE.jsonl OTHER.jsonl...

Resamples utterances with replacement (2,000 times, fixed seed) and reports the
95% interval of each run's WER minus the baseline's, over the utterances both
runs completed. An interval that spans 0 means the subset can't tell them apart.
"""
import argparse
import json
import pathlib
import random
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from score import align, normal  # noqa: E402


def errors(run, corpus):
    out = {}
    for line in run.read_text().splitlines():
        record = json.loads(line)
        if "id" in record:
            ref = normal(corpus[record["id"]]["ref"])
            _, s, d, i = align(ref, normal(record["final"]))
            out[record["id"]] = (s + d + i, len(ref))
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", required=True, type=pathlib.Path)
    parser.add_argument("baseline", type=pathlib.Path)
    parser.add_argument("others", nargs="+", type=pathlib.Path)
    args = parser.parse_args()
    corpus = {e["id"]: e for e in map(json.loads, (args.corpus / "manifest.jsonl").read_text().splitlines()) if e}
    base = errors(args.baseline, corpus)
    words = sum(n for _, n in base.values())
    print(f"baseline {args.baseline.stem}: {len(base)} utterances, {words} reference words")
    rng = random.Random(20261009)
    for other in args.others:
        theirs = errors(other, corpus)
        ids = sorted(set(base) & set(theirs))
        diffs = []
        for _ in range(2000):
            sample = [rng.choice(ids) for _ in ids]
            n = sum(base[i][1] for i in sample)
            diffs.append(100 * (sum(theirs[i][0] for i in sample) - sum(base[i][0] for i in sample)) / n)
        diffs.sort()
        point = 100 * (sum(theirs[i][0] for i in ids) - sum(base[i][0] for i in ids)) / sum(base[i][1] for i in ids)
        print(f"{other.stem:22} {point:+6.2f} points  95% [{diffs[50]:+.2f}, {diffs[1949]:+.2f}]  over {len(ids)} utterances")
    return 0


if __name__ == "__main__":
    sys.exit(main())
