"""Anchor rule 1 of PREREGISTRATION.md: a pure function of the typed window and
the heard words, both normalized. Run this file to check it against its cases."""
from text import distance

WINDOW = 30


def correct(window, heard, tolerance=1):
    """The window with the words between the two anchors replaced, or None for
    no change. `tolerance` is how far the two interiors' lengths may differ."""
    if len(heard) < 3:
        return None
    interior = heard[1:-1]
    costs = {}
    for p, first in enumerate(window):
        if first != heard[0]:
            continue
        for q in range(p + 1, len(window)):
            if window[q] == heard[-1] and abs((q - p - 1) - len(interior)) <= tolerance:
                costs[p, q] = distance(window[p + 1:q], interior)
    if not costs:
        return None
    lowest = min(costs.values())
    best = [span for span, cost in costs.items() if cost == lowest]
    if len(best) != 1 or not 1 <= lowest <= (len(interior) + 1) // 2:
        return None
    p, q = best[0]
    return window[:p + 1] + interior + window[q:]


if __name__ == '__main__':
    typed = "let's meet at the peer on thursday afternoon".split()
    cases = [
        ("at the pier on", "let's meet at the pier on thursday afternoon"),   # one word replaced
        ("the pier on", "let's meet at the pier on thursday afternoon"),
        ("at the peer on", None),                                             # already says so
        ("the pier", None),                                                   # too short
        ("in the pier on", None),                                             # first anchor absent
        # Two edits among four interior words are within half; among two, they aren't.
        ("meet at the old pier on", "let's meet at the old pier on thursday afternoon"),
        ("the old pier on", None),
        ("at the on", "let's meet at the on thursday afternoon"),             # a word removed
    ]
    for heard, expected in cases:
        result = correct(typed, heard.split())
        assert (result and ' '.join(result)) == expected, (heard, result)
    # Two places fit equally well: no change.
    twice = "the red house and the red horse and".split()
    assert correct(twice, "the blue house and".split()) == "the blue house and the red horse and".split()
    assert correct("the red cat and the red cat and".split(), "the blue cat and".split()) is None
    print('rule: ok')
