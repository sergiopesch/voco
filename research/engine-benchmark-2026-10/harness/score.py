#!/usr/bin/env python3
"""TEST ONLY: score benchmark runs.

  score.py --corpus DIR --align parakeet-offline.jsonl --out summary.json RUN.jsonl...

Accuracy: corpus WER after NFKC and whisper-normalizer 0.1.12's English
normalizer, overall and per set; punctuation error rate (NeMo's PER over
`. , ?`) and the capitalisation error rate of matched words, against the
punctuated references.

Live behaviour, by replaying each run's measured compute times on a real-time
clock (packet k arrives at (k+1) x 100 ms; a call starts when its packet has
arrived and the previous call finished):
  word delay     when a word first shows in its final spelling, minus when it
                 was spoken (its end in the Parakeet offline alignment)
  stop to final  from the end of the audio to the final text
  backlog        how far calls fell behind the audio; VOCO bounds it at 3 s
  revisions      utterances whose pasteable text changed earlier text
"""
import argparse
import json
import pathlib
import re
import statistics
import sys
import unicodedata

from whisper_normalizer.english import EnglishTextNormalizer

PACKET_S = 0.1
NORMALIZE = EnglishTextNormalizer()
MARKS = ".,?"
MARK_SET = set(MARKS)


def normal(text):
    text = unicodedata.normalize("NFKC", text).replace("’", "'").replace("‘", "'")
    return NORMALIZE(text).split()


