#!/usr/bin/env python3
"""Check this record against itself (PREREGISTRATION.md, Checks of the record).

  verify.py                 everything that needs neither recognizer nor audio
  verify.py --recognize 40  also recognize that many recorded sessions again,
                            drawn by seed, and compare their text; run with
                            /usr/bin/python3, VOCO_CORRECTION_LAB and a
                            provisioned runtime/speech

Prints one line for each check and exits with a failure when one fails.
"""
import argparse, hashlib, importlib.util, json, os, random, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
RECORD = HERE.parent
RESULTS = RECORD / 'results'
FIELD = RECORD / 'field'
FIRST = RECORD.parent / 'voice-correction-2026-11'
SECOND = RECORD.parent / 'voice-correction-primitives-2026-11'
SEED = 20261123
failed = []


def check(name, ok, detail=''):
    print(f"{'ok  ' if ok else 'FAIL'} {name}{' — ' + detail if detail else ''}", flush=True)
    if not ok:
        failed.append(name)


def script(name, *args):
    subprocess.run([sys.executable, str(HERE / name), *map(str, args)], check=True, stdout=subprocess.DEVNULL, cwd=HERE)


def same(a, b):
    return Path(a).read_bytes() == Path(b).read_bytes()


def tables(scratch):
    """Every table and summary, computed again from the recorded runs."""
    script('trials.py', RESULTS / 'items.json', RESULTS / 'runs.jsonl', scratch / 'trials.json')
    check('trials built again from the items and the passages', same(scratch / 'trials.json', RESULTS / 'trials.json'))
    script('score.py', RESULTS / 'trials.json', RESULTS / 'runs.jsonl', RESULTS / 'lean.jsonl', scratch)
    for name in ('own-summary.json', 'own-tables.txt'):
        check(f'{name} computed again from the runs', same(scratch / name, RESULTS / name))
    script('said.py', 'score', RESULTS / 'said-trials.json', RESULTS / 'said-runs.jsonl', scratch)
    for name in ('said-summary.json', 'said-tables.txt'):
        check(f'{name} computed again from the runs', same(scratch / name, RESULTS / name))


def chain(scratch):
    """The chain's trial files built again, and each field run tied to its file."""
    script('chain.py', RESULTS / 'trials.json', RESULTS / 'runs.jsonl', RESULTS / 'lean.jsonl', scratch / 'chain')
    check('chain.json built again from the runs and the rule', same(scratch / 'chain' / 'chain.json', RESULTS / 'chain' / 'chain.json'))
    drawn = json.loads((RESULTS / 'chain' / 'chain.json').read_text())['drawn']
    files = [entry for entry in drawn if entry['change']]
    check(f'{len(files)} trial files built again, byte for byte',
          all(same(scratch / 'chain' / entry['file'], RESULTS / 'chain' / entry['file']) for entry in files))
    check('each trial file has the SHA-256 chain.json names',
          all(hashlib.sha256((RESULTS / 'chain' / entry['file']).read_bytes()).hexdigest() == entry['sha256'] for entry in files))
    script('score_chain.py', RESULTS / 'chain' / 'chain.json', FIELD / 'results' / 'runs', scratch)
    for name in ('chain-summary.json', 'chain-tables.txt'):
        check(f'{name} computed again from the field runs', same(scratch / name, RESULTS / name))
    by_hash = {entry['sha256']: entry for entry in files}
    runs = [json.loads(path.read_text()) for path in sorted((FIELD / 'results' / 'runs').glob('*.trial-*.json'))]
    check(f'{len(runs)} chain runs in the field each name a trial file of chain.json by its SHA-256',
          bool(runs) and all(run.get('trial_sha256') in by_hash for run in runs))


def field(scratch):
    """Every field run classified again from its raw reads."""
    work = scratch / 'field'
    subprocess.run(['cp', '-a', str(FIELD / 'harness'), str(work)], check=True)
    (work / 'results').mkdir(exist_ok=True)
    for path in (FIELD / 'results' / 'runs').glob('*.json'):
        (work / 'results' / path.name).write_bytes(path.read_bytes())
    subprocess.run(['/usr/bin/python3.12', 'summarize.py'], check=True, cwd=work, stdout=subprocess.DEVNULL)
    for name in ('summary.json', 'summary.md'):
        check(f'field {name} computed again from the runs', same(work / 'results' / name, FIELD / 'results' / name))


