import { scoreTranscript, words } from "./speech-score.mjs";

// Complementary diagnostic metrics. This does not change the existing WER gate.
const MAX_ALIGNMENT_CELLS = 2_000_000;
const MAX_CHARACTER_CELLS = 25_000_000;
const unavailable = (reason) => ({ status: "unavailable", reason });
const ratio = (count, total) => total === 0 ? null : count / total;
const key = (text) => text.normalize("NFKC").toLocaleLowerCase("en-US").replace(/[’‘]/gu, "'");

function edits(expected, actual) {
  let prefix = 0;
  while (prefix < Math.min(expected.length, actual.length) && expected[prefix] === actual[prefix]) prefix += 1;
  let endExpected = expected.length;
  let endActual = actual.length;
  while (endExpected > prefix && endActual > prefix && expected[endExpected - 1] === actual[endActual - 1]) {
    endExpected -= 1;
    endActual -= 1;
  }
  const a = expected.slice(prefix, endExpected);
  const b = actual.slice(prefix, endActual);
  if ((a.length + 1) * (b.length + 1) > MAX_CHARACTER_CELLS) return null;
  let prior = Uint32Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = new Uint32Array(b.length + 1);
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(prior[j] + 1, row[j - 1] + 1, prior[j - 1] + Number(a[i - 1] !== b[j - 1]));
    }
    prior = row;
  }
  return prior[b.length];
}

function characterScore(reference, hypothesis) {
  const expected = Array.from(reference);
  const actual = Array.from(hypothesis);
  const distance = edits(expected, actual);
  return {
    status: "available", exact: reference === hypothesis,
    referenceCodepoints: expected.length, hypothesisCodepoints: actual.length,
    editDistance: distance, cer: distance === null ? null : ratio(distance, expected.length),
    cerUnavailableReason: distance === null ? "bounded_character_alignment_limit" : expected.length === 0 ? "empty_reference" : null,
  };
}

function whitespaceSlots(text) {
  const characters = [];
  const slots = [""];
  for (const character of text) {
    if (/\s/u.test(character)) slots[slots.length - 1] += character;
    else { characters.push(character); slots.push(""); }
  }
  return { characters, slots };
}

function whitespaceScore(reference, hypothesis) {
  const expected = whitespaceSlots(reference);
  const actual = whitespaceSlots(hypothesis);
  // Character slots expose joined/split words without using a tokenizer that
  // would itself erase the boundary error. Changed nonspace text is excluded.
  if (expected.characters.join("") !== actual.characters.join("")) {
    return { ...unavailable("non_whitespace_text_differs"), eligibleSlots: 0,
      excludedReferenceSlots: expected.slots.length, excludedHypothesisSlots: actual.slots.length };
  }
  let mismatchedSlots = 0;
  let missingBoundaries = 0;
  let extraBoundaries = 0;
  let changedWhitespace = 0;
  let missingCodepoints = 0;
  let extraCodepoints = 0;
  expected.slots.forEach((slot, i) => {
    const other = actual.slots[i];
    if (slot === other) return;
    mismatchedSlots += 1;
    if (slot && !other) missingBoundaries += 1;
    else if (!slot && other) extraBoundaries += 1;
    else changedWhitespace += 1;
    missingCodepoints += Math.max(0, Array.from(slot).length - Array.from(other).length);
    extraCodepoints += Math.max(0, Array.from(other).length - Array.from(slot).length);
  });
  return { status: "available", eligibleSlots: expected.slots.length, excludedReferenceSlots: 0,
    excludedHypothesisSlots: 0, mismatchedSlots, missingBoundaries, extraBoundaries,
    changedWhitespace, missingCodepoints, extraCodepoints };
}

