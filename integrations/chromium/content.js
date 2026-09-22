(() => {
  if (globalThis.__vocoExactField) return;
  globalThis.__vocoExactField = true;
  const id = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), x => x.toString(16).padStart(2, '0')).join('');
  const documentId = id();
  const MAX_BYTES = 100_000, MAX_TOTAL = 1_000_000;
  let armed = false, session = null, ownEvent = null;
  const retired = new Map();
  const send = message => chrome.runtime.sendMessage({protocol: 1, documentId, ...message}).catch(() => { armed = false; invalidate('disconnected'); });
  function eligible(e) {
    return (e instanceof HTMLTextAreaElement || (e instanceof HTMLInputElement && ['text', 'search', 'url', 'tel'].includes(e.type))) &&
      e.isConnected && !e.matches(':disabled') && !e.readOnly && !e.closest('[data-voco-private],[inert]') &&
      !/password|one-time-code|cc-|transaction-/i.test(e.autocomplete || '') &&
      Number.isInteger(e.selectionStart) && e.selectionStart === e.selectionEnd;
  }
  function invalidate(reason) {
    if (!session || session.invalid) return;
    session.invalid = true;
    observer.disconnect();
    send({type: 'invalidate', token: session.token, reason});
  }
  function valid() {
    if (!session || session.invalid || Date.now() > session.expires) return false;
    const e = session.element;
    return document.hasFocus() && document.activeElement === e && eligible(e) &&
      e.value === session.value && e.selectionStart === session.caret && e.selectionEnd === session.caret;
  }
  function changedTarget(records) {
    if (!session) return false;
    const element = session.element;
    return !element.isConnected || records.some(record => {
      if (record.type === 'attributes') return session.ancestors.has(record.target) || record.target.contains(element);
      // Mutation records retain removed objects even if page code has already
      // restored the same DOM tree before this observer runs.
      return Array.from(record.removedNodes).some(node => session.ancestors.has(node) || node.contains(element));
    });
  }
  const observer = new MutationObserver(records => {
    if (changedTarget(records)) invalidate('element-changed');
  });
  document.addEventListener('focusout', () => invalidate('focus-changed'), true);
  window.addEventListener('blur', () => invalidate('focus-changed'), true);
  window.addEventListener('pagehide', () => {
    armed = false;
    // A focusout may have already revoked delivery; page departure also ends capture.
    invalidate('navigation');
    if (session && !session.finished) send({type: 'stop', token: session.token});
  }, true);
  for (const name of ['input', 'beforeinput', 'select', 'selectionchange']) document.addEventListener(name, event => {
    if (event === ownEvent) return;
    if (session && !valid()) invalidate('field-changed');
    if (session && ['input', 'beforeinput'].includes(name)) invalidate('field-changed');
  }, true);
  document.addEventListener('keydown', event => {
    if (!armed || !event.isTrusted || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.code !== 'KeyV') return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    if (session && !session.finished) { send({type: 'stop', token: session.token}); return; }
    const element = document.activeElement;
    if (!document.hasFocus() || !eligible(element) || element.value.length > MAX_TOTAL) return;
    if (session) retired.set(session.token, {expires: Date.now() + 60_000, journal: session.journal});
    for (const [token, previous] of retired) if (Date.now() > previous.expires) retired.delete(token);
    if (retired.size >= 16) retired.delete(retired.keys().next().value);
    observer.takeRecords(); // This shortcut authorizes the current tree, not earlier edits.
    const ancestors = new Set();
    for (let ancestor = element; ancestor; ancestor = ancestor.parentNode) ancestors.add(ancestor);
    session = {token: id(), element, ancestors, value: element.value, caret: element.selectionStart, expires: Date.now() + 2000,
      claimed: false, invalid: false, finished: false, committed: 0, bytes: 0, next: 0, journal: new Map()};
    // Observe before asynchronous claim/start work, and only while this field can receive text.
    observer.observe(document, {subtree: true, childList: true, attributes: true, attributeFilter: ['type', 'readonly', 'disabled', 'autocomplete', 'data-voco-private', 'inert']});
    send({type: 'trigger', token: session.token, mode: 'dictation'});
  }, true);
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message.type === 'arm') { armed = true; respond({documentId}); return; }
    if (message.type === 'disarm') {
      const stopToken = session && !session.finished ? session.token : null;
      armed = false; invalidate('disconnected'); if (session) session.finished = true; observer.disconnect();
      respond({documentId, stopToken}); return;
    }
    if (message.type === 'query' && message.documentId === documentId && retired.has(message.token)) {
      const previous = retired.get(message.token);
      respond(Date.now() <= previous.expires ? previous.journal.get(message.sequence)?.receipt || null : null); return;
    }
    if (!session || message.token !== session.token || message.documentId !== documentId) { respond(null); return; }
    // Losing insertion ownership must not release the recording's Stop token.
    if (message.type === 'revoke') { invalidate('cancelled'); respond({}); return; }
    if (message.type === 'cancel') { invalidate('cancelled'); session.finished = true; observer.disconnect(); respond({}); return; }
    if (message.type === 'query') { respond(session.journal.get(message.sequence)?.receipt || null); return; }
    if (!['claim', 'append'].includes(message.type)) { respond(null); return; }
    const {requestId, token, sequence, expectedCommittedCharacters} = message;
    const receipt = {protocol: 1, type: 'receipt', requestId, token, documentId, sequence, expectedCommittedCharacters,
      outcome: 'rejected', committedCharacters: session.committed};
    const signature = JSON.stringify([message.type, expectedCommittedCharacters, message.text, message.final]);
    const deadlineValid = () => Number.isSafeInteger(message.expiresAt) && Date.now() <= message.expiresAt && message.expiresAt <= Date.now() + 2000;
    const previous = session.journal.get(sequence);
    if (previous) { respond(previous.signature === signature ? {...previous.receipt, requestId} : {...receipt, reason: 'sequence-conflict'}); return; }
    if (changedTarget(observer.takeRecords())) invalidate('element-changed');
    if (!deadlineValid()) {
      const rejected = {...receipt, reason: 'expired'};
      if (sequence === session.next && session.journal.size < 1000) session.journal.set(sequence, {signature, receipt: rejected});
      respond(rejected); return;
    }
    if (!valid() || sequence !== session.next || expectedCommittedCharacters !== session.committed || session.finished || session.journal.size >= 1000) {
      respond({...receipt, reason: 'ownership-lost'}); return;
    }
    if (message.type === 'claim') {
      if (sequence !== 0 || session.claimed) { respond(receipt); return; }
      session.claimed = true; session.expires = Date.now() + 600_000; session.next = 1;
      receipt.outcome = 'applied';
    } else {
      const text = message.text;
      if (!session.claimed || typeof text !== 'string' || typeof message.final !== 'boolean' || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text)) { respond(receipt); return; }
      const bytes = new TextEncoder().encode(text).length;
      if (bytes > MAX_BYTES || session.bytes + bytes > MAX_TOTAL) { respond({...receipt, reason: 'limit'}); return; }
      const e = session.element;
      if (text.includes('\r') || (e instanceof HTMLInputElement && text.includes('\n')) ||
          (e.maxLength >= 0 && session.value.length + text.length > e.maxLength)) { respond({...receipt, reason: 'unsupported-text'}); return; }
      const caret = session.caret, nextValue = session.value.slice(0, caret) + text + session.value.slice(caret);
      if (e instanceof HTMLInputElement && e.type === 'url' && /^[\t\n\f\r ]|[\t\n\f\r ]$/.test(nextValue)) {
        respond({...receipt, reason: 'unsupported-text'}); return;
      }
      // Run page veto handlers before checking the exact target again. Mutation itself
      // addresses this element, never whichever element is currently focused.
      let accepted;
      try {
        ownEvent = new InputEvent('beforeinput', {bubbles: true, cancelable: true, inputType: 'insertText', data: text});
        accepted = !text || e.dispatchEvent(ownEvent);
      } finally { ownEvent = null; }
      if (changedTarget(observer.takeRecords())) invalidate('element-changed');
      if (!accepted || !valid() || !deadlineValid()) { invalidate('field-changed'); respond({...receipt, reason: 'ownership-lost'}); return; }
      try {
        if (text) {
          const prototype = e instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          prototype.setRangeText.call(e, text, caret, caret, 'end');
        }
        session.value = nextValue; session.caret = caret + text.length;
        session.committed += Array.from(text).length; session.bytes += bytes; session.next++;
        receipt.outcome = 'applied'; receipt.committedCharacters = session.committed;
        session.finished = message.final;
        // Journal before notifying page code: a reentrant handler cannot replay a write.
        session.journal.set(sequence, {signature, receipt: {...receipt}});
        if (text) {
          ownEvent = new InputEvent('input', {bubbles: true, inputType: 'insertText', data: text});
          e.dispatchEvent(ownEvent); ownEvent = null;
        }
        if (!e.isConnected || e.value !== nextValue) {
          receipt.outcome = 'uncertain'; receipt.committedCharacters = expectedCommittedCharacters; invalidate('mutation-uncertain');
        }
      } catch (_) { receipt.outcome = 'uncertain'; receipt.committedCharacters = expectedCommittedCharacters; invalidate('mutation-uncertain'); }
      finally { ownEvent = null; }
      if (!valid()) invalidate('field-changed');
      if (session.finished) observer.disconnect();
    }
    session.journal.set(sequence, {signature, receipt: {...receipt}});
    respond(receipt);
  });
})();
