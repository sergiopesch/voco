import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export interface DeviceOption { value: string; label: string; disabled?: boolean }

/** Selection is controlled; choosing a draft never applies native microphone permission. */
export function DeviceSelect({ label, value, options, disabled = false, onChange }: {
  label: string; value: string; options: DeviceOption[]; disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(value);
  const [above, setAbove] = useState(false);
  const [highlight, setHighlight] = useState({ top: 0, height: 0 });
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", at: 0 });
  const shown = open && !disabled;
  const enabled = options.filter(option => !option.disabled);
  const activeIndex = options.findIndex(option => option.value === active && !option.disabled);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    if (!shown) return;
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [shown]);
  useLayoutEffect(() => {
    if (!shown || !list.current) return;
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setAbove(window.innerHeight - rect.bottom < Math.min(240, list.current.scrollHeight) && rect.top > window.innerHeight - rect.bottom);
    const row = list.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    if (row) {
      setHighlight({ top: row.offsetTop, height: row.offsetHeight });
      // Scroll only the list, never the enclosing settings page or native window.
      if (row.offsetTop < list.current.scrollTop) list.current.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > list.current.scrollTop + list.current.clientHeight)
        list.current.scrollTop = row.offsetTop + row.offsetHeight - list.current.clientHeight;
    }
  }, [shown, activeIndex, options]);

  function reveal(last = false) {
    const selected = enabled.find(option => option.value === value);
    setActive(selected?.value ?? (last ? enabled[enabled.length - 1]?.value : enabled[0]?.value) ?? "");
    search.current = { text: "", at: 0 };
    setOpen(true);
  }
  function choose(option: DeviceOption) {
    if (disabled || option.disabled) return;
    onChange(option.value);
    setOpen(false);
    trigger.current?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const key = event.key;
    if (key === "Escape" && shown) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); return;
    }
    if (key === "Tab") { setOpen(false); return; }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(key)) {
      event.preventDefault();
      if (!shown) { reveal(key === "ArrowUp" || key === "End"); return; }
      const index = enabled.findIndex(option => option.value === active);
      const next = key === "Home" ? 0 : key === "End" ? enabled.length - 1
        : Math.max(0, Math.min(enabled.length - 1, index + (key === "ArrowDown" ? 1 : -1)));
      if (enabled[next]) setActive(enabled[next].value);
    } else if (key === "Enter" || key === " ") {
      event.preventDefault();
      if (!shown) reveal();
      else { const option = options[activeIndex]; if (option) choose(option); }
    } else if (key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      const now = Date.now();
      const text = now - search.current.at < 700 ? search.current.text + key.toLowerCase() : key.toLowerCase();
      search.current = { text, at: now };
      const match = enabled.find(option => option.label.toLowerCase().startsWith(text));
      if (match) { setActive(match.value); setOpen(true); }
    }
  }
  return <div className="voco-device-select" ref={root}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={trigger} type="button" className="voco-device-select__trigger" role="combobox"
      aria-label={label} aria-haspopup="listbox" aria-expanded={shown} aria-controls={shown ? id : undefined}
      aria-activedescendant={shown && activeIndex >= 0 ? `${id}-${activeIndex}` : undefined}
      disabled={disabled} onKeyDown={keyDown} onClick={() => shown ? setOpen(false) : reveal()}>
      <span>{options.find(option => option.value === value)?.label ?? "Choose a microphone"}</span>
      <img src="/icons/chevron-right.svg" className="voco-ui-icon" alt="" />
    </button>
    {shown ? <div className="voco-device-select__menu" data-above={above}>
      <div ref={list} id={id} className="voco-device-select__list" role="listbox" aria-label={label}>
        {activeIndex >= 0 ? <span className="voco-device-select__highlight" aria-hidden="true"
          style={{ height: highlight.height, transform: `translateY(${highlight.top}px)` }} /> : null}
        {options.map((option, index) => <div id={`${id}-${index}`} key={option.value} data-index={index} data-value={option.value}
          role="option" aria-selected={option.value === value} aria-disabled={option.disabled || undefined}
          className="voco-device-select__option" onPointerDown={event => event.preventDefault()}
          onPointerMove={() => { if (!option.disabled && active !== option.value) setActive(option.value); }}
          onClick={() => choose(option)}>
          <span>{option.label}</span><span className="voco-device-select__check" aria-hidden="true">{option.value === value ? "✓" : ""}</span>
        </div>)}
      </div>
    </div> : null}
  </div>;
}
