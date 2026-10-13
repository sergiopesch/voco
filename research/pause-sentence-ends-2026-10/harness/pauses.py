"""The pause tracker and sentence cues this study evaluated; VOCO doesn't ship them.

A forced end of utterance (the library's nemo_speech_asr_stream_force_endpoint,
whose flush favours a full stop) was asked for after PAUSE_S of quiet, unless
the text so far ended in a comma, colon, semicolon or dash, or in one of
CONTINUES. run_policies.py passes the threshold and word sets of each policy.

Quiet means the audio itself, not a lack of new words: each 20 ms frame is
speech when it is more than SPEECH_DB above the noise floor, the quietest 60 ms
of the last five seconds. Two speech frames in a row end a pause.
"""
import collections
import re

import numpy as np

PAUSE_S = 1.2
SPEECH_DB = 9.
FRAME_S = .02
FLOOR_WINDOW_S = 5.
# Below this a frame is quiet whatever the floor: digital near-silence.
ABSOLUTE_QUIET_DB = -70.
# Speech an utterance needs before a pause after it counts.
MIN_SPEECH_S = .2
ONSET_FRAMES = 2

# Words that almost never end an English sentence: a pause after one is a pause
# to think.
CONTINUES = frozenset('''a an the and or but nor of to that which than my your his her its our
their this these those'''.split())
# A comma, colon, semicolon or dash the recognizer wrote: it expects more.
OPEN_PUNCTUATION = re.compile(r'[,;:\-–—]["”’)\]]*$')
LAST_WORD = re.compile(r"([^\W\d_]+(?:['’][^\W\d_]+)*)\W*$")


def sentence_open(text, continues=CONTINUES):
    """Whether the end of the text says its sentence goes on."""
    text = text.rstrip()
    if OPEN_PUNCTUATION.search(text):
        return True
    word = LAST_WORD.search(text)
    return word is not None and word[1].casefold() in continues


class PauseTracker:
    """How long the speaker has been quiet, from 20 ms frame energies."""

    def __init__(self, speech_db=SPEECH_DB):
        self.speech_db = speech_db
        self.rate = None
        self.carry = np.zeros(0, np.float32)
        self.recent = collections.deque(maxlen=3)
        self.minima = collections.deque()
        self.frames = 0
        self.onset = 0
        self.speech_s = 0.
        self.quiet_s = 0.

    def push(self, data, rate):
        """Account for new audio; returns how long the current pause has lasted."""
        if self.rate != rate:
            self.rate, self.carry = rate, np.zeros(0, np.float32)
        size = max(1, round(rate * FRAME_S))
        samples = np.concatenate([self.carry, np.asarray(data, np.float32)])
        count = len(samples) // size
        self.carry = samples[count * size:]
        if count:
            power = np.square(samples[:count * size].reshape(count, size), dtype=np.float64).mean(axis=1)
            for level in 10 * np.log10(power + 1e-12):
                self._frame(float(level))
        return self.quiet_s

    def _frame(self, level):
        # The floor is the minimum of the 60 ms average over FLOOR_WINDOW_S,
        # from a monotonic queue, so each frame costs O(1).
        self.recent.append(level)
        average = sum(self.recent) / len(self.recent)
        index = self.frames
        self.frames += 1
        while self.minima and self.minima[-1][1] >= average:
            self.minima.pop()
        self.minima.append((index, average))
        if self.minima[0][0] <= index - round(FLOOR_WINDOW_S / FRAME_S):
            self.minima.popleft()
        if level > ABSOLUTE_QUIET_DB and level > self.minima[0][1] + self.speech_db:
            self.onset += 1
            if self.onset == ONSET_FRAMES:
                self.quiet_s = 0.
                self.speech_s += FRAME_S * ONSET_FRAMES
            elif self.onset > ONSET_FRAMES:
                self.speech_s += FRAME_S
        else:
            self.onset = 0
            if self.speech_s >= MIN_SPEECH_S:
                self.quiet_s += FRAME_S

    def utterance_ended(self):
        """The next pause counts only after new speech."""
        self.speech_s = 0.
        self.quiet_s = 0.
