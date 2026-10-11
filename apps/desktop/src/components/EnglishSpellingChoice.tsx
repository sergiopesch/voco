import { Fragment, useId, useState } from "react";
import type { EnglishSpelling } from "@/types";
import { differingWords, ENGLISH_VARIETIES, type EnglishVariety } from "@/lib/englishSpelling";

const VARIETIES: readonly EnglishVariety[] = ["british", "american"];

interface EnglishSpellingChoiceProps {
  value: EnglishSpelling;
  /** The heading that names the choice. */
  labelledBy: string;
  disabled?: boolean;
  /** Settings also offers the recognizer's own, mixed spelling. */
  offerAsRecognised?: boolean;
  /** No choice is saved yet, so choosing the preselected card saves it too. */
  unsaved?: boolean;
  compact?: boolean;
  onChange: (value: EnglishSpelling) => void;
}

/** Native radios in two flag cards: arrow keys move between them, and each
 * reads as its variety with the example words as its description. */
export function EnglishSpellingChoice({ value, labelledBy, disabled = false, offerAsRecognised = false,
  unsaved = false, compact = false, onChange }: EnglishSpellingChoiceProps) {
  const name = useId();
  return <div className="voco-spelling" role="radiogroup" aria-labelledby={labelledBy} data-compact={compact}>
    <div className="voco-spelling__cards">
      {VARIETIES.map(variety => {
        const option = ENGLISH_VARIETIES[variety];
        const examples = `${name}-${variety}`;
        return <label key={variety} className="voco-spelling__card" data-checked={value === variety} data-disabled={disabled}>
          <input type="radio" name={name} value={variety} checked={value === variety} disabled={disabled}
            aria-label={option.label} aria-describedby={examples} onChange={() => onChange(variety)}
            onClick={() => { if (unsaved && value === variety) onChange(variety); }} />
          <img className="voco-spelling__flag" src={option.flag} alt="" />
          <span className="voco-spelling__name">{option.label}</span>
          <span className="voco-spelling__examples" id={examples}>
            {option.examples.map((word, index) => <Fragment key={word}>
              {index ? <span aria-hidden="true">·</span> : null}<span>{word}</span>
            </Fragment>)}
          </span>
          <span className="voco-spelling__mark" aria-hidden="true" />
        </label>;
      })}
    </div>
    {offerAsRecognised ? <label className="voco-spelling__plain" data-checked={value === "as-recognised"}>
      <input type="radio" name={name} value="as-recognised" checked={value === "as-recognised"} disabled={disabled}
        onChange={() => onChange("as-recognised")} />
      <span>Leave spelling as recognised</span>
    </label> : null}
  </div>;
}

/** The sample sentence in the chosen spelling, its changed words marked. */
export function EnglishSpellingSample({ value }: { value: EnglishSpelling }) {
  if (value === "as-recognised") {
    return <p className="voco-spelling__sample" aria-live="polite">
      <span className="voco-spelling__sample-label">How your words will look</span>
      Exactly as the recognizer writes them, which mixes both: “recognize” and “defence”.
    </p>;
  }
  const changed = differingWords(value);
  return <p className="voco-spelling__sample" aria-live="polite">
    <span className="voco-spelling__sample-label">How your words will look</span>
    “{ENGLISH_VARIETIES[value].sample.split(" ").map((word, index) => {
      const [, letters, punctuation] = /^(.*?)([.,!?]*)$/.exec(word)!;
      return <Fragment key={value + index}>
        {index ? " " : null}{changed.has(word) ? <><mark>{letters}</mark>{punctuation}</> : word}
      </Fragment>;
    })}”
  </p>;
}

interface EnglishSpellingStepProps {
  value: EnglishSpelling;
  saving: boolean;
  error: string | null;
  onChange: (value: EnglishSpelling) => void;
  onContinue: () => void;
}

/** Setup's first question. British comes preselected; a choice saves at once. */
export function EnglishSpellingStep({ value, saving, error, onChange, onContinue }: EnglishSpellingStepProps) {
  // Someone who chose it in Settings sees it again here; it never appears mid-step.
  const [offerAsRecognised] = useState(value === "as-recognised");
  return <section className="voco-panel__content voco-setup voco-setup--spelling" aria-labelledby="voco-spelling-title" data-phase="spelling">
    <div className="voco-setup__intro">
      <h2 id="voco-spelling-title" tabIndex={-1}>Which English do you write?</h2>
      <p>VOCO spells your words to match. You can change this in Settings.</p>
    </div>
    <EnglishSpellingChoice value={value} labelledBy="voco-spelling-title" offerAsRecognised={offerAsRecognised} onChange={onChange} />
    <EnglishSpellingSample value={value} />
    {error ? <p className="voco-inline-note voco-inline-note--error" role="alert">{error}</p> : null}
    <p className="voco-setup__privacy">Spelling only: VOCO never changes names or what you mean.</p>
    <div className="voco-setup__actions">
      <button className="voco-button voco-button--primary" disabled={saving} onClick={onContinue}>Continue</button>
    </div>
  </section>;
}

interface EnglishSpellingNoticeProps {
  /** What they chose, once they have; the note then confirms it. */
  answer: EnglishVariety | null;
  disabled: boolean;
  onChoose: (value: EnglishVariety) => void;
}

/** For someone set up before VOCO had a spelling choice; either answer saves it. */
export function EnglishSpellingNotice({ answer, disabled, onChoose }: EnglishSpellingNoticeProps) {
  return <section className="voco-spelling-notice" aria-labelledby="voco-spelling-notice-title">
    <img className="voco-spelling__flag" src={ENGLISH_VARIETIES[answer ?? "british"].flag} alt="" />
    <div className="voco-spelling-notice__copy" role="status">
      <strong id="voco-spelling-notice-title">
        {answer ? `VOCO spells in ${ENGLISH_VARIETIES[answer].label}.` : "VOCO now spells in British English."}
      </strong>
      <span>{answer ? "You can change this in Settings." : ENGLISH_VARIETIES.british.examples.join(", ")}</span>
    </div>
    {answer ? null : <div className="voco-spelling-notice__actions">
      <button className="voco-button voco-button--secondary voco-button--compact" disabled={disabled} onClick={() => onChoose("american")}>Use American English</button>
      <button className="voco-button voco-button--ghost voco-button--compact" disabled={disabled} onClick={() => onChoose("british")}>Keep British</button>
    </div>}
  </section>;
}
