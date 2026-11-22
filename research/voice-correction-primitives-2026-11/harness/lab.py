"""Lab-only access to VOCO's pinned recognizer through the pause study's
wrapper: more than one open stream, and word times, which the worker's
protocol doesn't offer. Set VOCO_LAB_CONTEXT before importing (6 is VOCO's)."""
import os, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
os.environ.setdefault('VOCO_LAB_RUNTIME', str(ROOT / 'runtime/speech'))
os.environ.setdefault('VOCO_LAB_CONTEXT', '6')
os.environ.setdefault('NEMO_SPEECH_CPU_THREADS', '4')
sys.path.insert(0, str(ROOT / 'research/pause-sentence-ends-2026-10/harness'))
import asr  # noqa: E402

RATE, PACKET = 16000, 1600
LAB = Path(os.environ['VOCO_CORRECTION_LAB'])


def load(relative):
    return asr.load_flac(LAB / 'LibriSpeech' / relative)


def feed(stream, audio):
    """Push audio in 100 ms packets, as the worker gets it; the text so far."""
    text = stream.last
    for offset in range(0, len(audio), PACKET):
        stream.push(audio[offset:offset + PACKET]); text = stream.drain()
    return text
