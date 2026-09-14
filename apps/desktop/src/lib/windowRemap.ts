/** RuntimeDiagnostics uses insertion.rs SessionKind labels, not trace labels. */
export function isWaylandSession(sessionType: string | null): boolean {
  return sessionType === "wayland";
}

/** Suppress only blur from an interactive window's deliberate Wayland remap. */
export class WindowRemapFocusGuard {
  private revision = 0;
  private pending: { request: number; awaitingFocus: boolean } | null = null;

  invalidate() {
    this.revision += 1;
    this.pending = null;
  }

  begin(request: number) {
    this.invalidate();
    this.pending = { request, awaitingFocus: false };
  }

  awaitFocus(request: number) {
    if (this.pending?.request === request) this.pending.awaitingFocus = true;
  }

  cancel(request: number) {
    if (this.pending?.request === request) this.invalidate();
  }

  async shouldDismiss(readFocused: () => Promise<boolean>): Promise<boolean> {
    // A newer focus observation supersedes an older, still-pending native reply.
    const revision = ++this.revision;
    const focused = await readFocused().catch(() => null);
    if (revision !== this.revision || focused === null) return false;
    if (this.pending) {
      if (this.pending.awaitingFocus && focused) this.invalidate();
      // A compositor may decline focus. Wait for first actual focus; explicit
      // dismissal/new requests invalidate this guard without waiting or timers.
      return false;
    }
    return !focused;
  }
}

interface InteractiveWindowTransition {
  request: number;
  wayland: boolean;
  guard: WindowRemapFocusGuard;
  isCurrent: () => boolean;
  hide: () => Promise<void>;
  resize: () => Promise<void>;
  position: () => Promise<void>;
  show: () => Promise<void>;
  focus: () => Promise<void>;
  isFocused: () => Promise<boolean>;
}

export async function showInteractiveWindow(t: InteractiveWindowTransition): Promise<void> {
  if (!t.isCurrent()) return;
  const step = (operation: () => Promise<void>) =>
    t.wayland ? operation() : operation().catch(() => {});
  let unmapped = false;
  let shown = false;
  try {
    if (t.wayland) {
      t.guard.begin(t.request);
      await t.hide();
      unmapped = true;
      if (!t.isCurrent()) return;
    }
    await step(t.resize);
    if (!t.isCurrent()) return;
    await step(t.position);
    if (!t.isCurrent()) return;
    t.guard.awaitFocus(t.request);
    await step(t.show);
    shown = true;
    if (!t.isCurrent()) return;
    await step(t.focus);
    if (!t.isCurrent()) return;
    if (t.wayland) await t.guard.shouldDismiss(t.isFocused);
  } catch (error) {
    if (unmapped && t.isCurrent()) {
      // A failed resize must not strand the interactive UI while it is hidden.
      // Never reopen an escaped/superseded request.
      t.guard.awaitFocus(t.request);
      if (!shown) shown = await t.show().then(() => true, () => false);
      if (shown && t.isCurrent()) {
        await t.focus().catch(() => {});
        if (t.isCurrent()) await t.guard.shouldDismiss(t.isFocused);
      } else {
        t.guard.cancel(t.request);
      }
    } else {
      t.guard.cancel(t.request);
    }
    throw error;
  } finally {
    if (!t.isCurrent()) t.guard.cancel(t.request);
  }
}
