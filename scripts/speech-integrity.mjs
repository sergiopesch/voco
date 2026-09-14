import { scoreTranscript, words } from './speech-score.mjs';

const same = (left, right) => left.length === right.length && left.every((word, index) => word === right[index]);
const require = (condition, message) => { if (!condition) throw new Error(`Invalid speech integrity input: ${message}`); };

/** Explicit integrity gates supplement WER; an aggregate score cannot waive them. */
export function scoreSpeechIntegrity(reference, hypothesis, requirements) {
  require(typeof reference === 'string' && typeof hypothesis === 'string', 'reference and hypothesis must be strings');
  require(requirements !== null && typeof requirements === 'object' && !Array.isArray(requirements), 'requirements must be an object');
  const permitted = new Set(['exactWords', 'repetition', 'boundary', 'maxSubstitutions', 'maxDeletions', 'maxInsertions']);
  require(Object.keys(requirements).length > 0 && Object.keys(requirements).every(key => permitted.has(key)), 'empty or unknown requirements');
  const expected = words(reference);
  const actual = words(hypothesis);
  require(expected.length > 0, 'speech reference must contain lexical words');
  const accuracy = scoreTranscript(reference, hypothesis);
  const checks = { nonemptySpeech: actual.length > 0 };
  const details = {};
  if ('exactWords' in requirements) {
    require(requirements.exactWords === true, 'exactWords must be true when specified');
    checks.exactWords = same(expected, actual);
  }
  for (const [key, metric] of [['maxSubstitutions', 'substitutions'], ['maxDeletions', 'deletions'], ['maxInsertions', 'insertions']]) {
    if (key in requirements) {
      require(Number.isSafeInteger(requirements[key]) && requirements[key] >= 0, `${key} must be a nonnegative safe integer`);
      checks[key] = accuracy[metric] <= requirements[key];
    }
  }
  if ('repetition' in requirements) {
    const repetition = requirements.repetition;
    require(repetition !== null && typeof repetition === 'object' && !Array.isArray(repetition), 'repetition must be an object');
    require(Object.keys(repetition).length === 2 && typeof repetition.phrase === 'string' && Number.isSafeInteger(repetition.count) && repetition.count > 0, 'repetition requires only phrase and positive count');
    const phrase = words(repetition.phrase);
    require(phrase.length > 0 && Number.isSafeInteger(phrase.length * repetition.count) && phrase.length * repetition.count === expected.length, 'repetition must cover the complete reference');
    require(expected.every((word, index) => word === phrase[index % phrase.length]), 'reference does not match declared repetitions');
    let completePhrases = 0;
    for (let offset = 0; offset + phrase.length <= actual.length;) {
      if (same(phrase, actual.slice(offset, offset + phrase.length))) {
        completePhrases += 1;
        offset += phrase.length;
      } else offset += 1;
    }
    details.repetition = { expectedCount: repetition.count, observedNonoverlappingExactPhrases: completePhrases, expectedWords: expected.length, observedWords: actual.length };
    checks.repetitionCount = completePhrases === repetition.count;
    checks.repetitionSequence = same(expected, actual);
  }
  if ('boundary' in requirements) {
    const boundary = requirements.boundary;
    require(boundary !== null && typeof boundary === 'object' && !Array.isArray(boundary) && Object.keys(boundary).length > 0, 'boundary must be a nonempty object');
    require(Object.keys(boundary).every(key => key === 'prefix' || key === 'suffix'), 'unknown boundary requirement');
    for (const edge of Object.keys(boundary)) {
      require(typeof boundary[edge] === 'string', `boundary ${edge} must be text`);
      const tokens = words(boundary[edge]);
      require(tokens.length > 0 && tokens.length <= expected.length, `boundary ${edge} must contain reference words`);
      const sourceEdge = edge === 'prefix' ? expected.slice(0, tokens.length) : expected.slice(-tokens.length);
      require(same(tokens, sourceEdge), `boundary ${edge} differs from the complete reference`);
      checks[`boundary${edge === 'prefix' ? 'Prefix' : 'Suffix'}`] = same(tokens, edge === 'prefix' ? actual.slice(0, tokens.length) : actual.slice(-tokens.length));
    }
  }
  return { accuracy, integrityPassed: Object.values(checks).every(Boolean), checks, details };
}

export function evaluateIntegrityReport(plan, report) {
  require(plan !== null && typeof plan === 'object' && Array.isArray(plan.cases) && plan.cases.length > 0, 'plan requires cases');
  require(report !== null && typeof report === 'object' && Array.isArray(report.results), 'report requires results');
  require(report.results.length === plan.cases.length && report.completedCases === plan.cases.length, 'report must complete every planned case');
  require(report.workerExitCode === 0, 'worker must exit successfully');
  require(typeof report.passed === 'boolean', 'original gate result must be boolean');
  require(report.modelSha256 === plan.modelSha256 && /^[a-f0-9]{64}$/u.test(plan.modelSha256), 'model identities must match');
  require(!report.failure, 'report contains a worker or scoring error');
  for (const row of [...plan.cases, ...report.results]) require(row !== null && typeof row === 'object' && typeof row.id === 'string' && row.id.trim().length > 0, 'case IDs must be nonempty strings');
  const responseIds = new Set(report.results.map(row => row.id));
  const planIds = new Set(plan.cases.map(row => row.id));
  require(responseIds.size === report.results.length && planIds.size === plan.cases.length && [...responseIds].every(id => planIds.has(id)), 'case IDs must be unique and match exactly');
  const results = plan.cases.map(entry => {
    const observed = report.results.find(row => row.id === entry.id);
    require(observed.response !== null && typeof observed.response === 'object', `${entry.id}: response missing`);
    require(Number.isFinite(entry.maxWer) && entry.maxWer >= 0, `${entry.id}: maxWer must be finite and nonnegative`);
    const scored = scoreSpeechIntegrity(entry.reference, observed.response.chunkText, entry.integrityRequirements);
    return { id: entry.id, ...scored, originalCaseWerPassed: scored.accuracy.wer <= entry.maxWer };
  });
  return { passed: report.passed && results.every(row => row.integrityPassed && row.originalCaseWerPassed),
    originalSuitePassed: report.passed, integrityPassed: results.every(row => row.integrityPassed),
    totalCases: results.length, passingIntegrityCases: results.filter(row => row.integrityPassed).length, results };
}
