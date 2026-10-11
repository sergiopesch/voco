"""British or American spelling for the whole hypothesis; spelling only.

The table holds VarCon's unambiguous forms (scripts/generate-spelling-table.py),
so words whose spelling depends on meaning, such as "program" and "check",
never change. Only lowercase words convert: a capital can mark a name ("Honor
is speaking"), even at the start of a sentence, and mixed case such as
camelCase marks code. Words touching digits, other letters or code symbols
stay too.

Delivery is append-only, so a push returns only text that can no longer
change: the open last word goes out up to the first letter where a table word
that starts with it is spelled differently ("recogni" waits for its "z").
Finish converts the final text, which always extends what a push returned.
"""
from pathlib import Path
import re

MODES = ('as-recognised', 'british', 'american')
TABLE = Path(__file__).resolve().parent / 'spelling-varcon.tsv'
WORD = re.compile(r"[A-Za-z]+(?:'[A-Za-z]+)*")
# A neighbour that marks code, a number or a word in another script.
CODE = frozenset('_/\\=@#$%&*+<>[]{}|~^`')


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

    def stable(self, text, protected=()):
        """The longest start of the converted text that later text can't change.

        Words starting inside a protected span, My words' listed occurrences,
        stay as they are.
        """
        return self.render(text, False, protected) if self.words else text

    def final(self, text, protected=()):
        return self.render(text, True, protected) if self.words else text

    def render(self, text, final, protected=()):
        output = []
        position = 0
        # A word reaching this index, perhaps before an apostrophe that may
        # still join it, is open.
        tail = len(text) + 1 if final else len(text.rstrip("'"))
        for match in WORD.finditer(text):
            start, end = match.span()
            token = match[0]
            if (not token.islower() or joined(text, start - 1) or text[start - 1:start] in ('-', '.')
                    or any(low <= start < high for low, high in protected)):
                continue
            output.append(text[position:start])
            position = start
            if end >= tail:
                keep = self.keep(text[start:], token)
                if keep is not None and keep < len(text) - start:
                    output.append(text[start:start + keep])
                    return ''.join(output)
                continue
            written = self.words.get(token)
            if written is None or joined(text, end):
                continue
            output.append(written)
            position = end
        output.append(text[position:])
        return ''.join(output)

    def keep(self, fragment, token):
        """How much of an open word is certain, or None when all of it is."""
        candidates = [self.safe[fragment]] if fragment in self.safe else []
        if fragment != token and token in self.words:
            # In "colors'" the apostrophe may close a complete word.
            candidates.append(first_difference(token, self.words[token]))
        return min(candidates) if candidates else None


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
