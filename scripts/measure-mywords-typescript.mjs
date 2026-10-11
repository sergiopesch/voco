#!/usr/bin/env node
/**
 * Measure TypeScript's My words validation on the shared fixture.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Constants from myWords.ts
const MY_WORDS_MAX_WORDS = 4;
const MY_WORDS_MAX_CHARS = 40;
const TERM = /^[\p{L}\p{N}]+(?:[''][\p{L}\p{N}]+)*(?:(?:[ -]|\. ?)[\p{L}\p{N}]+(?:[''][\p{L}\p{N}]+)*)*\.?$/u;
const WORD = /[\p{L}\p{N}]+(?:[''][\p{L}\p{N}]+)*/gu;

function validateEntry(term) {
  if (!term) {
    return ['reject', null, 'empty string'];
  }
  
  const charCount = [...term].length;
  if (charCount > MY_WORDS_MAX_CHARS) {
    return ['reject', null, `too long: ${charCount} > ${MY_WORDS_MAX_CHARS}`];
  }
  
  if (!TERM.test(term)) {
    return ['reject', null, 'does not match TERM regex'];
  }
  
  const words = term.match(WORD) ?? [];
  const wordCount = words.length;
  
  if (wordCount > MY_WORDS_MAX_WORDS) {
    return ['reject', wordCount, `too many words: ${wordCount} > ${MY_WORDS_MAX_WORDS}`];
  }
  
  return ['accept', wordCount, null];
}

function main() {
  const fixturePath = join(__dirname, 'my-words-fixture.json');
  const content = readFileSync(fixturePath, 'utf-8');
  const cases = JSON.parse(content);
  
  const results = [];
  
  for (const testCase of cases) {
    const [actualVerdict, actualWordCount, error] = validateEntry(testCase.input);
    
    const matchesExpected = 
      actualVerdict === testCase.expectedVerdict &&
      (actualVerdict === 'reject' || actualWordCount === testCase.expectedWordCount);
    
    results.push({
      label: testCase.label,
      input: testCase.input,
      input_repr: JSON.stringify(testCase.input),
      expected_verdict: testCase.expectedVerdict,
      expected_word_count: testCase.expectedWordCount ?? null,
      actual_verdict: actualVerdict,
      actual_word_count: actualWordCount,
      error,
      matches_expected: matchesExpected,
    });
  }
  
  console.log(JSON.stringify(results, null, 2));
}

main();
