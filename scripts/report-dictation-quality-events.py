#!/usr/bin/env python3
"""Reconcile opt-in queue/dispatch metadata; never infer recipient consumption."""
import argparse
from collections import Counter, defaultdict
import json
import math
import os
from pathlib import Path
import re

MAX_LINE_BYTES = 1024 * 1024
MAX_RECORDS = 1_000_000
STAGES = {'hypothesis', 'delivery_requested', 'delivery_dispatched', 'delivery_failed', 'native_dispatch', 'terminal'}
NUMBERS = {'quality_seq', 'quality_dropped', 'hypothesis_seq', 'previous_hypothesis_seq',
           'committed_hypothesis_seq', 'delivery_seq', 'active_delivery_seq', 'failed_delivery_seq',
           'pending_delivery_count', 'hypothesis_count', 'delivery_count', 'dispatched_count',
           'captured_samples', 'enqueued_samples', 'responded_samples', 'buffered_samples',
           'sample_start', 'sample_end', 'sample_rate', 'capture_callback_count', 'coalesced_hypotheses'}
NUMBERS |= {f'{prefix}_{unit}' for prefix in ('recognized', 'previous', 'committed', 'target', 'suffix',
            'accepted', 'dispatched', 'input', 'payload', 'routed')
            for unit in ('utf8_bytes', 'unicode_scalars', 'utf16_units')}
DURATIONS = {'duration_ms', 'queue_age_ms', 'max_queue_age_ms', 'pending_age_ms', 'latest_age_ms'}
BOOLS = {'append_only', 'changed', 'finish_responded', 'accepted_equals_dispatched', 'leading_separator', 'terminal', 'clipboard_changed', 'context_separator'}
OUTCOMES = {'finished', 'incomplete', 'cancelled', 'failed', 'dispatched', 'rejected', 'no-mutation', 'uncertain'}


def uint(value):
    return type(value) is int and 0 <= value <= 2**64 - 1


def safe_quality(row):
    """Copy finite allowlisted metadata only; never echo arbitrary input fields."""
    if row.get('stage') not in STAGES or not re.fullmatch(r'[0-9a-f]{64}', str(row.get('stream_session_hash', ''))):
        raise ValueError('invalid quality identity')
    safe = {key: row[key] for key in ('stage', 'stream_session_hash')}
    for key in NUMBERS | DURATIONS | BOOLS:
        if key not in row:
            continue
        value = row[key]
        valid = (type(value) is bool if key in BOOLS else
                 type(value) in (int, float) and math.isfinite(value) and 0 <= value <= 86_400_000 if key in DURATIONS else uint(value))
        if not valid:
            raise ValueError('invalid quality value')
        safe[key] = value
    if 'outcome' in row:
        if row['outcome'] not in OUTCOMES:
            raise ValueError('invalid outcome')
        safe['outcome'] = row['outcome']
    return safe


def sequence_faults(values, first):
    counts = Counter(values)
    unique = sorted(counts)
    return {'duplicates': sum(n - 1 for n in counts.values()),
            'missing': (unique[0] - first if unique else 0) + sum(max(0, b - a - 1) for a, b in zip(unique, unique[1:]))}


