"""Word normalisation and alignment shared by the builder and the scorer, which
needs neither the recognizer nor the audio."""
import re
import numpy as np
def norm(w): return re.sub(r"[^\w']", '', w.lower()).strip("'")
def align(ref, hyp):
    """Edit-distance alignment; returns for each ref index the hyp index (or None) and op."""
    n, m = len(ref), len(hyp); d = np.zeros((n + 1, m + 1), np.int32); d[:, 0] = range(n + 1); d[0, :] = range(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            d[i, j] = min(d[i-1, j] + 1, d[i, j-1] + 1, d[i-1, j-1] + (ref[i-1] != hyp[j-1]))
    i, j, out = n, m, [None] * n
    while i > 0 or j > 0:
        if i > 0 and j > 0 and d[i, j] == d[i-1, j-1] + (ref[i-1] != hyp[j-1]):
            out[i-1] = (j-1, 'ok' if ref[i-1] == hyp[j-1] else 'sub'); i -= 1; j -= 1
        elif i > 0 and d[i, j] == d[i-1, j] + 1: out[i-1] = (None, 'del'); i -= 1
        else: j -= 1
    return out
