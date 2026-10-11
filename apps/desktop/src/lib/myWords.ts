import type { HeardVersion } from "@/types";

// The worker's rules (runtime/speech/mywords.py), checked here before saving
// and again by Rust's validate_my_words and validate_my_words_heard.
export const MY_WORDS_MAX_TERMS = 100;
export const MY_WORDS_MAX_WORDS = 4;
export const MY_WORDS_MAX_CHARS = 40;
/** Taught versions an entry keeps. */
export const MY_WORDS_MAX_HEARD = 5;
const TERM = /^[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:(?:[ -]|\. ?)[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*)*\.?$/u;
// A taught version: words separated by single spaces or hyphens, never full stops.
const HEARD = /^[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:[ -][\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*)*$/u;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

// After accents go and case is lowered, the few letters Python's casefold
// still folds further, so two entries match here exactly when they do there.
const CASEFOLD: Record<string, string> = {
  "ß": "ss", "ς": "σ", "ᲀ": "в", "ᲁ": "д", "ᲂ": "о", "ᲃ": "с", "ᲄ": "т", "ᲅ": "т", "ᲆ": "ъ", "ᲇ": "ѣ", "ᲈ": "ꙋ",
};

/** A word without case or accents, with one apostrophe for both. */
export function plainWord(word: string): string {
  return word.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[ßςᲀ-ᲈ]/gu, letter => CASEFOLD[letter] ?? letter).replace(/’/g, "'");
}

/** What the worker matches: the words without case, accents or what separates them,
 * with one apostrophe for both. */
export function myWordsKey(term: string): string {
  return (term.normalize("NFKD").replace(/\p{M}/gu, "").match(WORD) ?? []).join("").toLowerCase()
    .replace(/[ßςᲀ-ᲈ]/gu, letter => CASEFOLD[letter] ?? letter).replace(/’/g, "'");
}

/** A term's words, as the worker splits them. */
export function termWords(term: string): string[] {
  return term.match(WORD) ?? [];
}

/** Typed text as an entry: composed accents and single spaces. */
export function tidyMyWord(input: string): string {
  return input.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Why an entry can't join the list, or null when it can. */
export function myWordProblem(term: string, words: readonly string[], heard: readonly HeardVersion[] = []): string | null {
  if (!TERM.test(term)) {
    return "Use letters, digits, single spaces, hyphens, apostrophes and full stops, starting with a letter or digit.";
  }
  if ([...term].length > MY_WORDS_MAX_CHARS || termWords(term).length > MY_WORDS_MAX_WORDS) {
    return `Keep each entry to ${MY_WORDS_MAX_WORDS} words and ${MY_WORDS_MAX_CHARS} characters.`;
  }
  const existing = words.find(word => myWordsKey(word) === myWordsKey(term));
  if (existing) return `“${existing}” is already in My words.`;
  const taught = heard.find(version => myWordsKey(version.heard) === myWordsKey(term));
  if (taught) return `VOCO already writes “${taught.writes}” when it hears “${taught.heard}”.`;
  if (words.length >= MY_WORDS_MAX_TERMS) {
    return `My words holds up to ${MY_WORDS_MAX_TERMS} entries. Remove one to add another.`;
  }
  return null;
}

/** The entry a version belongs to: the one it writes whole, or else the first
 * with that word, as Rust and the worker read it. */
export function entryOf(words: readonly string[], writes: string): number {
  const whole = words.indexOf(writes);
  return whole !== -1 ? whole : words.findIndex(term => termWords(term).includes(writes));
}

/** The versions taught for the entry at `index`. */
export function versionsOf(words: readonly string[], heard: readonly HeardVersion[], index: number): HeardVersion[] {
  return heard.filter(version => entryOf(words, version.writes) === index);
}

/** The versions that still belong to an entry once the list is `words`. */
export function keptVersions(words: readonly string[], heard: readonly HeardVersion[]): HeardVersion[] {
  return heard.filter(version => entryOf(words, version.writes) !== -1);
}

/** The list without the entry at `index`, and the versions without its own. */
export function withoutEntry(words: readonly string[], heard: readonly HeardVersion[], index: number) {
  const remaining = words.filter((_, at) => at !== index);
  return {
    words: remaining,
    heard: heard.filter(version => entryOf(words, version.writes) !== index && entryOf(remaining, version.writes) !== -1),
  };
}

/** What the recognizer wrote, as a version VOCO could learn: `shown` without
 * the punctuation around it, and `text` without a pause's comma inside as well,
 * which the worker never joins words across. Null when it can't be one. */
export function heardVersion(transcript: string): { shown: string; text: string } | null {
  const shown = transcript.normalize("NFC").replace(/\s+/g, " ").replace(/^[\s\p{P}\p{S}]+|[\s\p{P}\p{S}]+$/gu, "");
  const text = shown.replace(/[,;:] /g, " ");
  return text && HEARD.test(text) && [...text].length <= MY_WORDS_MAX_CHARS
    && termWords(text).length <= MY_WORDS_MAX_WORDS ? { shown, text } : null;
}

/** Whether the recognizer's text holds the entry as listed: the worker writes
 * listed spellings exactly, except a lower-case entry's capital at a sentence start. */
export function writesEntry(transcript: string, entry: string): boolean {
  const escaped = entry.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const first = entry.charAt(0);
  const pattern = entry === entry.toLowerCase() && first.toUpperCase() !== first
    ? `[${first}${first.toUpperCase()}]${escaped.slice(1)}` : escaped;
  return new RegExp(`(?<![\\p{L}\\p{N}'’])${pattern}(?![\\p{L}\\p{N}])`, "u").test(transcript.normalize("NFC"));
}

export interface Teaching extends HeardVersion {
  /** Every word of what VOCO would change is an everyday word. */
  everyday: boolean;
}

export type CheckOutcome =
  | { kind: "right" }
  | { kind: "nothing" }
  /** `pause` when VOCO heard the entry's words with a pause between them. */
  | { kind: "unclear"; heard: string; pause?: boolean }
  /** VOCO heard only some words of a longer entry. */
  | { kind: "partial"; heard: string }
  | { kind: "teach"; heard: string; teaching: Teaching }
  | { kind: "taken"; heard: string; other: string }
  | { kind: "full"; heard: string };

/** What a Say it check means for the entry at `index`, from the recognizer's
 * text. When VOCO got it wrong, it proposes the smallest version to teach: the
 * one word of the entry it misheard, unless that would change everyday words
 * when said on their own, then the whole entry. */
export function judgeCheck(transcript: string, words: readonly string[], heard: readonly HeardVersion[],
  index: number, everyday: (word: string) => boolean): CheckOutcome {
  const entry = words[index]!;
  const said = transcript.trim();
  if (!said || said === "(no speech detected)") return { kind: "nothing" };
  if (writesEntry(said, entry)) return { kind: "right" };
  const heardAs = heardVersion(said);
  if (!heardAs) return { kind: "unclear", heard: said };
  const { shown } = heardAs;
  // A possessive belongs to the sentence, not the word.
  const version = /['’]s$/u.test(heardAs.text) && !/['’]s$/u.test(entry) ? heardAs.text.slice(0, -2) : heardAs.text;
  // The entry's own words, which the worker didn't join across a pause.
  if (myWordsKey(version) === myWordsKey(entry)) return { kind: "unclear", heard: shown, pause: true };
  const allEveryday = (text: string) => termWords(text).every(word => everyday(plainWord(word)));
  // A version never spans a pause: the worker wouldn't join it there.
  const unbroken = (text: string) => shown.includes(text);
  const misheard = mishearing(entry, version);
  let teaching: Teaching;
  if (misheard && !allEveryday(misheard.heard) && unbroken(misheard.heard)) teaching = { ...misheard, everyday: false };
  // Taught whole, a part of a longer entry would add the words VOCO missed.
  else if (!misheard && termWords(version).length < termWords(entry).length) return { kind: "partial", heard: shown };
  else if (!unbroken(version)) return { kind: "unclear", heard: shown, pause: true };
  else teaching = { heard: version, writes: entry, everyday: allEveryday(version) };
  // Every way the list already matches, and what each writes: entries,
  // versions, and each version of one word inside the entries with it. The new
  // version, and each match it makes inside an entry, may only repeat one that
  // writes the same.
  const matches = new Map<string, string>(words.map(term => [myWordsKey(term), term]));
  for (const taught of heard) matches.set(myWordsKey(taught.heard), taught.writes);
  for (const taught of heard) {
    for (const [key, term] of within(words, taught)) if (!matches.has(key)) matches.set(key, term);
  }
  const clash = ([[myWordsKey(teaching.heard), teaching.writes], ...within(words, teaching)] as [string, string][])
    .find(([key, writes]) => matches.has(key) && matches.get(key) !== writes);
  if (clash) return { kind: "taken", heard: shown, other: matches.get(clash[0])! };
  // The version counts against the entry it will belong to.
  if (versionsOf(words, heard, entryOf(words, teaching.writes)).length >= MY_WORDS_MAX_HEARD) return { kind: "full", heard: shown };
  return { kind: "teach", heard: shown, teaching };
}

/** The keys a version of one word stands for inside each entry with that word,
 * as the worker matches them. */
function within(words: readonly string[], version: HeardVersion): [string, string][] {
  const heardKey = myWordsKey(version.heard);
  return words.filter(term => term !== version.writes && termWords(term).includes(version.writes)).map(term => {
    let swapped = false;
    const key = termWords(term).map(word => {
      if (swapped || word !== version.writes) return myWordsKey(word);
      swapped = true;
      return heardKey;
    }).join("");
    return [key, term];
  });
}

/** When the version differs from the entry in one word of it only, that word
 * and what was heard in its place. */
function mishearing(entry: string, version: string): HeardVersion | null {
  const wanted = termWords(entry);
  const spans = [...version.matchAll(WORD)].map(match => ({ text: match[0], start: match.index!, end: match.index! + match[0].length }));
  if (wanted.length < 2) return null;
  // The words that agree at each end; what's between them is the mishearing.
  let head = 0;
  while (head < wanted.length && head < spans.length && plainWord(wanted[head]!) === plainWord(spans[head]!.text)) head++;
  let tail = 0;
  while (tail < wanted.length - head && tail < spans.length - head
    && plainWord(wanted[wanted.length - 1 - tail]!) === plainWord(spans[spans.length - 1 - tail]!.text)) tail++;
  const missing = wanted.length - head - tail;
  const replaced = spans.slice(head, spans.length - tail);
  if (missing !== 1 || !replaced.length) return null;
  return { heard: version.slice(replaced[0]!.start, replaced[replaced.length - 1]!.end), writes: wanted[head]! };
}