def timing(events, key):
    values = sorted(e[key] for e in events if key in e)
    return {'count': len(values), 'p50_ms': values[(len(values) - 1) // 2] if values else None,
            'max_ms': values[-1] if values else None}


def stream_summary(events, envelope_incomplete):
    stages = {stage: [e for e in events if e['stage'] == stage] for stage in STAGES}
    reasons = set()
    if envelope_incomplete:
        reasons.add('input_records_incomplete')
    front = [e for e in events if e['stage'] != 'native_dispatch']
    if any('quality_seq' not in e or 'quality_dropped' not in e for e in front):
        reasons.add('quality_sequence_unavailable')
    faults = sequence_faults([e['quality_seq'] for e in front if 'quality_seq' in e], 0)
    if faults['duplicates'] or faults['missing']:
        reasons.add('quality_sequence_incomplete')
    drops = max((e.get('quality_dropped', 0) for e in front), default=0)
    if drops:
        reasons.add('quality_events_dropped')
    hypotheses = {e.get('hypothesis_seq'): e for e in stages['hypothesis']}
    if None in hypotheses or len(hypotheses) != len(stages['hypothesis']):
        reasons.add('hypothesis_identity_invalid')
    if any(e.get('previous_hypothesis_seq') != 0 and e.get('previous_hypothesis_seq') not in hypotheses for e in hypotheses.values()):
        reasons.add('previous_hypothesis_unavailable')
    if any(e.get('append_only') is False for e in hypotheses.values()):
        reasons.add('recognition_revision')
    by_stage = {}
    for stage in ('delivery_requested', 'delivery_dispatched', 'delivery_failed', 'native_dispatch'):
        by_stage[stage] = {e.get('delivery_seq'): e for e in stages[stage]}
        if None in by_stage[stage] or len(by_stage[stage]) != len(stages[stage]):
            reasons.add('delivery_identity_invalid')
    requested = by_stage['delivery_requested']
    dispatched = by_stage['delivery_dispatched']
    native = by_stage['native_dispatch']
    if sequence_faults([v for v in requested if v is not None], 1) != {'duplicates': 0, 'missing': 0}:
        reasons.add('delivery_sequence_incomplete')
    for delivery_id in set(requested) | set(dispatched) | set(native) | set(by_stage['delivery_failed']):
        request, dispatch, native_event = requested.get(delivery_id), dispatched.get(delivery_id), native.get(delivery_id)
        if not request or not dispatch or not native_event:
            reasons.add('delivery_correlation_incomplete')
            continue
        seq = request.get('hypothesis_seq')
        if seq not in hypotheses or seq != dispatch.get('hypothesis_seq') or seq != native_event.get('hypothesis_seq'):
            reasons.add('hypothesis_correlation_incomplete')
        if native_event.get('outcome') != 'dispatched':
            reasons.add('native_dispatch_not_successful')
        for unit in ('utf8_bytes', 'unicode_scalars', 'utf16_units'):
            hypothesis_length = hypotheses.get(seq, {}).get(f'recognized_{unit}')
            target = request.get(f'target_{unit}')
            committed = request.get(f'committed_{unit}')
            suffix = request.get(f'suffix_{unit}')
            if None in (hypothesis_length, target, committed, suffix) or target != hypothesis_length or committed + suffix != target or dispatch.get(f'committed_{unit}') != target:
                reasons.add('hypothesis_target_lengths_mismatch_or_unavailable')
            values = request.get(f'suffix_{unit}'), native_event.get(f'input_{unit}')
            if None in values or values[0] != values[1]:
                reasons.add('native_input_length_mismatch_or_unavailable')
        payload, routed = native_event.get('payload_utf8_bytes'), native_event.get('routed_utf8_bytes')
        split = native_event.get('leading_separator')
        if payload is None or routed is None or split is None or routed != payload + int(split):
            reasons.add('payload_transformation_unavailable_or_inconsistent')
        # The current terminal route replaces individual ASCII controls with an
        # ASCII space; it preserves byte length before leading-space splitting.
        if routed is None or native_event.get('input_utf8_bytes') is None or routed != native_event['input_utf8_bytes'] + int(native_event.get('context_separator', False)):
            reasons.add('routed_input_length_mismatch_or_unavailable')
    terminal = stages['terminal'][0] if len(stages['terminal']) == 1 else None
    if terminal is None:
        reasons.add('terminal_missing_or_duplicate')
    else:
        if terminal.get('hypothesis_seq') not in hypotheses and not (terminal.get('hypothesis_seq') == 0 and terminal.get('hypothesis_count') == 0 and not hypotheses):
            reasons.add('terminal_hypothesis_unavailable')
        if terminal.get('outcome') != 'finished' or terminal.get('finish_responded') is not True:
            reasons.add('session_not_finished')
        if terminal.get('pending_delivery_count') != 0 or terminal.get('active_delivery_seq') is not None:
            reasons.add('pending_delivery_unavailable_or_nonzero')
        if terminal.get('failed_delivery_seq') is not None or stages['delivery_failed']:
            reasons.add('delivery_failed')
        if terminal.get('delivery_count') != len(requested) or terminal.get('dispatched_count') != len(dispatched):
            reasons.add('terminal_delivery_counts_mismatch_or_unavailable')
        if terminal.get('hypothesis_count') != sum(e.get('changed') is True and e.get('append_only') is True for e in stages['hypothesis']):
            reasons.add('terminal_hypothesis_count_mismatch_or_unavailable')
        if terminal.get('accepted_equals_dispatched') is not True:
            reasons.add('accepted_dispatch_equality_unavailable_or_false')
        for unit in ('utf8_bytes', 'unicode_scalars', 'utf16_units'):
            accepted, delivered = terminal.get(f'accepted_{unit}'), terminal.get(f'dispatched_{unit}')
            if hypotheses and hypotheses.get(terminal.get('hypothesis_seq'), {}).get(f'recognized_{unit}') != accepted:
                reasons.add('terminal_hypothesis_lengths_mismatch_or_unavailable')
            suffixes = [requested[key].get(f'suffix_{unit}') for key in dispatched if key in requested]
            if accepted is None or delivered is None or None in suffixes or accepted != delivered or sum(suffixes) != delivered:
                reasons.add('terminal_text_lengths_mismatch_or_unavailable')
        samples = [terminal.get(key) for key in ('captured_samples', 'enqueued_samples', 'responded_samples')]
        if None in samples or len(set(samples)) != 1 or terminal.get('buffered_samples') != 0:
            reasons.add('queue_samples_mismatch_or_unavailable')
    return {'stream_session_hash': events[0]['stream_session_hash'],
            'status': 'incomplete' if reasons else 'reconciled_dispatch_metadata',
            'reasons': sorted(reasons), 'event_counts': {key: len(stages[key]) for key in sorted(STAGES)},
            'quality_sequence': faults, 'quality_dropped': drops,
            'terminal_outcome': terminal.get('outcome') if terminal else None,
            'timing_observations': {
                'frontend_queue_age': timing(stages['hypothesis'], 'queue_age_ms'),
                'frontend_pending_delivery_age': timing(stages['delivery_requested'], 'pending_age_ms'),
                'frontend_dispatch_duration': timing(stages['delivery_dispatched'], 'duration_ms'),
                'native_dispatch_duration': timing(stages['native_dispatch'], 'duration_ms')},
            'native_leading_separator_count': sum(e.get('leading_separator') is True for e in stages['native_dispatch']),
            'sample_observation_scope': 'queue_ingress',
            'destination_content_observation': 'unavailable'}


def summarize(paths):
    runs = defaultdict(lambda: {'seq': [], 'dropped': 0, 'header': False, 'streams': defaultdict(list)})
    malformed = records = 0
    truncated = False
    for path in paths:
        with Path(path).open('rb') as source:
            while True:
                line = source.readline(MAX_LINE_BYTES + 1)
                if not line:
                    break
                records += 1
                if records > MAX_RECORDS:
                    truncated = True
                    break
                if len(line) > MAX_LINE_BYTES:
                    malformed += 1
                    while line and not line.endswith(b'\n'):
                        line = source.readline(MAX_LINE_BYTES + 1)
                    continue
                try:
                    row = json.loads(line)
                    if not line.endswith(b'\n') or not isinstance(row, dict) or type(row.get('schema')) is not int or row.get('schema') != 1 or not uint(row.get('seq')) or row['seq'] < 1 or not uint(row.get('t_us')):
                        raise ValueError('invalid envelope')
                    run_id = row.get('run_id')
                    if not isinstance(run_id, str) or not re.fullmatch(r'[0-9]{1,24}-[0-9]{1,12}', run_id):
                        raise ValueError('invalid run identity')
                    if not uint(row.get('dropped_events')):
                        raise ValueError('invalid drop count')
                    run = runs[run_id]
                    run['seq'].append(row['seq'])
                    run['header'] |= row['seq'] == 1 and row.get('event') == 'run_metadata'
                    run['dropped'] = max(run['dropped'], row.get('dropped_events', 0))
                    if row.get('event') == 'speech_quality':
                        safe = safe_quality(row)
                        run['streams'][safe['stream_session_hash']].append(safe)
                except (ValueError, TypeError, UnicodeError, RecursionError, OverflowError):
                    malformed += 1
        if truncated:
            break
    output = []
    for index, run in enumerate(runs.values(), 1):
        faults = sequence_faults(run['seq'], 1)
        incomplete = bool(malformed or truncated or not run['header'] or run['dropped'] or faults['duplicates'] or faults['missing'])
        output.append({'run_index': index, 'record_sequence': faults, 'run_header_observed': run['header'], 'dropped_events': run['dropped'],
                       'streams': [stream_summary(events, incomplete) for events in run['streams'].values()]})
    streams = [stream for run in output for stream in run['streams']]
    return {'schema_version': 1, 'status': 'unavailable' if not streams else 'incomplete' if any(s['status'] == 'incomplete' for s in streams) else 'reconciled_dispatch_metadata',
            'records_read': min(records, MAX_RECORDS), 'malformed_records': malformed, 'input_truncated': truncated,
            'runs': output, 'destination_content_observation': 'unavailable',
            'limitation': 'Metadata reconciliation does not verify recipient consumption, field contents, capture hardware continuity, recognition accuracy, or paint.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('logs', nargs='+', help='Retained performance JSONL files, including adjacent rotations when available')
    parser.add_argument('--output', help='New report path; existing receipts are never overwritten')
    args = parser.parse_args()
    try:
        report = summarize(args.logs)
        rendered = json.dumps(report, indent=2, allow_nan=False) + '\n'
        if args.output:
            with os.fdopen(os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), 'w', encoding='utf-8') as destination:
                destination.write(rendered)
        else:
            print(rendered, end='')
    except OSError:
        parser.exit(2, 'Could not read logs or create the new report; check paths and existing output.\n')


if __name__ == '__main__':
    main()