function tokenize(text) {
  const tokens = Array.from(text.matchAll(/[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’‘][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu));
  const gaps = [];
  let offset = 0;
  const result = tokens.map((match) => {
    gaps.push(text.slice(offset, match.index));
    offset = match.index + match[0].length;
    return { text: match[0], key: key(match[0]) };
  });
  gaps.push(text.slice(offset));
  return { tokens: result, gaps };
}

function stableMatches(expected, actual) {
  const n = expected.length;
  const m = actual.length;
  if ((n + 1) * (m + 1) > MAX_ALIGNMENT_CELLS) return null;
  const forward = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  const backward = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 0; i <= n; i += 1) forward[i][0] = i;
  for (let j = 0; j <= m; j += 1) forward[0][j] = j;
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      forward[i][j] = Math.min(forward[i - 1][j] + 1, forward[i][j - 1] + 1,
        forward[i - 1][j - 1] + Number(expected[i - 1].key !== actual[j - 1].key));
    }
  }
  for (let i = 0; i <= n; i += 1) backward[i][m] = n - i;
  for (let j = 0; j <= m; j += 1) backward[n][j] = m - j;
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      backward[i][j] = Math.min(backward[i + 1][j] + 1, backward[i][j + 1] + 1,
        backward[i + 1][j + 1] + Number(expected[i].key !== actual[j].key));
    }
  }
  const candidates = Array.from({ length: n }, () => new Set());
  const edited = new Set();
  const minimum = forward[n][m];
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j <= m; j += 1) {
      if (forward[i][j] + 1 + backward[i + 1][j] === minimum) edited.add(i);
      if (j < m) {
        const different = Number(expected[i].key !== actual[j].key);
        if (forward[i][j] + different + backward[i + 1][j + 1] === minimum) {
          if (different) edited.add(i);
          else candidates[i].add(j);
        }
      }
    }
  }
  // Score only matches present in every minimum-edit alignment. A tie-broken
  // alignment of a repeated word must not manufacture a formatting judgement.
  const matches = new Map();
  let ambiguousWords = 0;
  candidates.forEach((values, i) => {
    if (values.size === 1 && !edited.has(i)) matches.set(i, values.values().next().value);
    else if (values.size > 0) ambiguousWords += 1;
  });
  return { matches, ambiguousWords };
}

function punctuationCounts(text) {
  const counts = new Map();
  for (const mark of text.match(/\p{P}/gu) ?? []) counts.set(mark, (counts.get(mark) ?? 0) + 1);
  return counts;
}

function formattingScore(reference, hypothesis, policy) {
  const expected = tokenize(reference);
  const actual = tokenize(hypothesis);
  const alignment = stableMatches(expected.tokens, actual.tokens);
  const noAudit = (name) => unavailable(`reference_${name}_not_audited`);
  if (!alignment) return {
    alignment: unavailable("bounded_word_alignment_limit"),
    punctuation: policy.punctuation === true ? unavailable("bounded_word_alignment_limit") : noAudit("punctuation"),
    capitalization: policy.capitalization === true ? unavailable("bounded_word_alignment_limit") : noAudit("capitalization"),
  };
  const { matches, ambiguousWords } = alignment;
  const eligibleBoundaries = [];
  for (let i = 0; i <= expected.tokens.length; i += 1) {
    const left = i === 0 ? -1 : matches.get(i - 1);
    const right = i === expected.tokens.length ? actual.tokens.length : matches.get(i);
    if (left !== undefined && right !== undefined && right === left + 1) eligibleBoundaries.push([i, right]);
  }
  const markCounts = new Map();
  let correct = 0;
  let eligibleWords = 0;
  let excludedCaseFormWords = 0;
  for (const [i, j] of matches) {
    const a = expected.tokens[i].text.normalize("NFC");
    const b = actual.tokens[j].text.normalize("NFC");
    if (a.toLocaleLowerCase("en-US") !== b.toLocaleLowerCase("en-US") || !/\p{L}/u.test(a) ||
      a.toLocaleLowerCase("en-US") === a.toLocaleUpperCase("en-US")) { excludedCaseFormWords += 1; continue; }
    eligibleWords += 1;
    if (a === b) correct += 1;
  }
  let truePositive = 0;
  let falsePositive = 0;
  let falseNegative = 0;
  for (const [i, j] of eligibleBoundaries) {
    const a = punctuationCounts(expected.gaps[i]);
    const b = punctuationCounts(actual.gaps[j]);
    for (const mark of new Set([...a.keys(), ...b.keys()])) {
      const counts = markCounts.get(mark) ?? { truePositive: 0, falsePositive: 0, falseNegative: 0 };
      const tp = Math.min(a.get(mark) ?? 0, b.get(mark) ?? 0);
      const fp = (b.get(mark) ?? 0) - tp;
      const fn = (a.get(mark) ?? 0) - tp;
      counts.truePositive += tp; counts.falsePositive += fp; counts.falseNegative += fn;
      truePositive += tp; falsePositive += fp; falseNegative += fn;
      markCounts.set(mark, counts);
    }
  }
  const metrics = (counts) => ({ ...counts,
    precision: ratio(counts.truePositive, counts.truePositive + counts.falsePositive),
    recall: ratio(counts.truePositive, counts.truePositive + counts.falseNegative),
    f1: ratio(2 * counts.truePositive, 2 * counts.truePositive + counts.falsePositive + counts.falseNegative) });
  return {
    alignment: { status: "available", referenceWords: expected.tokens.length, hypothesisWords: actual.tokens.length,
      unambiguousEqualWords: matches.size, ambiguousReferenceWords: ambiguousWords,
      excludedReferenceWords: expected.tokens.length - matches.size, excludedHypothesisWords: actual.tokens.length - matches.size },
    capitalization: policy.capitalization === true ? {
      status: eligibleWords ? "available" : "unavailable", reason: eligibleWords ? null : "no_eligible_cased_words",
      eligibleWords, correct, errors: eligibleWords - correct, accuracy: ratio(correct, eligibleWords), excludedCaseFormWords,
    } : noAudit("capitalization"),
    punctuation: policy.punctuation === true ? {
      status: eligibleBoundaries.length ? "available" : "unavailable",
      reason: eligibleBoundaries.length ? null : "no_unambiguous_word_boundaries",
      eligibleBoundaries: eligibleBoundaries.length,
      excludedReferenceBoundaries: expected.gaps.length - eligibleBoundaries.length,
      excludedHypothesisBoundaries: actual.gaps.length - eligibleBoundaries.length,
      ...metrics({ truePositive, falsePositive, falseNegative }),
      byMark: Object.fromEntries(Array.from(markCounts, ([mark, counts]) => [mark, metrics(counts)])),
    } : noAudit("punctuation"),
  };
}

