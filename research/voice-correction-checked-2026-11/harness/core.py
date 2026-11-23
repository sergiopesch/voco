"""What the trial builder, the leaned sessions and the scorers share: the typed
text at a moment of a dictation, the planted word, the list a correction leans
toward, and a trial's outcome."""
import re
from rules import WINDOW
from text import words

AFTER = (0, 4, 8)            # words typed after the phrase, in turn over the items
DELAYS = (0, 0.4, 0.8, 1.2)  # seconds of the next utterance heard before the decision
EDGE = re.compile(r"^([^\w']*)(.*?)([^\w']*)$", re.S)


def tokens(text):
    """The text's tokens that hold a word, as (start, end) character places."""
    return [match.span() for match in re.finditer(r'\S+', text) if words(match.group())]


def surface(text):
    """Those tokens without the punctuation around them."""
    return [EDGE.match(text[a:b]).group(2) for a, b in tokens(text)]


def length_at(run, seconds):
    """How much of the passage's final text the pushes had returned once
    `seconds` of audio were sent; all of it when the audio ends first."""
    if seconds >= run['seconds'] - 1e-6:
        return len(run['text'])
    return max([length for at, length in run['timeline'] if at <= seconds + 1e-6], default=0)


def typed_at(run, delay):
    """The text typed when the decision is made: `delay` seconds into the next
    utterance, or None for the whole passage."""
    return run['text'] if delay is None else run['text'][:length_at(run, run['tap'] + delay)]


def planted(typed, trial, kind):
    """The typed words with the trial's word planted, where that word is typed yet."""
    typed = list(typed)
    if kind in ('far', 'near') and trial['target'] < len(typed):
        typed[trial['target']] = trial[kind]
    return typed


def listed(shown):
    """The My words list a correction leans toward: the window's words, once
    each, as typed."""
    seen, unique = set(), []
    for term in shown[-WINDOW:]:
        if term.casefold() not in seen:
            seen.add(term.casefold()); unique.append(term)
    return unique[:100]


def change(before, after):
    """(a, b, new): the words before[a:b] became `new`."""
    a = 0
    while a < min(len(before), len(after)) and before[a] == after[a]:
        a += 1
    tail = 0
    while tail < min(len(before), len(after)) - a and before[-1 - tail] == after[-1 - tail]:
        tail += 1
    return a, len(before) - tail, after[a:len(after) - tail]


def decided(rule, typed, heard):
    """The rule's change to the typed words, from their last WINDOW words, as
    (a, b, new) in the typed words' places, or None."""
    offset = max(0, len(typed) - WINDOW)
    result = rule(typed[offset:], heard)
    if result is None:
        return None
    a, b, new = change(typed[offset:], result)
    return offset + a, offset + b, new


def outcome(document, wanted, made, first, last, control):
    """A trial's outcome from the whole dictation's words after the change:
    right, none, contained (wrong only between the phrase's end words) or
    collateral. `first` is None where no place should change."""
    if made is None:
        return 'right' if control else 'none'
    if document == wanted:
        return 'right'
    if first is None:
        return 'collateral'
    inside = document[:first + 1] == wanted[:first + 1] and document[len(document) - (len(wanted) - last):] == wanted[last:]
    return 'contained' if inside else 'collateral'


def judge(rule, typed, document, wanted, heard, first, last, control):
    """Decide on the words typed so far, make the change in the whole
    dictation's words, of which `typed` is the start, and name the outcome. The
    last typed word may be the start of a longer one: a push can end inside a
    word."""
    made = decided(rule, typed, heard)
    if made is not None:
        document = document[:made[0]] + made[2] + document[made[1]:]
    return outcome(document, wanted, made, first, last, control), made
