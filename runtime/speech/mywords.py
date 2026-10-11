"""My words: the user's names and terms, written the way they are listed.

The recognizer leans toward the listed phrases, and restore() writes each
occurrence of a listed term in its listed spelling. It compares words without
case or accents and joins words the recognizer split, so "git hub" becomes
GitHub, "G T K" GTK and "zoe" Zoë. A sentence start keeps its capital, and a
possessive 's stays.

Delivery is append-only, so a push holds back a tail that later text could
still turn into a listed term: "New" waits for "Zealand", and the open last
word waits while it could grow into one. Finish writes the whole final text,
which extends every push. Spelling never converts a listed occurrence.
"""
import re
import unicodedata

MAX_TERMS = 100
MAX_WORDS = 4
MAX_CHARS = 40
# How many recognized words one listed term may span, for spelled-out letters.
MAX_SPAN = 8
# The recognizer's boost for listed phrases: on development data the strongest
# that added no wrong words or capitals, and the one the My words gates passed.
BOOST = 0.5
# A word: letters and digits, with apostrophes inside it.
SPELLED = re.compile(r"[^\W_]+(?:['’][^\W_]+)*")
# A listed term: words separated by single spaces, hyphens or full stops.
TERM = re.compile(r"[^\W_]+(?:['’][^\W_]+)*(?:(?:[ -]|\. ?)[^\W_]+(?:['’][^\W_]+)*)*\.?")
JOINABLE = re.compile(r'[ \t-]+')
SENTENCE_START = re.compile(r'(?:^|[.?!…]\s+)$')


def plain(text):
    """Without case or accents."""
    return ''.join(c for c in unicodedata.normalize('NFKD', text) if not unicodedata.combining(c)).casefold()


def key(term):
    return ''.join(plain(word) for word in SPELLED.findall(term))


def accepted(terms):
    """The usable entries of the desktop's list, in order.

    The desktop checks the same rules when saving. An entry that slips past
    them, a hand-edited config for example, is skipped rather than failing
    dictation, and so is a later duplicate or anything beyond MAX_TERMS.
    """
    if not isinstance(terms, list) or not all(isinstance(term, str) for term in terms):
        raise ValueError('words')
    usable, keys = [], set()
    for term in terms:
        term = unicodedata.normalize('NFC', term)
        if (len(usable) < MAX_TERMS and 1 <= len(term) <= MAX_CHARS and TERM.fullmatch(term)
                and len(SPELLED.findall(term)) <= MAX_WORDS and key(term) not in keys):
            usable.append(term)
            keys.add(key(term))
    return usable


class Words:
    def __init__(self, terms):
        self.terms = accepted(terms)
        self.skipped = len(terms) - len(self.terms)
        self.spellings = {key(term): term for term in self.terms}
        self.prefixes = {k[:end] for k in self.spellings for end in range(1, len(k) + 1)}
        self.longest = max(map(len, self.spellings), default=0)

    def phrases(self):
        """What the recognizer boosts: each term as listed."""
        return list(self.terms)

    def restore(self, text, final):
        """(text with listed terms as listed, their spans in it, the end of what is settled).

        Before the returned end, no later hypothesis can change the text.
        """
        if not self.spellings:
            return text, [], len(text)
        spans = [match.span() for match in SPELLED.finditer(text)]
        out, protected, written, last, i = [], [], 0, 0, 0
        while i < len(spans):
            if not final and self.open_from(text, spans, i):
                out.append(text[last:spans[i][0]])
                written += spans[i][0] - last
                return ''.join(out), protected, written
            for count in range(min(MAX_SPAN, len(spans) - i), 0, -1):
                group = spans[i:i + count]
                if not all(JOINABLE.fullmatch(text[a[1]:b[0]]) for a, b in zip(group, group[1:])):
                    continue
                joined, suffix = ''.join(plain(text[s:e]) for s, e in group), ''
                if joined not in self.spellings and re.search(r"['’]s$", text[group[-1][0]:group[-1][1]]):
                    joined, suffix = joined[:-2], text[group[-1][1] - 2:group[-1][1]]
                spelling = self.spellings.get(joined)
                if spelling is None:
                    continue
                start = group[0][0]
                if spelling[:1].islower() and SENTENCE_START.search(text[:start]):
                    spelling = spelling[:1].upper() + spelling[1:]
                out.append(text[last:start])
                written += start - last
                protected.append((written, written + len(spelling)))
                out.append(spelling + suffix)
                written += len(spelling) + len(suffix)
                last, i = group[-1][1], i + count
                break
            else:
                i += 1
        out.append(text[last:])
        restored = ''.join(out)
        return restored, protected, len(restored)

    def open_from(self, text, spans, index):
        """Whether the words from index to the end could still become a listed term."""
        group = spans[index:]
        if len(group) > MAX_SPAN or text[group[-1][1]:].strip(' \t-'):
            return False
        if not all(JOINABLE.fullmatch(text[a[1]:b[0]]) for a, b in zip(group, group[1:])):
            return False
        joined = ''.join(plain(text[s:e]) for s, e in group)
        return len(joined) <= self.longest and joined in self.prefixes
