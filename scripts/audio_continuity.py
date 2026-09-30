"""Synthetic PCM helpers: read a 16 kHz mono fixture and check a capture for lost audio."""
if not __debug__:
    raise SystemExit("Capture continuity checks require assertions; unset PYTHONOPTIMIZE and do not use python -O.")

import array
import math
import wave


def pcm16(path):
    with wave.open(str(path), 'rb') as wav:
        assert (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) == (1, 2, 16000)
        values = array.array('h', wav.readframes(wav.getnframes()))
    return values


def capture_continuity(reference, captured):
    """Locate complete public PCM, then check independent quarters for lost audio."""
    assert len(captured) >= len(reference), 'Captured audio shorter than fixture'
    def correlation(offset, start=0, end=None, stride=16):
        end = len(reference) if end is None else end
        pairs = [(reference[i], captured[offset + i]) for i in range(start, end, stride)]
        energy_a = sum(a * a for a, _ in pairs)
        energy_b = sum(b * b for _, b in pairs)
        if not energy_a or not energy_b:
            return 0.0
        return sum(a * b for a, b in pairs) / math.sqrt(energy_a * energy_b)
    last = len(captured) - len(reference)
    # A coarse energy envelope tolerates sample phase; one refined global
    # waveform alignment is then shared by every quarter (no local realignment).
    reference_energy = [sum(v * v for v in reference[i:i + 64]) for i in range(0, len(reference) - 63, 64)]
    captured_energy = [sum(v * v for v in captured[i:i + 64]) for i in range(0, len(captured) - 63, 64)]
    def envelope(offset):
        values = captured_energy[offset:offset + len(reference_energy)]
        norm = math.sqrt(sum(v * v for v in reference_energy) * sum(v * v for v in values))
        return sum(a * b for a, b in zip(reference_energy, values)) / norm if norm else 0.0
    coarse = max(range(last // 64 + 1), key=envelope) * 64
    offset = max(range(max(0, coarse - 128), min(last, coarse + 128) + 1), key=correlation)
    quarters = [correlation(offset, len(reference) * i // 4, len(reference) * (i + 1) // 4, 4) for i in range(4)]
    quarter_rms = [math.sqrt(sum(v * v for v in reference[len(reference) * i // 4:len(reference) * (i + 1) // 4]) / (len(reference) * (i + 1) // 4 - len(reference) * i // 4)) / 32768 for i in range(4)]
    active = [i for i, rms in enumerate(quarter_rms) if rms >= .005]
    assert active, 'Fixture has no speech-energy quarters'
    result = {'referenceSamples': len(reference), 'capturedSamples': len(captured),
              'offsetSamples': offset, 'quarterCorrelations': quarters,
              'minimumQuarterCorrelation': 0.90, 'quarterReferenceRms': quarter_rms,
              'scoredQuarters': active, 'minimumReferenceRms': .005, 'wholeFixtureCorrelation': correlation(offset, stride=4),
              'referenceDurationSeconds': len(reference) / 16000, 'capturedDurationSeconds': len(captured) / 16000}
    result['passed'] = min(quarters[i] for i in active) >= .90 and result['wholeFixtureCorrelation'] >= .90
    return result
