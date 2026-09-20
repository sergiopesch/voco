import { cloneElement, useEffect, useId, useRef, useState } from "react";
import type { ReactElement } from "react";

// Consecutive hints stay responsive; no polling or work when the UI is idle.
let warmUntil = 0;

export function Tooltip({ text, children, align = "center" }: {
  text: string; children: ReactElement<{ "aria-describedby"?: string }>; align?: "center" | "end";
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  function hide() {
    clearTimeout(timer.current);
    if (visible) warmUntil = Date.now() + 300;
    setVisible(false);
  }
  return <span className="voco-tooltip" data-align={align}
    onPointerEnter={event => {
      if (event.pointerType !== "mouse") return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setVisible(true), Date.now() < warmUntil ? 0 : 400);
    }} onPointerLeave={hide} onFocusCapture={() => { clearTimeout(timer.current); setVisible(true); }}
    onBlurCapture={hide} onPointerDown={hide}
    onKeyDownCapture={event => {
      if (event.key === "Escape" && visible) { event.stopPropagation(); hide(); }
    }}>
    {cloneElement(children, { "aria-describedby": [children.props["aria-describedby"], visible ? id : null].filter(Boolean).join(" ") || undefined })}
    {visible ? <span id={id} role="tooltip" className="voco-tooltip__bubble">{text}</span> : null}
  </span>;
}
