const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync('integrations/chromium/content.js', 'utf8');

function fixture() {
  const messages = [];
  const documentEvents = new Map();
  const windowEvents = new Map();
  let onMessage;
  const observation = { active: false, starts: 0, stops: 0 };
  class Textarea {
    constructor() {
      this.value = '';
      this.selectionStart = 0;
      this.selectionEnd = 0;
      this.isConnected = true;
      this.readOnly = false;
      this.autocomplete = '';
      this.parentNode = null;
    }
    matches() { return false; }
    closest() { return null; }
    dispatchEvent() { return true; }
  }
  class Input extends Textarea {}
  const element = new Textarea();
  const add = events => (name, listener) => events.set(name, listener);
  const document = { activeElement: element, hasFocus: () => true, addEventListener: add(documentEvents) };
  const window = { addEventListener: add(windowEvents) };
  const chrome = {
    runtime: {
      sendMessage(message) { messages.push(message); return Promise.resolve(); },
      onMessage: { addListener(listener) { onMessage = listener; } },
    },
  };
  class MutationObserver {
    observe() { observation.active = true; observation.starts += 1; }
    disconnect() { observation.active = false; observation.stops += 1; }
    takeRecords() { return []; }
  }
  vm.runInNewContext(source, { chrome, crypto: webcrypto, document, window, MutationObserver,
    HTMLTextAreaElement: Textarea, HTMLInputElement: Input, Uint8Array, TextEncoder,
    InputEvent: class InputEvent {} });
  onMessage({ type: 'arm' }, null, () => {});
  const hotkey = () => documentEvents.get('keydown')({ isTrusted: true, altKey: true, shiftKey: true,
    ctrlKey: false, metaKey: false, code: 'KeyV', repeat: false,
    preventDefault() {}, stopImmediatePropagation() {} });
  const receive = message => {
    let response;
    onMessage(message, null, value => { response = value; });
    return response;
  };
  return { messages, hotkey, documentEvents, windowEvents, observation, receive };
}

{
  const { messages, hotkey, documentEvents, windowEvents } = fixture();
  hotkey();
  const token = messages.find(message => message.type === 'trigger')?.token;
  assert.ok(token);
  documentEvents.get('focusout')();
  assert.equal(messages.filter(message => message.type === 'stop').length, 0,
    'ordinary focus loss only revokes insertion');
  windowEvents.get('pagehide')();
  assert.deepEqual(messages.filter(message => message.type === 'stop').map(message => message.token), [token],
    'page departure stops the original recording even after focus loss');
}
{
  const { messages, hotkey, windowEvents } = fixture();
  hotkey();
  windowEvents.get('pagehide')();
  assert.deepEqual(messages.map(message => message.type), ['trigger', 'invalidate', 'stop'],
    'page departure revokes insertion before requesting Stop');
}
{
  const { messages, hotkey, documentEvents } = fixture();
  hotkey();
  const token = messages.find(message => message.type === 'trigger').token;
  documentEvents.get('focusout')();
  hotkey();
  assert.deepEqual(messages.filter(message => message.type === 'stop').map(message => message.token), [token],
    'manual Stop still uses the original token after focus loss');
}
console.log('Chromium content lifecycle regression passed');

{
  const { messages, hotkey, documentEvents, observation, receive } = fixture();
  assert.equal(observation.active, false, 'idle armed pages do not observe unrelated page mutations');
  hotkey();
  assert.equal(observation.active, true, 'observe before asynchronous recognition and field claim');
  const { token, documentId } = messages.find(message => message.type === 'trigger');
  documentEvents.get('focusout')();
  assert.equal(observation.active, false, 'revoked fields release document observation');
  receive({ type: 'cancel', token, documentId });
  hotkey();
  assert.equal(observation.active, true, 'a new explicit session restores observation');
  assert.equal(observation.starts, 2);
  receive({ type: 'disarm' });
  assert.equal(observation.active, false, 'disabling the tab releases document observation');
}
{
  const { messages, hotkey, observation, receive } = fixture();
  hotkey();
  const { token, documentId } = messages.find(message => message.type === 'trigger');
  const common = { protocol: 1, token, documentId, expectedCommittedCharacters: 0, expiresAt: Date.now() + 1500 };
  assert.equal(receive({ ...common, type: 'claim', sequence: 0 }).outcome, 'applied');
  assert.equal(observation.active, true, 'claim retains security observation');
  assert.equal(receive({ ...common, type: 'append', sequence: 1, text: '', final: true }).outcome, 'applied');
  assert.equal(observation.active, false, 'successful finalization releases document observation');
  assert.equal(receive({ ...common, type: 'query', sequence: 1 }).outcome, 'applied', 'finished receipts remain queryable');
}
console.log('Chromium mutation observer lifecycle regressions passed');