export function compareText(reference, hypothesis, formatting = {}) {
  if (typeof reference !== "string") return unavailable("missing_reference_text");
  if (typeof hypothesis !== "string") return unavailable("missing_hypothesis_text");
  const normalizedExpected = words(reference);
  const normalizedActual = words(hypothesis);
  const normalizedLexical = (normalizedExpected.length + 1) * (normalizedActual.length + 1) <= MAX_ALIGNMENT_CELLS
    ? { status: "available", ...scoreTranscript(reference, hypothesis) }
    : unavailable("bounded_word_alignment_limit");
  // Silence controls retain insertion counts; there is no word denominator.
  if (normalizedLexical.referenceWords === 0) normalizedLexical.wer = null;
  const rawExpected = reference.match(/\S+/gu) ?? [];
  const rawActual = hypothesis.match(/\S+/gu) ?? [];
  const rawDistance = edits(rawExpected, rawActual);
  return {
    status: "available", exactCharacters: characterScore(reference, hypothesis),
    normalizedLexical, normalizedLexicalCharacters: characterScore(normalizedExpected.join(" "), normalizedActual.join(" ")),
    rawWhitespaceTokens: { referenceTokens: rawExpected.length, hypothesisTokens: rawActual.length,
      editDistance: rawDistance, errorRate: rawDistance === null ? null : ratio(rawDistance, rawExpected.length) },
    whitespace: whitespaceScore(reference, hypothesis), ...formattingScore(reference, hypothesis, formatting),
  };
}

function validateManifest(manifest) {
  const require = (condition, message) => { if (!condition) throw new Error(`Invalid dictation quality manifest: ${message}`); };
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  require(object(manifest) && manifest.schemaVersion === 1, "schemaVersion must be 1");
  require(object(manifest.provenance) && ["public-fixture", "explicit-local-diagnostic"].includes(manifest.provenance.kind),
    "provenance.kind must identify public fixtures or an explicit local diagnostic");
  require(typeof manifest.provenance.description === "string" && manifest.provenance.description.trim().length > 0, "provenance.description required");
  require(Array.isArray(manifest.cases) && manifest.cases.length > 0 && manifest.cases.length <= 1000, "1 to 1000 cases required");
  const ids = new Set();
  const textField = (value, name) => require(typeof value === "string" && value.length <= 100_000, `${name} must be text of at most 100000 UTF-16 units`);
  for (const item of manifest.cases) {
    require(object(item), "case must be an object");
    require(typeof item.id === "string" && /^[a-zA-Z0-9_.-]{1,100}$/u.test(item.id) && !ids.has(item.id), "case ids must be unique safe labels");
    ids.add(item.id);
    if (item.reference !== undefined) {
      require(object(item.reference), `${item.id}: reference must be an object`);
      textField(item.reference.text, "reference.text");
      if (item.reference.formatting !== undefined) {
        require(object(item.reference.formatting), "reference.formatting must be an object");
        for (const value of Object.values(item.reference.formatting)) require(typeof value === "boolean", "formatting flags must be booleans");
      }
    }
    for (const name of ["modelText", "queuedText", "intendedFieldText"]) if (item[name] !== undefined) textField(item[name], name);
    require(object(item.observedField) && ["observed", "unavailable"].includes(item.observedField.status), `${item.id}: explicit observedField status required`);
    if (item.observedField.status === "observed") textField(item.observedField.text, "observedField.text");
    else require(typeof item.observedField.reason === "string" && item.observedField.reason.trim().length > 0, "unavailable observation requires a reason");
    if (item.sessions !== undefined) {
      require(Array.isArray(item.sessions) && item.sessions.length > 0, "sessions must be a nonempty array");
      const sessions = new Set();
      for (const session of item.sessions) {
        require(object(session) && typeof session.sessionId === "string" && /^[a-zA-Z0-9_.-]{1,100}$/u.test(session.sessionId) && !sessions.has(session.sessionId), "session ids must be unique safe labels");
        sessions.add(session.sessionId);
        textField(session.modelText, "session.modelText"); textField(session.queuedText, "session.queuedText");
      }
    }
    if (item.modelUpdates !== undefined) {
      require(Array.isArray(item.modelUpdates), "modelUpdates must be an array");
      item.modelUpdates.forEach((update) => {
        require(object(update), "model update must be an object"); textField(update.text, "modelUpdates.text");
        require(update.final === undefined || typeof update.final === "boolean", "modelUpdates.final must be boolean");
      });
    }
  }
}

