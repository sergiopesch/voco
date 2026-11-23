"""Rule 3: rule 2 of the second study, and a check before its change is made.

A rule takes the typed window and the heard words, both normalized, and returns
the new window or None for no change. Run this file to check its cases.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from text import distance  # noqa: E402

WINDOW = 30


def close(a, b):
    """Whether two words are the same or nearly spelled alike: one letter apart
    from four letters, two from eight."""
    longest = max(len(a), len(b))
    return a == b or (longest >= 4 and distance(a, b) <= (2 if longest >= 8 else 1))


def candidates(window, heard, same, tolerance=1):
    """{(p, q): cost} for every place whose ends match the heard words' ends."""
    interior = heard[1:-1]
    found = {}
    for p, first in enumerate(window):
        if not same(first, heard[0]):
            continue
        for q in range(p + 1, len(window)):
            if same(window[q], heard[-1]) and abs((q - p - 1) - len(interior)) <= tolerance:
                found[p, q] = distance(window[p + 1:q], interior)
    return found


def place(window, heard, found):
    """The single cheapest place (p, q), when its cost is at least 1 and at most
    half the interior, rounded up; else None."""
    interior = heard[1:-1]
    lowest = min(found.values())
    best = [span for span, cost in found.items() if cost == lowest]
    if len(best) != 1 or not 1 <= lowest <= (len(interior) + 1) // 2:
        return None
    return best[0]


def steps(fuzzy=True, trim=1):
    """Rule 2's steps in order: (heard words dropped at the start, at the end, matcher)."""
    order = [(0, 0, str.__eq__)]
    if fuzzy:
        order.append((0, 0, close))
    drops = [(i, j) for total in range(1, 2 * trim + 1) for i in range(trim + 1) for j in range(trim + 1) if i + j == total]
    order += [(i, j, str.__eq__) for i, j in drops]
    if fuzzy:
        order += [(i, j, close) for i, j in drops]
    return order


def decide(window, heard):
    """Rule 2's decision as (p, q, i, j, step) or None: rule 1 first, and only
    when its ends are found nowhere, ends nearly spelled alike, then one heard
    word dropped from either end, then both. The first step that finds a place
    decides, change or not. The change replaces the typed words strictly
    between p and q with heard[i + 1:len(heard) - j - 1]."""
    for step, (i, j, same) in enumerate(steps()):
        part = heard[i:len(heard) - j]
        if len(part) < 3:
            continue
        found = candidates(window, part, same)
        if found:
            spot = place(window, part, found)
            return spot and (*spot, i, j, step)
    return None


def apply(window, heard, decision):
    p, q, i, j, _ = decision
    return window[:p + 1] + heard[i + 1:len(heard) - j - 1] + window[q:]


def rule1(window, heard):
    """Anchor rule 1: both ends exact."""
    if len(heard) < 3:
        return None
    found = candidates(window, heard, str.__eq__)
    spot = place(window, heard, found) if found else None
    return spot and window[:spot[0] + 1] + heard[1:-1] + window[spot[1]:]


def rule2(window, heard):
    decision = decide(window, heard)
    return decision and apply(window, heard, decision)


def fits(window, heard):
    """For each end position e, the least word edit distance between all the
    heard words and a run of window words ending just before e, and where the
    cheapest such run starts (Sellers' approximate matching)."""
    cost = [0] * (len(window) + 1)
    start = list(range(len(window) + 1))
    for row, word in enumerate(heard, 1):
        diagonal, diagonal_start = cost[0], start[0]
        cost[0] = row
        for column in range(1, len(window) + 1):
            options = ((diagonal + (window[column - 1] != word), diagonal_start),   # the two words paired
                       (cost[column] + 1, start[column]),                            # a heard word with no typed word
                       (cost[column - 1] + 1, start[column - 1]))                    # a typed word with no heard word
            diagonal, diagonal_start = cost[column], start[column]
            cost[column], start[column] = min(options)
    return cost, start


def elsewhere(window, heard, p, q):
    """How well all the heard words fit the place (p, q) and the best place that
    shares no word with it: (cost here, cost elsewhere)."""
    cost, start = fits(window, heard)
    here = min((cost[e] for e in range(q + 1, len(window) + 1) if start[e] <= p), default=len(heard))
    away = min((cost[e] for e in range(1, len(window) + 1) if e <= p or start[e] > q), default=len(heard))
    return here, away


MARGIN = 1


def checked(window, heard):
    """Rule 3's decision, as decide gives it, or None: rule 2, and before its
    change is made, a check of the place. All the heard words, with none dropped
    and no end word excused, must fit the chosen place better by MARGIN than any
    run of typed words that shares no word with it. Rule 1's own decisions, both
    end words found exactly, are not checked."""
    decision = decide(window, heard)
    if decision is None:
        return None
    p, q, _, _, step = decision
    if step:
        here, away = elsewhere(window, heard, p, q)
        if away - here < MARGIN:
            return None
    return decision


def rule3(window, heard):
    decision = checked(window, heard)
    return decision and apply(window, heard, decision)


if __name__ == '__main__':
    typed = "let's meet at the peer on thursday afternoon".split()
    fixed = "let's meet at the pier on thursday afternoon".split()
    for rule in (rule2, rule3):
        assert rule1(typed, "at the pier on".split()) == rule(typed, "at the pier on".split()) == fixed
        assert rule(typed, "at the pier on thursdays".split()) == fixed          # a nearly alike end
        assert rule(typed, "eat the pier on thursday".split()) == fixed          # a garbled first word dropped
        assert rule(typed, "at the peer on".split()) is None                     # already says so: no later step
        assert rule(typed, "red the pier in".split()) is None
    # The second study's collateral change: the recognizer heard another row's
    # number, and with that word dropped the rest fitted the earlier row.
    rows = "sixteenth row seamed make one at the beginning seventeenth how make one knit three".split()
    heard = "nineteenth row make one".split()
    assert rule2(rows, heard) == "sixteenth row make one at the beginning seventeenth how make one knit three".split()
    assert rule3(rows, heard) is None
    print('rules: ok')
