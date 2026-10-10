"""British or American spelling for the whole hypothesis; spelling only.

The table holds VarCon's unambiguous forms (scripts/generate-spelling-table.py),
so words whose spelling depends on meaning, such as "program" and "check",
never change. A converted word keeps its case. Names stay as recognized: a
capitalized word converts only when it starts a sentence and the next word is
lowercase. Words touching digits, other letters or code symbols stay too.

Delivery is append-only, so a push returns only text that can no longer
change: the open last word goes out up to the first letter where a table word
that starts with it is spelled differently ("recogni" waits for its "z"), and
a capitalized first word waits from that letter for the next word. Finish
converts the final text, which always extends what a push returned.
"""
from pathlib import Path
import re

MODES = ('as-recognised', 'british', 'american')
TABLE = Path(__file__).resolve().parent / 'spelling-varcon.tsv'
WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)*")
# A neighbour that marks code, a number or a word in another script.
CODE = frozenset('_/\\=@#$%&*+<>[]{}|~^`')
SENTENCE_END = frozenset('.?!')
FIRST_PERSON = ('I', "I'm", "I'll", "I've", "I'd")


def first_difference(recognised, written):
    for index, (left, right) in enumerate(zip(recognised, written)):
        if left != right:
            return index
    return min(len(recognised), len(written))


def joined(text, index):
    """Whether the character at index makes a word beside it code or a number."""
    if not 0 <= index < len(text):
        return False
    return text[index] in CODE or text[index].isalnum()


def uniform(token):
    """Lowercase, Title or ALL CAPS; mixed case such as camelCase never converts."""
    return token.islower() or token.isupper() or token[1:].islower()


def cased(token, written):
    if token.islower():
        return written
    if token.isupper():
        return written.upper()
    return written[0].upper() + written[1:]


def sentence_start(text, start):
    index = start - 1
    while index >= 0 and text[index].isspace():
        index -= 1
    return index < 0 or text[index] in SENTENCE_END


class Converter:
    def __init__(self, mode, words):
        self.mode = mode
        self.words = words
        # For every prefix of a table word, how many letters all the table
        # words that start with it keep when converted.
        self.safe = {}
        for word, written in words.items():
            keep = first_difference(word, written)
            for end in range(1, len(word) + 1):
                prefix = word[:end]
                self.safe[prefix] = min(self.safe.get(prefix, keep), keep)

    def stable(self, text):
        """The longest start of the converted text that later text can't change."""
        return self.render(text, final=False) if self.words else text

    def final(self, text):
        return self.render(text, final=True) if self.words else text

    def render(self, text, final):
        output = []
        position = 0
        tokens = list(WORD.finditer(text))
        # A word reaching this index, perhaps before an apostrophe that may
        # still join it, is open.
        tail = len(text) + 1 if final else len(text.rstrip("'"))
        for index, match in enumerate(tokens):
            start, end = match.span()
            token = match[0]
            if joined(text, start - 1) or text[start - 1:start] in ('-', '.'):
                continue
            capitalized = not token[0].islower()
            if capitalized and not sentence_start(text, start):
                continue  # a name, or the rest of one
            output.append(text[position:start])
            position = start
            if end >= tail:
                keep = self.keep(text[start:], token)
                if keep is not None and keep < len(text) - start:
                    output.append(text[start:start + keep])
                    return ''.join(output)
                continue
            written = self.words.get(token.lower())
            if written is None or joined(text, end) or not uniform(token):
                continue
            if capitalized:
                lowercase_next = self.next_word_is_lowercase(text, tokens, index + 1, tail, final)
                if lowercase_next is None:
                    output.append(token[:first_difference(token.lower(), written)])
                    return ''.join(output)
                if not lowercase_next:
                    continue
            output.append(cased(token, written))
            position = end
        output.append(text[position:])
        return ''.join(output)

    def keep(self, fragment, token):
        """How much of an open word is certain, or None when all of it is."""
        if not uniform(token):
            return None
        lower = fragment.lower()
        candidates = [self.safe[lower]] if lower in self.safe else []
        if fragment != token and token.lower() in self.words:
            # In "colors'" the apostrophe may close a complete word.
            candidates.append(first_difference(token.lower(), self.words[token.lower()]))
        return min(candidates) if candidates else None

    @staticmethod
    def next_word_is_lowercase(text, tokens, index, tail, final):
        """For a capitalized first word: True converts it, False keeps it as a
        name, and None waits for the next word."""
        end = tokens[index - 1].end()
        if index == len(tokens):
            ended = final or any(character in SENTENCE_END for character in text[end:])
            return True if ended else None
        match = tokens[index]
        if any(character in SENTENCE_END for character in text[end:match.start()]):
            return True
        word = match[0]
        if word[0].islower():
            return True
        if match.end() >= tail:
            # An open "I" may still become "I'm", or "Irene".
            rest = text[match.start():]
            return None if any(person.startswith(rest) for person in FIRST_PERSON) else False
        return word in FIRST_PERSON


class Spelling:
    """Every mode's converter, built once when the worker starts."""

    def __init__(self, path=TABLE):
        words = {mode: {} for mode in MODES}
        with open(path, encoding='utf-8') as table:
            for line in table:
                if line.startswith('#'):
                    continue
                mode, recognised, written = line.rstrip('\n').split('\t')
                words[mode][recognised] = written
        if not words['british'] or not words['american'] or words['as-recognised']:
            raise ValueError('spelling table')
        self.converters = {mode: Converter(mode, table) for mode, table in words.items()}

    def converter(self, mode):
        if mode not in MODES:
            raise ValueError('spelling')
        return self.converters[mode]
