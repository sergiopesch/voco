import { useEffect, useRef, useState } from "react";
import { CheckResult, SayItButton, focusSayIt } from "./WordCheck";
import { useWordCheck, type StartWordCheck } from "@/hooks/useWordCheck";
import {
  MY_WORDS_MAX_CHARS, MY_WORDS_MAX_WORDS, keptVersions, myWordProblem, myWordsKey, tidyMyWord, withoutEntry, type Teaching,
} from "@/lib/myWords";
import type { HeardVersion } from "@/types";

interface SetupWordsProps {
  /** The account's full name, offered as the first entry. */
  accountName: string | null;
  words: readonly string[];
  heard: readonly HeardVersion[];
  saving: boolean;
  onSave: (words: string[], heard: HeardVersion[]) => Promise<string | null>;
  onStartCheck: StartWordCheck;
  onStopCheck: () => void;
  /** Leaves the step; `checked` says whether the person said a word in it. */
  onContinue: (checked: boolean) => void;
}

/** A save that failed, and the word it was for; null for the name card. */
type SaveError = { entry: string | null; message: string };

/** Setup's third step: the person's name, checked by saying it, and any other
 * words they choose. Nothing is saved until they say a word or continue with it. */
export function SetupWords({ accountName, words, heard, saving, onSave, onStartCheck, onStopCheck, onContinue }: SetupWordsProps) {
  const check = useWordCheck(onStartCheck, onStopCheck);
  // Run setup again keeps the list: an account name it holds shows as saved.
  // Otherwise the name is offered only to an empty list, so a setup run again
  // never adds it beside a name the person changed it to, and only when it
  // could be an entry.
  const listed = (name: string | null) => name ? words.find(word => myWordsKey(word) === myWordsKey(name)) ?? null : null;
  const offered = (name: string | null) => name && !words.length && myWordProblem(tidyMyWord(name), [], []) === null ? tidyMyWord(name) : null;
  const [savedName, setSavedName] = useState<string | null>(() => listed(accountName));
  const [name, setName] = useState(() => savedName ?? offered(accountName) ?? "");
  const [nameProblem, setNameProblem] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [draftProblem, setDraftProblem] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);
  const [checked, setChecked] = useState(false);
  // Whether this step saved anything; until it has, the person can skip it.
  const [kept, setKept] = useState(false);
  const [edited, setEdited] = useState(false);
  // A failed save leaves its error with the window, so the step saves again
  // before it hands over.
  const failed = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const draftRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => { titleRef.current?.focus(); }, []);
  // The account's name may arrive after the step opens.
  useEffect(() => {
    if (!accountName || name || savedName || edited) return;
    const saved = listed(accountName);
    setSavedName(saved);
    setName(saved ?? offered(accountName) ?? "");
  }, [accountName, name, savedName, edited]);

  const others = words.filter(word => word !== savedName);
  const tidyName = tidyMyWord(name);
  const busy = saving || check.active;

  /** Saves, and keeps a failure's reason with the word it was for. */
  async function save(list: string[], versions: HeardVersion[], entry: string | null): Promise<boolean> {
    const message = await onSave(list, versions);
    failed.current = message !== null;
    setSaveError(message === null ? null : { entry, message });
    return message === null;
  }

  /** The name as the field shows it, in the list: added, replacing the one
   * saved before, or removed with the field cleared. False when it couldn't be. */
  async function saveName(): Promise<boolean> {
    const problem = tidyName ? myWordProblem(tidyName, others, heard) : null;
    // Names longer than an entry can be are common, so say what fits.
    if (problem) {
      setNameProblem(problem.startsWith("Keep each entry")
        ? `Use up to ${MY_WORDS_MAX_WORDS} words and ${MY_WORDS_MAX_CHARS} characters, like the name you go by.` : problem);
      return false;
    }
    if (tidyName === (savedName ?? "")) return true;
    const list = !savedName ? [...words, tidyName]
      : tidyName ? words.map(word => word === savedName ? tidyName : word) : others;
    if (!(await save(list, keptVersions(list, heard), null))) return false;
    setSavedName(tidyName || null);
    setKept(true);
    return true;
  }

  // The name saves before VOCO listens, so the check leans toward it.
  const starting = useRef(false);
  async function sayName() {
    if (!tidyName || starting.current) return;
    starting.current = true;
    focusSayIt(tidyName);
    try {
      if (!(await saveName())) return;
      setName(tidyName);
      setChecked(true);
      void check.begin(tidyName);
    } finally { starting.current = false; }
  }

  function sayWord(word: string) {
    setChecked(true);
    setSaveError(null);
    void check.begin(word);
  }

  async function add() {
    const term = tidyMyWord(draft);
    const issue = term ? myWordProblem(term, words, heard) : null;
    if (!term || issue) { setDraftProblem(issue); return; }
    const message = await onSave([...words, term], [...heard]);
    failed.current = message !== null;
    setDraftProblem(message);
    if (message) return;
    setAdded(list => [...list, term]);
    setKept(true);
    setDraft("");
    draftRef.current?.focus();
  }

  async function remove(word: string) {
    const at = added.indexOf(word);
    if ("entry" in check.state && check.state.entry === word) check.reset();
    const { words: remaining, heard: versions } = withoutEntry(words, heard, words.indexOf(word));
    const message = await onSave(remaining, versions);
    failed.current = message !== null;
    setDraftProblem(message);
    if (message) return;
    setAdded(list => list.filter(entry => entry !== word));
    // Focus moves to the word that took its place, or to the field when none is left.
    requestAnimationFrame(() => {
      const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>(".voco-words-more__remove") ?? [];
      (buttons[Math.min(at, buttons.length - 1)] ?? draftRef.current)?.focus();
    });
  }

  async function teach(entry: string, teaching: Teaching) {
    if (await save([...words], [...heard, { heard: teaching.heard, writes: teaching.writes }], entry)) {
      check.taught(entry, teaching);
      focusSayIt(entry);
    }
  }

  /** Continue keeps the name as the field shows it; Skip leaves it unsaved. */
  async function leave(keepName: boolean) {
    if (keepName && !(await saveName())) return;
    // After a failed save, saving what's kept clears its error, or keeps the
    // person here with its reason.
    if (failed.current && !(await save([...words], [...heard], null))) return;
    onContinue(checked);
  }

  const nameChecking = "entry" in check.state && check.state.entry === savedName && tidyName === savedName;
  // Under the name, a save that failed for it; one that failed while teaching
  // shows with what VOCO heard.
  const nameError = saveError && (saveError.entry === null || (saveError.entry === savedName && !nameChecking)) ? saveError.message : null;
  return <section className="voco-panel__content voco-setup voco-setup--words" aria-labelledby="voco-words-title" data-phase="words">
    <div className="voco-setup__intro">
      <h2 id="voco-words-title" ref={titleRef} tabIndex={-1}>Will VOCO get your name right?</h2>
      <p>Say it and see what VOCO writes. If it gets it wrong, VOCO learns how you say it.</p>
    </div>
    <div className="voco-words-name" data-checking={nameChecking}>
      <label className="voco-words-name__label" htmlFor="voco-words-name">Your name</label>
      <div className="voco-words-name__row">
        <input id="voco-words-name" className="voco-words-name__input" value={name} disabled={busy}
          placeholder="Your name" autoComplete="name" spellCheck={false}
          aria-invalid={Boolean(nameProblem)} aria-describedby="voco-words-name-note"
          onChange={event => { setName(event.target.value); setNameProblem(null); setSaveError(null); setEdited(true); if (!check.active) check.reset(); }}
          onKeyDown={event => { if (event.key === "Enter" && tidyName && !busy) { event.preventDefault(); void sayName(); } }} />
        <SayItButton state={nameChecking ? check.state : { phase: "idle" }} entry={tidyName || "your name"}
          disabled={check.active || !tidyName} onSay={() => void sayName()} onDone={check.end} />
      </div>
      {nameProblem || nameError ? <p id="voco-words-name-note" className="voco-inline-note voco-inline-note--error" role="alert">{nameProblem ?? nameError}</p>
        : nameChecking ? null
        : <p id="voco-words-name-note" className="voco-words-name__hint">{tidyName ? "Say it the way you usually do. VOCO shows what it heard here, and nowhere else." : "Type your name the way you write it."}</p>}
      {nameChecking ? <CheckResult state={check.state} entry={savedName!} words={words} heard={heard} saving={saving} inSetup
        error={saveError?.entry === savedName ? saveError.message : null}
        onTeach={teaching => void teach(savedName!, teaching)} onSayAgain={() => void sayName()} /> : null}
    </div>
    <div className="voco-words-more">
      <h3 id="voco-words-more-title">Anything else VOCO should know?</h3>
      <form className="voco-words-more__add" onSubmit={event => { event.preventDefault(); void add(); }}>
        <input ref={draftRef} value={draft} disabled={busy} placeholder="Type a word or name" aria-labelledby="voco-words-more-title"
          aria-invalid={Boolean(draftProblem)} aria-describedby="voco-words-more-note" spellCheck={false}
          onChange={event => { setDraft(event.target.value); setDraftProblem(null); }} />
        <button className="voco-button voco-button--secondary voco-button--compact" type="submit" disabled={busy || !draft.trim()}>Add</button>
      </form>
      {draftProblem ? <p id="voco-words-more-note" className="voco-inline-note voco-inline-note--error" role="alert">{draftProblem}</p> : null}
      {added.length ? <ul className="voco-words-more__list" ref={listRef} aria-label="Words you added">
        {added.map(word => <li key={myWordsKey(word)}>
          <div className="voco-my-words__row">
            <span className="voco-my-words__word">{word}</span>
            <SayItButton state={check.state} entry={word} compact
              disabled={busy && !("entry" in check.state && check.state.entry === word && check.active)}
              onSay={() => sayWord(word)} onDone={check.end} />
            <button className="voco-button voco-button--ghost voco-button--compact voco-words-more__remove" type="button" disabled={busy}
              aria-label={`Remove ${word}`} onClick={() => void remove(word)}>Remove</button>
          </div>
          <CheckResult state={check.state} entry={word} words={words} heard={heard} saving={saving} inSetup
            error={saveError?.entry === word ? saveError.message : null}
            onTeach={teaching => void teach(word, teaching)} onSayAgain={() => sayWord(word)} />
        </li>)}
      </ul> : null}
    </div>
    <p className="voco-setup__privacy">Your words stay on this computer. You can add, check and remove them any time in Settings.</p>
    <div className="voco-setup__actions">
      <button className="voco-button voco-button--primary" disabled={busy} onClick={() => void leave(true)}>Continue</button>
      {!kept && !savedName ? <button className="voco-button voco-button--ghost" disabled={busy} onClick={() => void leave(false)}>Skip for now</button> : null}
    </div>
  </section>;
}
