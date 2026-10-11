import { useRef, useState } from "react";

// The worker's rules (runtime/speech/mywords.py), checked here before saving
// and again by Rust's validate_my_words.
export const MY_WORDS_MAX_TERMS = 100;
export const MY_WORDS_MAX_WORDS = 4;
export const MY_WORDS_MAX_CHARS = 40;
const TERM = /^[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*(?:(?:[ -]|\. ?)[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*)*\.?$/u;
const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;

/** What the worker matches: the words without case, accents or what separates them. */
export function myWordsKey(term: string): string {
  return (term.normalize("NFKD").replace(/\p{M}/gu, "").match(WORD) ?? []).join("").toLowerCase();
}

/** Typed text as an entry: composed accents and single spaces. */
export function tidyMyWord(input: string): string {
  return input.normalize("NFC").trim().replace(/\s+/g, " ");
}

/** Why an entry can't join the list, or null when it can. */
export function myWordProblem(term: string, words: readonly string[]): string | null {
  if (!TERM.test(term)) {
    return "Use letters, digits, single spaces, hyphens, apostrophes and full stops, starting with a letter or digit.";
  }
  if ([...term].length > MY_WORDS_MAX_CHARS || (term.match(WORD) ?? []).length > MY_WORDS_MAX_WORDS) {
    return `Keep each entry to ${MY_WORDS_MAX_WORDS} words and ${MY_WORDS_MAX_CHARS} characters.`;
  }
  const existing = words.find(word => myWordsKey(word) === myWordsKey(term));
  if (existing) return `“${existing}” is already in My words.`;
  if (words.length >= MY_WORDS_MAX_TERMS) {
    return `My words holds up to ${MY_WORDS_MAX_TERMS} entries. Remove one to add another.`;
  }
  return null;
}

interface MyWordsProps {
  words: readonly string[];
  disabled: boolean;
  /** Saves the whole list; resolves to an error message when it couldn't. */
  onSave: (words: string[]) => Promise<string | null>;
}

export function MyWords({ words, disabled, onSave }: MyWordsProps) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  async function add() {
    const term = tidyMyWord(draft);
    const issue = term ? myWordProblem(term, words) : null;
    if (!term || issue) {
      setProblem(issue);
      return;
    }
    const error = await onSave([...words, term]);
    setProblem(error);
    if (!error) setDraft("");
    inputRef.current?.focus();
  }

  async function remove(index: number) {
    const error = await onSave(words.filter((_, at) => at !== index));
    setProblem(error);
    if (error) return;
    // Focus moves to the entry that took its place, or to the field when none is left.
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? [];
      (buttons[Math.min(index, buttons.length - 1)] ?? inputRef.current)?.focus();
    });
  }

  return (
    <div className="voco-preferences__group">
      <div className="voco-preferences__card voco-preferences__form">
        <p className="voco-preferences__helper">
          Names and terms for VOCO to write your way. Add each one as you want it written, with its capitals and accents.
        </p>
        <form className="voco-my-words__add" onSubmit={event => { event.preventDefault(); void add(); }}>
          <label className="voco-field"><span>Word or name</span>
            <input ref={inputRef} value={draft} disabled={disabled} placeholder="Siobhán, PipeWire, Kubernetes"
              aria-invalid={Boolean(problem)} aria-describedby="voco-my-words-feedback"
              onChange={event => { setDraft(event.target.value); setProblem(null); }} />
          </label>
          <button className="voco-button voco-button--secondary" type="submit" disabled={disabled || !draft.trim()}>Add</button>
        </form>
        <p id="voco-my-words-feedback" className={problem ? "voco-inline-note voco-inline-note--error" : "voco-preferences__helper"}
          role={problem ? "alert" : undefined}>
          {problem ?? `${words.length} of ${MY_WORDS_MAX_TERMS}`}
        </p>
        {words.length ? (
          <ul className="voco-my-words__list" ref={listRef} aria-label="My words">
            {words.map((word, index) => (
              <li key={myWordsKey(word)}>
                <span>{word}</span>
                <button className="voco-button voco-button--ghost voco-button--compact" type="button" disabled={disabled}
                  aria-label={`Remove ${word}`} onClick={() => void remove(index)}>Remove</button>
              </li>
            ))}
          </ul>
        ) : <p className="voco-preferences__helper">No words yet.</p>}
        <p className="voco-preferences__helper">
          VOCO listens for these words and writes them as listed, from your next dictation. Type an ordinary word in lower
          case, like “router”, so it keeps its usual capitals. A word that sounds like another can still come out wrong.
          The list stays on this computer.
        </p>
      </div>
    </div>
  );
}
