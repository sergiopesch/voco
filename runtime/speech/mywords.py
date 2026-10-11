"""My words: the user's names and terms, written the way they are listed.

The recognizer leans toward the listed phrases, and restore() writes each
occurrence of a listed term in its listed spelling. It compares words without
case or accents and joins words the recognizer split, so "git hub" becomes
GitHub, "G T K" GTK and "zoe" Zoë. A sentence start keeps its capital, and a
possessive 's stays.

Delivery is append-only, so a push holds back a tail that later text could
still turn into a listed term: "New" waits for "Zealand", and the open last
word waits while it could grow into one. Full stops join words only into a
term listed with them ("St. Ives"), and a listed final one takes the place of
the one heard ("Acme Inc."). Finish writes the whole final text,
which extends every push. Spelling never converts a listed occurrence.
"""
import re
import unicodedata

MAX_TERMS = 100
MAX_WORDS = 4
MAX_CHARS = 40
# The recognizer's boost for listed phrases: on development data the strongest
# that added no wrong words or capitals, and the one the My words gates passed.
BOOST = 0.5
# A word: letters and digits, with apostrophes inside it.
SPELLED = re.compile(r"[^\W_]+(?:['’][^\W_]+)*")
# A listed term: words separated by single spaces, hyphens or full stops.
TERM = re.compile(r"[^\W_]+(?:['’][^\W_]+)*(?:(?:[ -]|\. ?)[^\W_]+(?:['’][^\W_]+)*)*\.?")
JOINABLE = re.compile(r'[ \t-]+')
# A full stop between words joins them only into a term listed with one.
DOTTED = re.compile(r'\.[ \t]*')
SENTENCE_START = re.compile(r'(?:^|[.?!…]\s+)$')


def plain(text):
    """Without case or accents, and with one apostrophe for both."""
    return ''.join(c for c in unicodedata.normalize('NFKD', text) if not unicodedata.combining(c)).casefold().replace('’', "'")


def key(term):
    return ''.join(plain(word) for word in SPELLED.findall(term))


def stops(term):
    """The places in a term's key where a full stop joins two of its words."""
    places, length, words = set(), 0, list(SPELLED.finditer(term))
    for word, following in zip(words, words[1:]):
        length += len(plain(word[0]))
        if '.' in term[word.end():following.start()]:
            places.add(length)
    return places


def accepted(terms):
    """The usable entries of the desktop's list, in order.

    The desktop checks the same rules when saving. An entry that slips past
    them, a hand-edited config for example, is skipped rather than failing
    dictation, and so is anything beyond MAX_TERMS.
    """
    if not isinstance(terms, list) or not all(isinstance(term, str) for term in terms):
        raise ValueError('words')
    usable = [unicodedata.normalize('NFC', term) for term in terms]
    return [term for term in usable if 1 <= len(term) <= MAX_CHARS and TERM.fullmatch(term)
            and len(SPELLED.findall(term)) <= MAX_WORDS][:MAX_TERMS]


class Words:
    def __init__(self, terms):
        self.terms = accepted(terms)
        # Settings saves no two entries that match alike; in a hand-edited
        # list, the first one's spelling is written.
        self.spellings = {}
        for term in self.terms:
            self.spellings.setdefault(key(term), term)
        # Where, in each term's key, a full stop joins two of its words.
        self.stops = {k: stops(term) for k, term in self.spellings.items()}
        self.dotted = any('.' in term for term in self.terms)
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
            found = self.match_at(text, spans, i)
            if found is None:
                i += 1
                continue
            spelling, count, end, suffix = found
            if spelling.endswith('.') and not suffix and text[end:end + 1] == '.':
                end += 1  # the listed full stop takes the place of the one heard
            start = spans[i][0]
            # An ordinary lower-case entry starts a sentence with a capital;
            # one such as iPhone keeps its own.
            if spelling.islower() and SENTENCE_START.search(text[:start]):
                spelling = spelling[:1].upper() + spelling[1:]
            out.append(text[last:start])
            written += start - last
            protected.append((written, written + len(spelling)))
            out.append(spelling + suffix)
            written += len(spelling) + len(suffix)
            last, i = end + len(suffix), i + count
        out.append(text[last:])
        restored = ''.join(out)
        return restored, protected, len(restored)

    def match_at(self, text, spans, index):
        """The longest listed term from the word at index: (spelling, words, end, suffix) or None.

        Words join across spaces and hyphens, and across full stops into a term
        listed with one, while they still begin a listed term.
        """
        best, joined, heard = None, '', set()
        for at in range(index, len(spans)):
            if at > index:
                separator = text[spans[at - 1][1]:spans[at][0]]
                if DOTTED.fullmatch(separator):
                    heard.add(len(joined))
                elif not JOINABLE.fullmatch(separator):
                    break
            word = text[spans[at][0]:spans[at][1]]
            folded = plain(word)
            # A possessive 's after a listed term stays as it was heard.
            possessed = joined + folded[:-2]
            if re.search(r"['’]s$", word) and possessed in self.spellings and heard <= self.stops[possessed]:
                best = (self.spellings[possessed], at - index + 1, spans[at][1] - 2, word[-2:])
            joined += folded
            # A full stop heard between words must be one the term is listed with.
            if joined in self.spellings and heard <= self.stops[joined]:
                best = (self.spellings[joined], at - index + 1, spans[at][1], '')
            if joined not in self.prefixes:
                break
        return best

    def open_from(self, text, spans, index):
        """Whether the words from index to the end could still become a listed term."""
        group = spans[index:]
        joins = (lambda s: JOINABLE.fullmatch(s) or DOTTED.fullmatch(s)) if self.dotted else JOINABLE.fullmatch
        rest = text[group[-1][1]:]
        # An apostrophe after the last word may still join it ("can'" becomes "can't").
        if len(group) > self.longest or (rest and not joins(rest) and rest not in ("'", "’")):
            return False
        if not all(joins(text[a[1]:b[0]]) for a, b in zip(group, group[1:])):
            return False
        joined = ''.join(plain(text[s:e]) for s, e in group)
        # A possessive on the open last word may not be the end of it.
        possessive = re.search(r"['’]s$", text[group[-1][0]:group[-1][1]]) and joined[:-2] in self.prefixes
        return bool(possessive) or (len(joined) <= self.longest and joined in self.prefixes)