def rules():
    """Rules 1 and 2 here decide as the second study's did, on every trial it recorded."""
    sys.path.insert(0, str(HERE))
    import rules as new
    spec = importlib.util.spec_from_file_location('second_rules', SECOND / 'harness' / 'rules.py')
    sys.path.insert(0, str(SECOND / 'harness')); old = importlib.util.module_from_spec(spec); spec.loader.exec_module(old)
    from text import words
    pairs = []
    said = {(r['arm'], r['id']): r['text'] for r in map(json.loads, (SECOND / 'results' / 'said-runs.jsonl').read_text().splitlines())}
    for trial in json.loads((SECOND / 'results' / 'said-trials.json').read_text())['trials']:
        for kind in ('far', 'near'):
            typed = list(trial['typed']); typed[trial['target']] = trial[kind]
            pairs += [(typed, words(said['C', trial['clip']])), (typed, words(said[kind, trial['id']]))]
        pairs.append((trial['typed'], words(said['C', trial['clip']])))
    own = {(r['arm'], r['id']): r['text'] for r in map(json.loads, (FIRST / 'results' / 'runs.jsonl').read_text().splitlines())}
    lean = {(r['arm'], r['id']): r['text'] for r in map(json.loads, (SECOND / 'results' / 'lean-test.jsonl').read_text().splitlines())}
    for trial in json.loads((SECOND / 'results' / 'own-trials.json').read_text())['trials']:
        for kind in ('far', 'near'):
            typed = list(trial['typed']); typed[trial['target']] = trial[kind]
            pairs.append((typed, words(own['S', trial['id']])))
            if (kind, trial['id']) in lean:
                pairs.append((typed, words(lean[kind, trial['id']])))
        pairs.append((trial['typed'], words(own['S', trial['id']])))
    windows = [(typed[-new.WINDOW:], heard) for typed, heard in pairs]
    check(f"rule 1 decides as the second study's on {len(windows)} recorded trials", all(new.rule1(w, h) == old.rule1(w, h) for w, h in windows))
    check(f"rule 2 decides as the second study's on {len(windows)} recorded trials", all(new.rule2(w, h) == old.rule2(w, h) for w, h in windows))
    differ = sum(new.rule3(w, h) != new.rule2(w, h) for w, h in windows)
    check('rule 3 differs from rule 2 only by refusing', all(new.rule3(w, h) in (None, new.rule2(w, h)) for w, h in windows), f'refuses {differ} of rule 2\'s changes there')


def recognize(count):
    """Recorded sessions through the worker again: the same text?"""
    sys.path.insert(0, str(HERE))
    import run, lean
    items = {item['id']: item for item in json.loads((RESULTS / 'items.json').read_text())['items']}
    recorded = [json.loads(line) for name in ('runs.jsonl', 'lean.jsonl') for line in (RESULTS / name).read_text().splitlines()]
    drawn = random.Random(SEED).sample(recorded, count)
    worker = run.Worker()
    agree = 0
    for record in drawn:
        item = items[record['id']]
        if record['arm'] == 'P':
            again = run.passage(worker, item)
            agree += all(again[key] == record[key] for key in ('text', 'tap', 'timeline', 'revised', 'audioSha256'))
        elif record['arm'] == 'S':
            again = run.alone(worker, item)
            agree += again['text'] == record['text'] and again['audioSha256'] == record['audioSha256']
        else:
            agree += lean.recognize(worker, 'V-' + record['id'], run.load(item['audio']), record['words']) == record['text']
    worker.child.stdin.close(); worker.child.wait(timeout=60)
    kinds = {arm: sum(r['arm'] == arm for r in drawn) for arm in ('P', 'S', 'L')}
    check(f'{count} sessions drawn by seed recognized again with the same text, audio and pushes', agree == count, f'{agree}/{count}; {kinds}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--recognize', type=int, default=0)
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as folder:
        scratch = Path(folder)
        rules()
        tables(scratch)
        chain(scratch)
        field(scratch)
    if args.recognize:
        recognize(args.recognize)
    print(f"{len(failed)} failed" if failed else 'all checks passed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