def align(ref, hyp, same=lambda a, b: a == b):
    """Levenshtein alignment: [(ref_index | None, hyp_index | None)] plus S, D, I."""
    n, m = len(ref), len(hyp)
    cost = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        cost[i][0] = i
    for j in range(1, m + 1):
        cost[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost[i][j] = min(cost[i - 1][j - 1] + (0 if same(ref[i - 1], hyp[j - 1]) else 1),
                             cost[i - 1][j] + 1, cost[i][j - 1] + 1)
    pairs, i, j, s, d, ins = [], n, m, 0, 0, 0
    while i or j:
        if i and j and cost[i][j] == cost[i - 1][j - 1] + (0 if same(ref[i - 1], hyp[j - 1]) else 1):
            s += 0 if same(ref[i - 1], hyp[j - 1]) else 1
            pairs.append((i - 1, j - 1))
            i, j = i - 1, j - 1
        elif i and cost[i][j] == cost[i - 1][j] + 1:
            d += 1
            pairs.append((i - 1, None))
            i -= 1
        else:
            ins += 1
            pairs.append((None, j - 1))
            j -= 1
    return pairs[::-1], s, d, ins


def tokens_pc(text):
    return re.findall(rf"[\w']+|[{re.escape(MARKS)}]", unicodedata.normalize("NFKC", text).replace("’", "'"))


def punctuation(ref, hyp):
    """NeMo punct_er: align with marks masked, then count marks."""
    r, h = tokens_pc(ref), tokens_pc(hyp)
    key = lambda t: "\0" if t in MARK_SET else t.lower()  # noqa: E731
    pairs, *_ = align([key(t) for t in r], [key(t) for t in h])
    counts = dict(correct=0, substituted=0, deleted=0, inserted=0)
    for i, j in pairs:
        rt, ht = (r[i] if i is not None else None), (h[j] if j is not None else None)
        if rt in MARK_SET and ht in MARK_SET:
            counts["correct" if rt == ht else "substituted"] += 1
        elif rt in MARK_SET:
            counts["deleted"] += 1
        elif ht in MARK_SET:
            counts["inserted"] += 1
    return counts


def capitalisation(ref, hyp):
    r = [t for t in tokens_pc(ref) if t not in MARK_SET]
    h = [t for t in tokens_pc(hyp) if t not in MARK_SET]
    pairs, *_ = align([t.lower() for t in r], [t.lower() for t in h])
    matched = wrong = initial = initial_wrong = 0
    starts = {0}
    flat = tokens_pc(ref)
    position = 0
    for index, token in enumerate(flat):
        if token in MARK_SET:
            if token in ".?":
                starts.add(position)
        else:
            position += 1
    for i, j in pairs:
        if i is not None and j is not None and r[i].lower() == h[j].lower():
            matched += 1
            bad = r[i] != h[j]
            wrong += bad
            if i in starts:
                initial += 1
                initial_wrong += bad
    return dict(matched=matched, wrong=wrong, initial=initial, initialWrong=initial_wrong)


def replay(record):
    """Simulated real-time end times of each call, and the final."""
    seconds = record["seconds"]
    end = 0.0
    history = []
    worst = 0.0
    for step in record["steps"]:
        k, ms = step[0], step[1]
        arrival = min((k + 1) * PACKET_S, seconds)
        start = max(arrival, end)
        end = start + ms / 1000
        worst = max(worst, end - arrival)
        if len(step) > 2:
            history.append((end, step[2]))
    final_at = max(seconds, end) + record["endMs"] / 1000
    history.append((final_at, record["final"]))
    return history, final_at, worst


def word_key(word):
    return re.sub(r"[^\w']", "", word.lower())


def appearance(history):
    final = history[-1][1].split()
    seen = [None] * len(final)
    for at, text in history:
        words = text.split()
        for i, word in enumerate(words[:len(final)]):
            if seen[i] is None and word == final[i]:
                seen[i] = at
    return final, seen


def percentile(values, q):
    if not values:
        return None
    values = sorted(values)
    return round(values[min(len(values) - 1, int(q * len(values)))], 3)


def score(run, corpus, alignment):
    lines = [json.loads(line) for line in run.read_text().splitlines() if line]
    header = lines[0]["header"]
    footer = next((line["footer"] for line in lines if "footer" in line), {})
    records = [line for line in lines if "id" in line]
    by_set, totals = {}, dict(errors=0, words=0)
    per = dict(correct=0, substituted=0, deleted=0, inserted=0)
    cap = dict(matched=0, wrong=0, initial=0, initialWrong=0)
    delays, first_delays, stops, backlogs, compute, audio = [], [], [], [], 0.0, 0.0
    revised = over_bound = 0
    per_step = []
    for record in records:
        entry = corpus[record["id"]]
        ref, hyp = normal(entry["ref"]), normal(record["final"])
        _, s, d, i = align(ref, hyp)
        item = by_set.setdefault(record["set"], dict(errors=0, words=0, utterances=0))
        item["errors"] += s + d + i
        item["words"] += len(ref)
        item["utterances"] += 1
        totals["errors"] += s + d + i
        totals["words"] += len(ref)
        if entry.get("ref_pc"):
            for key, value in punctuation(entry["ref_pc"], record["final"]).items():
                per[key] += value
            for key, value in capitalisation(entry["ref_pc"], record["final"]).items():
                cap[key] += value
        history, final_at, worst = replay(record)
        stops.append(final_at - record["seconds"])
        backlogs.append(worst)
        over_bound += worst > 3.0
        revised += record["violations"] > 0
        compute += sum(step[1] for step in record["steps"]) / 1000 + record["endMs"] / 1000
        audio += record["seconds"]
        per_step += [step[1] for step in record["steps"]]
        reference = alignment.get(record["id"])
        if reference:
            final, seen = appearance(history)
            pairs, *_ = align([word_key(w[2]) for w in reference], [word_key(w) for w in final])
            first = None
            for ri, hi in pairs:
                if ri is not None and hi is not None and word_key(reference[ri][2]) == word_key(final[hi]) \
                        and seen[hi] is not None:
                    delay = seen[hi] - reference[ri][1]
                    delays.append(delay)
                    if first is None:
                        first = delay
            if first is not None:
                first_delays.append(first)
    marks = sum(per.values())
    return {
        "config": header["config"], "kind": header["kind"], "model": header["model"],
        "options": header["options"], "threads": header["threads"], "paced": header["paced"],
        "cpu": header["cpu"], "utterances": len(records), "expected": header["utterances"],
        "audioMinutes": round(audio / 60, 1),
        "wer": round(100 * totals["errors"] / max(1, totals["words"]), 2),
        "werBySet": {k: round(100 * v["errors"] / max(1, v["words"]), 2) for k, v in sorted(by_set.items())},
        "per": round(100 * (per["substituted"] + per["deleted"] + per["inserted"]) / max(1, marks), 1),
        "punctuation": per,
        "capitalisationErrorRate": round(100 * cap["wrong"] / max(1, cap["matched"]), 1),
        "sentenceStartCapErrorRate": round(100 * cap["initialWrong"] / max(1, cap["initial"]), 1),
        "wordDelayS": {"p50": percentile(delays, 0.5), "p90": percentile(delays, 0.9), "words": len(delays)},
        "firstWordDelayS": {"p50": percentile(first_delays, 0.5), "p90": percentile(first_delays, 0.9)},
        "stopToFinalS": {"p50": percentile(stops, 0.5), "p90": percentile(stops, 0.9), "max": percentile(stops, 1.0)},
        "backlogS": {"p50": percentile(backlogs, 0.5), "max": percentile(backlogs, 1.0), "over3s": over_bound},
        "computePerAudio": round(compute / max(audio, 1e-9), 3),
        "callMs": {"p50": percentile(per_step, 0.5), "p95": percentile(per_step, 0.95), "max": percentile(per_step, 1.0)},
        "revisedUtterances": revised,
        "loadMs": header["loadMs"], "peakRssMb": footer.get("peakRssMb"),
    }


def paced_check(run):
    """For a --paced run: replayed times against the measured wall clock."""
    records = [json.loads(line) for line in run.read_text().splitlines() if line]
    records = [r for r in records if "id" in r]
    gaps, final_gaps = [], []
    for record in records:
        history, final_at, _ = replay(record)
        measured = [step[3] / 1000 for step in record["steps"] if len(step) > 3]
        gaps += [abs(a - b) for (a, _), b in zip(history[:-1], measured)]
        final_gaps.append(abs(final_at - record["wallMs"] / 1000))
    return {"utterances": len(records), "textSteps": len(gaps),
            "absGapS": {"p50": percentile(gaps, 0.5), "p90": percentile(gaps, 0.9), "max": percentile(gaps, 1.0)},
            "finalAbsGapS": {"p50": percentile(final_gaps, 0.5), "max": percentile(final_gaps, 1.0)}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("runs", nargs="*", type=pathlib.Path)
    parser.add_argument("--corpus", type=pathlib.Path)
    parser.add_argument("--align", type=pathlib.Path, help="parakeet-offline run with word times")
    parser.add_argument("--out", type=pathlib.Path)
    parser.add_argument("--paced-check", type=pathlib.Path, help="a --paced run to compare with its replay")
    args = parser.parse_args()
    if args.paced_check:
        print(json.dumps(paced_check(args.paced_check)))
        return 0
    corpus = {e["id"]: e for e in map(json.loads, (args.corpus / "manifest.jsonl").read_text().splitlines()) if e}
    alignment = {}
    if args.align:
        for line in args.align.read_text().splitlines():
            record = json.loads(line)
            if "words" in record:
                alignment[record["id"]] = record["words"]
    results = [score(run, corpus, alignment) for run in args.runs]
    if args.out:
        args.out.write_text(json.dumps(results, indent=1) + "\n")
    print(f"{'config':22} {'WER':>6} {'PER':>5} {'Cap':>5} {'delay p50/p90 s':>16} {'stop p50 s':>10} "
          f"{'backlog max':>11} {'CPU/audio':>9} {'revised':>7}")
    for r in results:
        delay = f"{r['wordDelayS']['p50']}/{r['wordDelayS']['p90']}"
        print(f"{r['config']:22} {r['wer']:>6} {r['per']:>5} {r['capitalisationErrorRate']:>5} {delay:>16} "
              f"{r['stopToFinalS']['p50']!s:>10} {r['backlogS']['max']!s:>11} {r['computePerAudio']:>9} "
              f"{r['revisedUtterances']:>7}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
