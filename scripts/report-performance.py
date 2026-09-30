#!/usr/bin/env python3
"""Summarize local VOCO performance metadata; never score unmeasured quality."""
import argparse
from collections import Counter, defaultdict
import json
import math
import os
from pathlib import Path


def distribution(values):
    values = sorted(v for v in values if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) and v >= 0)
    if not values:
        return {"count": 0, "p50": None, "p95": None, "max": None}
    return {"count": len(values), "p50": round(values[math.ceil(.5 * len(values)) - 1], 3),
            "p95": round(values[math.ceil(.95 * len(values)) - 1], 3), "max": round(values[-1], 3)}


def nonnegative(value):
    if type(value) is int:
        return 0 <= value <= 2**64 - 1
    return type(value) is float and math.isfinite(value) and 0 <= value <= 2**64 - 1


def validate_entry(row):
    """Reject unusable payloads as well as bad envelopes; never echo their content."""
    def require(ok):
        if not ok:
            raise ValueError('Invalid performance record')
    require(isinstance(row, dict))
    require(type(row.get('schema')) is int and row['schema'] == 1)
    for key in ('run_id', 'event'):
        require(isinstance(row.get(key), str) and bool(row[key]))
    for key in ('seq', 't_us'):
        require(type(row.get(key)) is int and nonnegative(row[key]) and row[key] >= (1 if key == 'seq' else 0))
    for key in ('dropped_events', 'writer_observed_us', 'dictation_session_id'):
        if row.get(key) is not None:
            require(type(row[key]) is int and nonnegative(row[key]))
    event = row['event']
    if event == 'lifecycle':
        require(isinstance(row.get('name'), str) and bool(row['name']))
        if 'duration_ms' in row:
            require(nonnegative(row['duration_ms']))
    if event == 'resource_sample':
        require(type(row.get('available')) is bool)
        if row['available']:
            require(all(nonnegative(row.get(k)) for k in ('cpu_us', 'peak_rss_kib')))
            for key in ('major_page_faults', 'voluntary_context_switches', 'involuntary_context_switches'):
                if key in row:
                    require(nonnegative(row[key]))
    return row


def session_summary(key, events):
    counts = Counter(e['name'] for e in events)
    def duration(name):
        values = [e['duration_ms'] for e in events if e['name'] == name and 'duration_ms' in e]
        return values[-1] if values else None
    return {
        'frontend_epoch': key[0], 'session_id': key[1],
        'start_observed': any(e['name'] == 'recording_state_requested' for e in events),
        'recording_ms': duration('dictation_recording_duration'),
        # Generic paste has no editor acknowledgement. Keep dispatch separate from visibility.
        'first_desktop_phrase_dispatch_ms': duration('dictation_desktop_first_phrase_dispatched'),
        'desktop_stream_flush_ms': duration('dictation_desktop_stream_flush_completed'),
        'paste_stages_ms': {stage: distribution([e['duration_ms'] for e in events
            if e['name'] == name and 'duration_ms' in e]) for stage, name in (
                ('preflight', 'dictation_desktop_paste_preflight_completed'),
                ('modifier_wait', 'dictation_desktop_modifier_wait_completed'),
                ('clipboard_write', 'dictation_desktop_clipboard_write_completed'),
                ('keyboard_dispatch', 'dictation_desktop_keyboard_dispatch_completed'))},
        'paste_dispatch_ms': distribution([e['duration_ms'] for e in events
            if e['name'] == 'dictation_desktop_paste_dispatched' and 'duration_ms' in e]),
        'stop_to_final_ms': duration('dictation_stop_to_final_transcript'),
        'stop_to_idle_ms': duration('dictation_stop_to_idle'),
        # Recognition completion alone says nothing about the destination.
        # These are observations, not an inferred delivery result for missing logs.
        'delivery_observations': {
            'desktop_paste_session': bool(counts['dictation_desktop_paste_session_started']),
            'desktop_paste_unavailable': bool(counts['dictation_desktop_paste_unavailable']),
            'desktop_stream_session': bool(counts['dictation_desktop_stream_started']),
            'desktop_paste_dispatch_count': counts['dictation_desktop_paste_dispatched'],
            'desktop_paste_deferred_count': counts['dictation_desktop_paste_deferred'],
            'desktop_phrases_queued': counts['dictation_desktop_phrase_queued'],
            'desktop_live_prefix_dispatch_count': counts['dictation_desktop_live_prefix_dispatched'],
            'desktop_prefix_revisions': counts['dictation_desktop_snapshot_revised'],
            'desktop_stream_failed': bool(counts['dictation_desktop_stream_failed']),
            'desktop_paste_dispatched': bool(counts['dictation_desktop_paste_dispatched']),
            'desktop_remainder_copied': bool(counts['dictation_desktop_remainder_copied']),
            'desktop_remainder_kept_in_review': bool(counts['dictation_desktop_remainder_kept']),
            'recovery_retained': bool(counts['dictation_recovery_retained']),
        },
        'event_counts': dict(counts),
    }