export function scoreQualityManifest(manifest) {
  validateManifest(manifest);
  const results = manifest.cases.map((item) => {
    const stages = {
      recognition: compareText(item.reference?.text, item.modelText, item.reference?.formatting),
      transformation: compareText(item.modelText, item.queuedText, { punctuation: true, capitalization: true }),
      delivery: item.observedField.status === "observed"
        ? compareText(item.intendedFieldText, item.observedField.text, { punctuation: true, capitalization: true })
        : unavailable("target_field_not_observed"),
    };
    const updates = item.modelUpdates ?? [];
    const revisions = updates.slice(1).flatMap((update, i) => update.text.startsWith(updates[i].text) ? [] : [{
      updateIndex: i + 1, final: update.final === true, previousCodepoints: Array.from(updates[i].text).length,
      nextCodepoints: Array.from(update.text).length,
    }]);
    return { id: item.id, stages,
      observation: { status: item.observedField.status },
      stageDifferences: Object.entries(stages).filter(([, value]) => value.status === "available" && !value.exactCharacters.exact).map(([name]) => name),
      unresolvedStages: Object.entries(stages).filter(([, value]) => value.status !== "available").map(([name]) => name),
      sessions: item.sessions ? { count: item.sessions.length, repeatedSessions: item.sessions.length > 1,
        comparisons: item.sessions.map((session) => ({ sessionId: session.sessionId,
          transformation: compareText(session.modelText, session.queuedText, { punctuation: true, capitalization: true }) })),
      } : unavailable("session_evidence_not_supplied"),
      finalization: updates.length ? { updateCount: updates.length, revisions,
        finalUpdateCount: updates.filter((update) => update.final).length,
        lastUpdateMatchesModelText: typeof item.modelText === "string" ? updates.at(-1).text === item.modelText : null,
      } : unavailable("model_update_evidence_not_supplied"),
    };
  });
  return { schemaVersion: 1, scorer: "dictation-quality-v1", provenanceKind: manifest.provenance.kind,
    policy: {
      normalization: "Existing speech-score.mjs lexical normalization; no numeric equivalence. Raw metrics preserve all codepoints.",
      characters: "Unicode codepoints, including whitespace; not bytes, UTF-16 units, or grapheme clusters. Empty denominator rates are null.",
      whitespace: "Exact whitespace runs in character slots; excluded when non-whitespace text differs.",
      formatting: "Recognition requires explicit reference audit flags. Case uses NFC on unambiguous equal cased words; punctuation is a mark multiset per unambiguous adjacent word boundary. Internal contraction apostrophes are lexical; exact characters still capture their changes.",
      attribution: "Stage differences are comparisons, not causal diagnoses. Delivery requires an explicit intended full field and observed field; dispatch is not observation. Transformation references are fidelity contracts, not ASR gold.",
      privacy: "No transcript, field text, unsalted text hash, diagnostic description, or free-form observation reason is copied into this report. Use synthetic case/session labels. This opt-in file scorer does not collect data.",
    },
    summary: { cases: results.length, observedCases: results.filter((item) => item.observation.status === "observed").length,
      stages: Object.fromEntries(["recognition", "transformation", "delivery"].map((stage) => {
        const available = results.filter((item) => item.stages[stage].status === "available");
        return [stage, { available: available.length, unavailable: results.length - available.length,
          exact: available.filter((item) => item.stages[stage].exactCharacters.exact).length,
          different: available.filter((item) => !item.stages[stage].exactCharacters.exact).length }];
      })),
    }, cases: results };
}
