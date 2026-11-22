"""The first study's anchor rule and the variants explored on dev.

Every rule takes the typed window and the heard words, both normalized, and
returns the new window or None for no change. Run this file to check them.
"""
from text import distance

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


def decide(window, heard, found):
    """The change for one set of candidates: the single cheapest place, when
    its cost is at least 1 and at most half the interior, rounded up."""
    interior = heard[1:-1]
    lowest = min(found.values())
    best = [span for span, cost in found.items() if cost == lowest]
    if len(best) != 1 or not 1 <= lowest <= (len(interior) + 1) // 2:
        return None
    p, q = best[0]
    return window[:p + 1] + interior + window[q:]


def rule1(window, heard):
    """Anchor rule 1: both ends exact."""
    if len(heard) < 3:
        return None
    found = candidates(window, heard, str.__eq__)
    return decide(window, heard, found) if found else None


def rule2(window, heard, fuzzy=True, trim=1):
    """Rule 1 first. Only when its ends are found nowhere: ends that are nearly
    spelled alike, then up to `trim` heard words dropped from either end, then
    both. The typed end words always stay as typed. The first step that finds a
    place decides, change or not."""
    steps = [(0, 0, str.__eq__)]
    if fuzzy:
        steps.append((0, 0, close))
    drops = [(i, j) for total in range(1, 2 * trim + 1) for i in range(trim + 1) for j in range(trim + 1) if i + j == total]
    steps += [(i, j, str.__eq__) for i, j in drops]
    if fuzzy:
        steps += [(i, j, close) for i, j in drops]
    for i, j, same in steps:
        part = heard[i:len(heard) - j]
        if len(part) < 3:
            continue
        found = candidates(window, part, same)
        if found:
            return decide(window, part, found)
    return None


if __name__ == '__main__':
    typed = "let's meet at the peer on thursday afternoon".split()
    fixed = "let's meet at the pier on thursday afternoon".split()
    assert rule1(typed, "at the pier on".split()) == fixed
    assert rule2(typed, "at the pier on".split()) == fixed
    assert rule1(typed, "the pier in".split()) is None
    assert rule2(typed, "at the pier on thursdays".split()) == fixed          # a nearly alike end
    assert rule2(typed, "eat the pier on thursday".split()) == fixed          # a garbled first word dropped
    assert rule2(typed, "at the peer on".split()) is None                     # already says so: no later step
    assert rule2(typed, "red the pier in".split()) is None
    print('rules: ok')