def summarize(entries, run_id=None, malformed=0):
    valid = []
    for entry in entries:
        try:
            valid.append(validate_entry(entry))
        except ValueError:
            malformed += 1
    entries = valid
    runs = list(dict.fromkeys(e['run_id'] for e in entries))
    selected = run_id or (runs[-1] if runs else None)
    rows = [e for e in entries if e['run_id'] == selected]
    if not rows:
        raise ValueError("No performance records for the requested run")
    unique = {}
    for row in rows:
        unique.setdefault(row['seq'], row)
    duplicates = len(rows) - len(unique)
    rows = sorted(unique.values(), key=lambda e: e['seq'])
    # Rotation can remove a prefix; gaps and unavailable headers remain explicit.
    metadata = next((e for e in rows if e['event'] == 'run_metadata'), None)
    lifecycle = [e for e in rows if e['event'] == 'lifecycle']
    timings = defaultdict(list)
    audio_durations = defaultdict(list)
    sessions = defaultdict(list)
    epoch = 0
    for event in lifecycle:
        if event['name'] == 'frontend_app_mounted':
            epoch += 1
        if 'duration_ms' in event:
            destination = audio_durations if event['name'] in {'dictation_audio_teardown_completed', 'dictation_audio_prepared'} else timings
            destination[event['name']].append(event['duration_ms'])
        if event.get('dictation_session_id') is not None:
            sessions[(epoch, event['dictation_session_id'])].append(event)
    startup, teardown, prepared = [], [], []
    for events in sessions.values():
        requested = next((e for e in events if e['name'] == 'recording_state_requested'), None)
        active = next((e for e in events if e['name'] == 'recording_state_active'), None)
        if requested and active and active['t_us'] >= requested['t_us']:
            startup.append((active['t_us'] - requested['t_us']) / 1000)
        stopped = next((e for e in events if e['name'] == 'dictation_recording_stopped'), None)
        for name, target in [('dictation_audio_teardown_completed', teardown), ('dictation_audio_prepared', prepared)]:
            finished = next((e for e in events if e['name'] == name), None)
            if stopped and finished and finished['t_us'] >= stopped['t_us']:
                target.append((finished['t_us'] - stopped['t_us']) / 1000)
    resources = [e for e in rows if e['event'] == 'resource_sample' and e.get('available')]
    cpu_percent = []
    for before, after in zip(resources, resources[1:]):
        elapsed = after['t_us'] - before['t_us']
        used = after['cpu_us'] - before['cpu_us']
        if elapsed > 0 and used >= 0:
            cpu_percent.append(100 * used / elapsed)
    sequence = sorted(e['seq'] for e in rows)
    missing = sum(max(0, b - a - 1) for a, b in zip(sequence, sequence[1:]))
    flags = []
    if malformed or duplicates or missing or metadata is None or sequence[0] != 1 or any(e.get('dropped_events', 0) for e in rows):
        flags.append('incomplete_or_invalid_log_evidence')
    if any(e['name'] in {'dictation_desktop_paste_unavailable', 'dictation_desktop_stream_failed',
                         'dictation_desktop_remainder_copied', 'dictation_desktop_remainder_kept'}
           for e in lifecycle):
        flags.append('desktop_paste_failure_requires_review')
    if any(e['name'] == 'dictation_desktop_paste_dispatched' for e in lifecycle):
        flags.append('desktop_paste_dispatch_needs_target_verification')
    if not any(e['name'] == 'recording_state_active' for e in lifecycle):
        flags.append('no_active_recording_observed')
    return {
        'review_flags': flags,
        'recordings': [session_summary(key, events) for key, events in sessions.items()
                       if any(e['name'] in {'recording_state_requested', 'recording_state_active',
                                           'dictation_recording_stopped', 'dictation_stop_to_final_transcript'} for e in events)],
        'writer_queue_delay_ms': distribution([(e['writer_observed_us'] - e['t_us']) / 1000
                                              for e in rows if e.get('writer_observed_us', -1) >= e['t_us']]),
        'run_id': selected, 'available_run_ids': runs, 'metadata': metadata,
        'evidence': {'records': len(rows), 'malformed_lines': malformed, 'duplicate_records_ignored': duplicates,
                     'malformed_scope': 'all supplied files; invalid records may have no usable run ID',
                     'prefix_missing': metadata is None or sequence[0] != 1,
                     'sequence_gaps': missing, 'dropped_events': max(e.get('dropped_events', 0) for e in rows),
                     'clean_exit_requested_observed': any(e['event'] == 'clean_exit_requested' for e in rows)},
        'lifecycle_counts': dict(Counter(e['name'] for e in lifecycle)),
        'lifecycle_duration_ms': {k: distribution(v) for k, v in timings.items()},
        'audio_duration_ms': {k: distribution(v) for k, v in audio_durations.items()},
        'recording_request_to_active_backend_observed_ms': distribution(startup),
        'stop_to_teardown_backend_observed_ms': distribution(teardown),
        'stop_to_prepared_backend_observed_ms': distribution(prepared),
        'backend_resources': {
            'samples': len(resources),
            'unavailable_samples': sum(e['event'] == 'resource_sample' and not e.get('available') for e in rows),
            'cpu_seconds_at_last_sample': resources[-1]['cpu_us'] / 1_000_000 if resources else None,
            'last_sample_at_ms': resources[-1]['t_us'] / 1000 if resources else None,
            'observed_span_ms': (resources[-1]['t_us'] - resources[0]['t_us']) / 1000 if len(resources) >= 2 else None,
            'counter_deltas_between_samples': {
                key: (resources[-1][key] - resources[0][key]) if len(resources) >= 2
                     and key in resources[0] and key in resources[-1] and resources[-1][key] >= resources[0][key] else None
                for key in ('major_page_faults', 'voluntary_context_switches', 'involuntary_context_switches')}, 'cpu_percent_one_core_100': distribution(cpu_percent),
                              'peak_rss_mib': max((e['peak_rss_kib'] / 1024 for e in resources), default=None)},
        'limits': [
            'Delivery fields describe observed events only; false means not observed. A copied remainder or a dictation kept in Review can follow a deliberate focus change, so delivery flags require comparison with the intended target, not automatic failure.',
            'Backend process resources exclude WebKit, browser and other helper processes; RSS is a lifetime high-water mark.',
            'CPU total is cumulative only through the last resource sample; work after it is unmeasured. Counter deltas cover only the sampled span.',
            'Absent timings are unavailable, not zero.',
            'No review flags is not a test pass: accuracy and expected delivery outcomes need independent assertions.',
            'Lifecycle times are frontend-reported durations or backend receipt times, not physical keyboard/acoustic/display latency.',
            'Missing completion/exit markers can mean active work, abrupt termination, queue loss or rotation; they do not prove a crash.',
            'Accuracy, omitted/repeated words, audio fidelity, whole-app battery use and perceived quality require separate observations/reference tests.',
            'Percentiles retain sample counts; a small sample is not stable-release qualification.',
        ],
    }


