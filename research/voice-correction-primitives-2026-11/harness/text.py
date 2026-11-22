"""Word normalisation and alignment, as the pause study's harness defines them."""
import re


def norm(word):
    return re.sub(r"[^\w']", '', word.lower()).strip("'")


def words(text):
    """A text's normalized words, with those that normalize to nothing dropped."""
    return [w for w in map(norm, text.split()) if w]


def distance(a, b):
    """Edit distance between two sequences."""
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        previous, row[0] = row[0], i
        for j, y in enumerate(b, 1):
            previous, row[j] = row[j], min(row[j] + 1, row[j - 1] + 1, previous + (x != y))
    return row[-1]


def align(ref, hyp):
    """For each ref index, the hyp index it aligns to and 'ok' or 'sub', or (None, 'del')."""
    n, m = len(ref), len(hyp)
    d = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1): d[i][0] = i
    for j in range(m + 1): d[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i][j] = min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (ref[i-1] != hyp[j-1]))
    i, j, out = n, m, [None] * n
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i][j] == d[i-1][j-1] + (ref[i-1] != hyp[j-1]):
            out[i-1] = (j-1, 'ok' if ref[i-1] == hyp[j-1] else 'sub'); i -= 1; j -= 1
        elif i > 0 and d[i][j] == d[i-1][j] + 1:
            out[i-1] = (None, 'del'); i -= 1
        else:
            j -= 1
    return out
