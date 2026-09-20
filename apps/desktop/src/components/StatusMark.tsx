/** Presentation only: the owner decides when an operation has actually finished. */
export function StatusMark({ state }: { state: "idle" | "working" | "listening" | "success" | "attention" }) {
  return <span className="voco-status-mark" data-state={state} aria-hidden="true">
    <svg viewBox="0 0 20 20" fill="none">
      <circle className="voco-status-mark__ring" cx="10" cy="10" r="7" />
      <path className="voco-status-mark__check" d="m6 10 2.5 2.5L14 7" pathLength="1" />
      <path className="voco-status-mark__attention" d="M10 6v5m0 3v.01" />
      <circle className="voco-status-mark__dot" cx="10" cy="10" r="2.5" />
    </svg>
  </span>;
}