def read_entries(paths):
    entries, malformed = [], 0
    for path in paths:
        for line in path.read_text().splitlines():
            try:
                row = json.loads(line)
                entries.append(validate_entry(row))
            except (ValueError, TypeError):
                malformed += 1
    return entries, malformed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', nargs='?', type=Path, default=Path(os.environ.get('XDG_STATE_HOME', str(Path.home() / '.local/state'))) / 'voco/performance')
    parser.add_argument('--run', help='Run ID; defaults to the latest observed run')
    parser.add_argument('--json', action='store_true', help='Print the complete machine-readable report')
    args = parser.parse_args()
    paths = [p for name in ('performance.previous.jsonl', 'performance.jsonl') if (p := args.directory / name).is_file()]
    if not paths:
        parser.error('No performance logs found. Start VOCO with VOCO_PERFORMANCE_LOG=1 to record them.')
    entries, malformed = read_entries(paths)
    try:
        report = summarize(entries, args.run, malformed)
    except (ValueError, KeyError, TypeError) as error:
        parser.error(str(error))
    if args.json:
        print(json.dumps(report, indent=2, allow_nan=False))
        return
    print('VOCO laptop performance report')
    print(f"Run: {report['run_id']}")
    print('Evidence:', json.dumps(report['evidence']))
    print('Review flags:', json.dumps(report['review_flags']))
    print('Per-recording timings:', json.dumps(report['recordings'], indent=2))
    print('Writer queue delay (ms):', json.dumps(report['writer_queue_delay_ms']))
    print('\nRecording request → active (backend observed ms):', json.dumps(report['recording_request_to_active_backend_observed_ms']))
    print('Stop → teardown / prepared (backend observed ms):', json.dumps({'teardown':report['stop_to_teardown_backend_observed_ms'], 'prepared':report['stop_to_prepared_backend_observed_ms']}))
    print('Captured/prepared audio durations (not processing time, ms):', json.dumps(report['audio_duration_ms']))
    print('Lifecycle durations (ms):', json.dumps(report['lifecycle_duration_ms'], indent=2))
    print('Lifecycle event counts:', json.dumps(report['lifecycle_counts'], indent=2))
    print('Backend resources:', json.dumps(report['backend_resources'], indent=2))
    print('\nInterpretation limits:')
    for limit in report['limits']:
        print('- ' + limit)


if __name__ == '__main__':
    main()
