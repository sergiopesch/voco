import { useRef, useState } from "react";
import { CheckResult, SayItButton, TaughtVersions, focusSayIt } from "./WordCheck";
import { useWordCheck, type StartWordCheck } from "@/hooks/useWordCheck";
import {
  MY_WORDS_MAX_TERMS, myWordProblem, myWordsKey, tidyMyWord, versionsOf, withoutEntry, type Teaching,
} from "@/lib/myWords";
import type { HeardVersion } from "@/types";

interface MyWordsProps {
  words: readonly string[];
  heard: readonly HeardVersion[];
  disabled: boolean;
  /** Dictation or another recording is running, so Say it waits. */
  listeningElsewhere: boolean;
  /** Saves the whole list and its taught versions; resolves to an error message when it couldn't. */
  onSave: (words: string[], heard: HeardVersion[]) => Promise<string | null>;
  onStartCheck: StartWordCheck;
  onStopCheck: () => void;
}

export function MyWords({ words, heard, disabled, listeningElsewhere, onSave, onStartCheck, onStopCheck }: MyWordsProps) {
  const [draft, setDraft] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [checkError, setCheckError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const check = useWordCheck(onStartCheck, onStopCheck);
  // While a check listens, the list it started with stays as it is.
  const frozen = disabled || check.active;

  async function add() {
    const term = tidyMyWord(draft);
    const issue = term ? myWordProblem(term, words, heard) : null;
    if (!term || issue) {
      setProblem(issue);
      return;
    }
    const error = await onSave([...words, term], [...heard]);
    setProblem(error);
    if (!error) setDraft("");
    inputRef.current?.focus();
  }

  async function remove(index: number) {
    if ("entry" in check.state && check.state.entry === words[index]) check.reset();
    // An entry's taught versions go with it.
    const { words: remaining, heard: versions } = withoutEntry(words, heard, index);
    const error = await onSave(remaining, versions);
    setProblem(error);
    if (error) return;
    // Focus moves to the entry that took its place, or to the field when none is left.
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(".voco-my-words__remove") ?? [];
      (buttons[Math.min(index, buttons.length - 1)] ?? inputRef.current)?.focus();
    });
  }

  async function teach(entry: string, teaching: Teaching) {
    setCheckError(null);
    const error = await onSave([...words], [...heard, { heard: teaching.heard, writes: teaching.writes }]);
    if (error) setCheckError(error);
    else { check.taught(entry, teaching); focusSayIt(entry); }
  }

  async function forget(version: HeardVersion, entry: string) {
    const versions = versionsOf(words, heard, words.indexOf(entry));
    const at = versions.indexOf(version);
    const error = await onSave([...words], heard.filter(taught => taught !== version));
    setProblem(error);
    if (error) return;
    // Focus moves to the version that took its place, or to the entry's Say it.
    requestAnimationFrame(() => {
      const group = listRef.current?.querySelector(`[aria-label="${CSS.escape(`Versions VOCO learned for ${entry}`)}"]`);
      const buttons = group?.querySelectorAll<HTMLButtonElement>(".voco-taught__forget") ?? [];
      const next = buttons[Math.min(at, buttons.length - 1)];
      if (next) next.focus();
      else focusSayIt(entry);
    });
  }

  function say(entry: string) {
    setCheckError(null);
    void check.begin(entry);
  }

  return (
    <div className="voco-preferences__group">
      <div className="voco-preferences__card voco-preferences__form voco-my-words">
        <p className="voco-preferences__helper">
          Names and words for VOCO to write your way. Add one as you want it written, then say it to check that VOCO
          gets it right.
        </p>
        <form className="voco-my-words__add" onSubmit={event => { event.preventDefault(); void add(); }}>
          <label className="voco-field"><span>Word or name</span>
            <input ref={inputRef} value={draft} disabled={frozen} placeholder="Type a word or name"
              aria-invalid={Boolean(problem)} aria-describedby="voco-my-words-feedback"
              onChange={event => { setDraft(event.target.value); setProblem(null); }} />
          </label>
          <button className="voco-button voco-button--secondary" type="submit" disabled={frozen || !draft.trim()}>Add</button>
        </form>
        <p id="voco-my-words-feedback" className={problem ? "voco-inline-note voco-inline-note--error" : "voco-preferences__helper"}
          role={problem ? "alert" : undefined}>
          {problem ?? `${words.length} of ${MY_WORDS_MAX_TERMS}`}
        </p>
        {words.length ? (
          <ul className="voco-my-words__list" ref={listRef} aria-label="My words">
            {words.map((word, index) => (
              <li key={myWordsKey(word)} data-checking={"entry" in check.state && check.state.entry === word}>
                <div className="voco-my-words__row">
                  <span className="voco-my-words__word">{word}</span>
                  <SayItButton state={check.state} entry={word} compact
                    disabled={disabled || listeningElsewhere || (check.active && !("entry" in check.state && check.state.entry === word))}
                    onSay={() => say(word)} onDone={check.end} />
                  <button className="voco-button voco-button--ghost voco-button--compact voco-my-words__remove" type="button"
                    disabled={frozen}
                    aria-label={`Remove ${word}`} onClick={() => void remove(index)}>Remove</button>
                </div>
                <TaughtVersions versions={versionsOf(words, heard, index)} entry={word} disabled={frozen} onForget={version => void forget(version, word)} />
                <CheckResult state={check.state} entry={word} words={words} heard={heard} saving={disabled} error={checkError}
                  onTeach={teaching => void teach(word, teaching)} onSayAgain={() => say(word)} />
              </li>
            ))}
          </ul>
        ) : <p className="voco-preferences__helper">No words yet.</p>}
        <details className="voco-preferences__disclosure voco-my-words__help">
          <summary>How My words works</summary>
          <p>VOCO listens for these words and writes them as listed, from your next dictation. Type an ordinary word in
            lower case, like “router”, so it keeps its usual capitals.</p>
          <p>Say it shows what VOCO hears when you say a word, here only. If VOCO gets it wrong, teach it that version,
            and VOCO writes your word whenever it hears it. VOCO keeps up to five versions of each word.</p>
          <p>Your words, and the versions VOCO learns, stay on this computer.</p>
        </details>
      </div>
    </div>
  );
}
