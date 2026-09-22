import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'voco-exact-field-'));
const extension = path.join(temp, 'extension');
await fs.cp('integrations/chromium', extension, {recursive: true});
const manifest = JSON.parse(await fs.readFile(path.join(extension, 'manifest.json')));
assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'nativeMessaging']);
assert.equal(manifest.host_permissions, undefined);
// Harness-only localhost grant replaces a physical toolbar click. Production
// scripts run unchanged in the extension isolated world; no user profile is used.
manifest.host_permissions = ['http://127.0.0.1/*'];
await fs.writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
const server = http.createServer((_req, res) => res.end('<!doctype html><textarea id="a"></textarea><textarea id="b"></textarea><input id="single"><input id="password" type="password"><div contenteditable id="rich"></div>'));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const cargoTarget = path.resolve(process.env.CARGO_TARGET_DIR || 'apps/desktop/src-tauri/target');
const hostBinary = process.env.VOCO_BROWSER_HOST_BINARY || path.join(cargoTarget, 'debug/voco-browser-host');
const fixtureBinary = process.env.VOCO_BROWSER_FIXTURE_BINARY || path.join(cargoTarget, 'debug/examples/browser_broker_fixture');
const nativeMode = process.argv.includes('--native');
const runtime = path.join(temp, 'runtime'); await fs.mkdir(runtime, {mode: 0o700});
const isolatedEnv = {...process.env, HOME: temp, XDG_CONFIG_HOME: path.join(temp, 'config'), XDG_RUNTIME_DIR: runtime};
if (nativeMode) {
  for (const root of [path.join(temp, 'profile'), ...['chromium', 'google-chrome', 'google-chrome-for-testing'].map(d => path.join(isolatedEnv.XDG_CONFIG_HOME, d))]) {
    const hostDir = path.join(root, 'NativeMessagingHosts'); await fs.mkdir(hostDir, {recursive: true});
    await fs.writeFile(path.join(hostDir, 'com.voco.exact_field.json'), JSON.stringify({name: 'com.voco.exact_field', description: 'Isolated VOCO test host', type: 'stdio',
      path: hostBinary, allowed_origins: ['chrome-extension://dohnphckdenppjhdafmhefhomomodgcc/']}));
  }
}
const browser = await chromium.launchPersistentContext(path.join(temp, 'profile'), {
  executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
  env: isolatedEnv, headless: true, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
});
const results = [];
try {
  const worker = browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker');
  await worker.evaluate(() => { globalThis.testMessages = []; chrome.runtime.onMessage.addListener(message => { globalThis.testMessages.push(message); }); });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const tabId = await worker.evaluate(async () => (await chrome.tabs.query({})).find(t => t.url?.startsWith('http://127.0.0.1')).id);
  async function reset() {
    await page.reload();
    await worker.evaluate(async tabId => {
      globalThis.testMessages = [];
      await chrome.scripting.executeScript({target: {tabId}, files: ['content.js']});
      await chrome.tabs.sendMessage(tabId, {type: 'arm'});
    }, tabId);
    await page.locator('#a').focus();
  }
  async function trigger() {
    await page.keyboard.press('Alt+Shift+v');
    await page.waitForTimeout(30);
    const messages = await worker.evaluate(() => globalThis.testMessages);
    return messages.findLast(m => m.type === 'trigger');
  }
  async function request(token, type, extra = {}) {
    return worker.evaluate(async ({tabId, token, type, extra}) => chrome.tabs.sendMessage(tabId, {
      protocol: 1, expiresAt: Date.now() + 1500, requestId: 'request-' + type + (extra.sequence || 0), type,
      token: token.token, documentId: token.documentId, sequence: 0, expectedCommittedCharacters: 0, ...extra,
    }), {tabId, token, type, extra});
  }
  async function claim() { const token = await trigger(); assert.ok(token); assert.equal((await request(token, 'claim')).outcome, 'applied'); return token; }
  async function append(token, text, extra = {}) { return request(token, 'append', {sequence: 1, text, final: true, ...extra}); }
  async function test(name, fn) { await reset(); await fn(); results.push({name, passed: true}); }
  await test('unicode checkpoint, final, duplicate and query receipts', async () => {
    const t = await claim();
    const first = await append(t, 'Hi 🦊', {final: false}); assert.equal(first.outcome, 'applied'); assert.equal(first.committedCharacters, 4);
    assert.equal((await append(t, 'Hi 🦊', {final: false})).outcome, 'applied');
    assert.equal((await append(t, 'wrong', {final: false})).outcome, 'rejected');
    assert.equal(await page.locator('#a').inputValue(), 'Hi 🦊');
    assert.equal((await append(t, '!', {sequence: 2, expectedCommittedCharacters: 4})).committedCharacters, 5);
    assert.equal((await request(t, 'query', {sequence: 2})).outcome, 'applied');
    assert.equal(await page.locator('#a').inputValue(), 'Hi 🦊!');
  });
  for (const phase of ['claim', 'append']) await test(`${phase}: A to B to A invalidates`, async () => {
    const t = phase === 'claim' ? await trigger() : await claim();
    await page.locator('#b').focus(); await page.locator('#a').focus();
    const r = phase === 'claim' ? await request(t, 'claim') : await append(t, 'unsafe');
    assert.equal(r.outcome, 'rejected'); assert.equal(await page.locator('#a').inputValue(), ''); assert.equal(await page.locator('#b').inputValue(), '');
  });
  for (const attack of ['focus', 'replace', 'value', 'select', 'veto']) await test(`beforeinput ${attack} vetoes mutation`, async () => {
    const t = await claim();
    await page.evaluate(attack => document.querySelector('#a').addEventListener('beforeinput', event => {
      const a = event.target;
      if (attack === 'focus') document.querySelector('#b').focus();
      if (attack === 'replace') a.replaceWith(a.cloneNode());
      if (attack === 'value') a.value = 'page edit';
      if (attack === 'select') { a.value = 'abc'; a.setSelectionRange(0, 2); }
      if (attack === 'veto') event.preventDefault();
    }), attack);
    assert.equal((await append(t, 'unsafe')).outcome, 'rejected');
    assert.ok(!(await page.locator('#a').inputValue()).includes('unsafe')); assert.equal(await page.locator('#b').inputValue(), '');
  });
  await test('input handler focus switch cannot redirect committed text', async () => {
    const t = await claim();
    await page.evaluate(() => document.querySelector('#a').addEventListener('input', () => document.querySelector('#b').focus()));
    assert.equal((await append(t, 'safe', {final: false})).outcome, 'applied');
    assert.equal(await page.locator('#a').inputValue(), 'safe'); assert.equal(await page.locator('#b').inputValue(), '');
    assert.equal((await append(t, 'unsafe', {sequence: 2, expectedCommittedCharacters: 4})).outcome, 'rejected');
  });
  await test('input handler rewrite produces uncertainty, never retry', async () => {
    const t = await claim();
    await page.evaluate(() => document.querySelector('#a').addEventListener('input', e => { e.target.value = 'page owns this'; }));
    assert.equal((await append(t, 'test')).outcome, 'uncertain');
    assert.equal((await append(t, 'test')).outcome, 'uncertain');
    assert.equal(await page.locator('#a').inputValue(), 'page owns this');
  });
  await test('navigation invalidates old document token', async () => {
    const t = await claim(); await reset();
    assert.equal(await append(t, 'unsafe'), null); assert.equal(await page.locator('#a').inputValue(), '');
  });
  await test('external element replacement invalidates', async () => {
    const t = await claim(); await page.evaluate(() => { const a = document.querySelector('#a'); a.replaceWith(a.cloneNode()); document.querySelector('#a').focus(); });
    assert.equal((await append(t, 'unsafe')).outcome, 'rejected');
  });
  await test('held hotkey repeats do not stop recording', async () => {
    await page.keyboard.down('Alt'); await page.keyboard.down('Shift'); await page.keyboard.down('v'); await page.keyboard.down('v');
    await page.keyboard.up('v'); await page.keyboard.up('Shift'); await page.keyboard.up('Alt');
    const messages = await worker.evaluate(() => globalThis.testMessages);
    assert.equal(messages.filter(m => m.type === 'trigger').length, 1); assert.equal(messages.filter(m => m.type === 'stop').length, 0);
  });
  for (const selector of ['#password', '#rich']) await test(`reject ${selector}`, async () => { await page.locator(selector).focus(); assert.equal(await trigger(), undefined); });
  await test('selected text is not replaced', async () => { await page.locator('#a').fill('keep'); await page.locator('#a').selectText(); assert.equal(await trigger(), undefined); });
  await test('stop retains invalidated token', async () => {
    const t = await claim(); await page.locator('#b').focus(); await page.keyboard.press('Alt+Shift+v');
    const stops = await worker.evaluate(() => globalThis.testMessages.filter(m => m.type === 'stop'));
    assert.equal(stops[0].token, t.token); assert.equal(await page.locator('#b').inputValue(), '');
  });
  await test('focus loss keeps recording Stop explicit; pagehide stops its original token', async () => {
    const t = await claim(); await page.locator('#b').focus();
    assert.equal((await worker.evaluate(() => globalThis.testMessages.filter(m => m.type === 'stop'))).length, 0);
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide')));
    await page.waitForTimeout(30);
    const stops = await worker.evaluate(() => globalThis.testMessages.filter(m => m.type === 'stop'));
    assert.deepEqual(stops.map(m => m.token), [t.token]);
    assert.equal((await append(t, 'unsafe')).outcome, 'rejected');
    assert.equal(await page.locator('#b').inputValue(), '');
  });
  await test('same element removed and reinserted invalidates permanently', async () => {
    const t = await claim(); await page.evaluate(() => { const a = document.querySelector('#a'); const parent = a.parentNode; a.remove(); parent.prepend(a); a.focus(); });
    assert.equal((await append(t, 'unsafe')).outcome, 'rejected'); assert.equal(await page.locator('#a').inputValue(), '');
  });
  for (const attribute of ['inert', 'data-voco-private']) await test(`ancestor ${attribute} toggled and restored invalidates`, async () => {
    const t = await claim(); await page.evaluate(attribute => { const parent = document.querySelector('#a').parentElement; parent.setAttribute(attribute, ''); parent.removeAttribute(attribute); }, attribute);
    assert.equal((await append(t, 'unsafe')).outcome, 'rejected'); assert.equal(await page.locator('#a').inputValue(), '');
  });
  await test('inherited disabled fieldset rejects insertion', async () => {
    await page.evaluate(() => { const a = document.querySelector('#a'); const fieldset = document.createElement('fieldset'); a.replaceWith(fieldset); fieldset.append(a); a.focus(); });
    const t = await claim();
    await page.evaluate(() => document.querySelector('#a').addEventListener('beforeinput', () => { document.querySelector('fieldset').disabled = true; }));
    assert.equal((await append(t, 'unsafe')).outcome, 'rejected');
    assert.equal(await page.locator('#a').evaluate(e => e.disabled), false); assert.equal(await page.locator('#a').inputValue(), '');
  });
  await test('unrelated DOM mutations preserve exact recipient', async () => {
    const t = await claim(); await page.evaluate(() => { const sibling = document.createElement('div'); document.body.append(sibling); sibling.remove(); });
    assert.equal((await append(t, 'safe')).outcome, 'applied'); assert.equal(await page.locator('#a').inputValue(), 'safe');
  });
  await test('ordinary input invalidates', async () => { const t = await claim(); await page.keyboard.type('user'); assert.equal((await append(t, 'unsafe')).outcome, 'rejected'); });
  await test('blocked beforeinput cannot write after native deadline', async () => {
    const t = await claim();
    await page.evaluate(() => document.querySelector('#a').addEventListener('beforeinput', () => { const end = performance.now() + 1700; while (performance.now() < end) {} }));
    assert.equal((await append(t, 'unsafe')).outcome, 'rejected'); assert.equal(await page.locator('#a').inputValue(), '');
  });
  await test('missing or stale deadline rejects before mutation', async () => {
    const t = await claim(); assert.equal((await append(t, 'unsafe', {expiresAt: Date.now() - 1})).outcome, 'rejected'); assert.equal(await page.locator('#a').inputValue(), '');
  });
  await test('rejected claim retains stop until terminal cancel then accepts fresh trigger', async () => {
    const t = await trigger(); await page.locator('#b').focus(); await page.locator('#a').focus();
    assert.equal((await request(t, 'claim')).outcome, 'rejected');
    await page.keyboard.press('Alt+Shift+v');
    assert.equal((await worker.evaluate(() => globalThis.testMessages.findLast(m => m.type === 'stop'))).token, t.token);
    await request(t, 'cancel'); const next = await trigger(); assert.notEqual(next.token, t.token);
    assert.equal((await request(next, 'claim')).outcome, 'applied');
    assert.equal((await append(next, 'fresh')).outcome, 'applied'); assert.equal(await page.locator('#a').inputValue(), 'fresh');
  });
  await test('delivery revocation rejects writes but retains repeated Stop until release', async () => {
    const t = await claim();
    await request(t, 'revoke');
    assert.equal((await append(t, 'unsafe', {final:false})).outcome, 'rejected');
    await page.locator('#b').focus();
    await page.keyboard.press('Alt+Shift+v'); await page.keyboard.press('Alt+Shift+v');
    const messages = await worker.evaluate(() => globalThis.testMessages);
    assert.equal(messages.filter(m => m.type === 'trigger').length, 1);
    assert.deepEqual(messages.filter(m => m.type === 'stop').map(m => m.token), [t.token,t.token]);
    assert.equal(await page.locator('#a').inputValue(), ''); assert.equal(await page.locator('#b').inputValue(), '');
    await request(t, 'cancel');
    const next = await trigger(); assert.notEqual(next.token, t.token);
  });
  await test('disarm after delivery revocation retains the original Stop token', async () => {
    const t = await claim(); await request(t, 'revoke');
    const response = await worker.evaluate(tabId => chrome.tabs.sendMessage(tabId, {type:'disarm'}), tabId);
    assert.equal(response.stopToken, t.token);
  });
  await test('disarm and re-arm starts fresh token', async () => {
    const t = await claim();
    await worker.evaluate(async tabId => { await chrome.tabs.sendMessage(tabId, {type: 'disarm'}); await chrome.tabs.sendMessage(tabId, {type: 'arm'}); }, tabId);
    const next = await trigger(); assert.notEqual(next.token, t.token);
  });
  await test('single-line newline rejects; textarea newline is exact', async () => {
    await page.locator('#single').focus(); const t = await claim();
    assert.equal((await append(t, 'a\nb')).outcome, 'rejected'); assert.equal(await page.locator('#single').inputValue(), '');
    await request(t, 'cancel'); await page.locator('#a').focus(); const next = await claim();
    assert.equal((await append(next, 'a\nb')).outcome, 'applied'); assert.equal(await page.locator('#a').inputValue(), 'a\nb');
  });
  for (const type of ['text', 'search', 'tel', 'url', 'textarea']) {
    for (const code of [0, 9, 10, 11, 12, 13, 32, 127, 160, 0x2028, 0x2029]) {
      for (const position of ['leading', 'middle', 'trailing']) {
        await test(`${type} codepoint ${code} at ${position}: exact value or preflight rejection`, async () => {
          const selector = type === 'textarea' ? '#a' : '#single';
          const initial = 'AB', caret = position === 'leading' ? 0 : position === 'middle' ? 1 : 2;
          const text = String.fromCodePoint(code), expected = initial.slice(0, caret) + text + initial.slice(caret);
          const browserNormalizes = await page.evaluate(({selector, type, initial, caret, text, expected}) => {
            const e = document.querySelector(selector); if (type !== 'textarea') e.type = type;
            e.value = initial; e.focus(); e.setSelectionRange(caret, caret);
            const probe = document.createElement(type === 'textarea' ? 'textarea' : 'input');
            if (type !== 'textarea') probe.type = type;
            probe.value = initial; probe.setRangeText(text, caret, caret, 'end');
            return probe.value !== expected;
          }, {selector, type, initial, caret, text, expected});
          const t = await claim(); const receipt = await append(t, text);
          assert.equal(receipt.outcome, browserNormalizes ? 'rejected' : 'applied');
          assert.equal(await page.locator(selector).inputValue(), browserNormalizes ? initial : expected);
        });
      }
    }
  }
  await test('URL whitespace normalization rejects before touching target', async () => {
    await page.locator('#single').evaluate(e => e.type = 'url'); await page.locator('#single').focus(); const t = await claim();
    assert.equal((await append(t, ' hello ')).outcome, 'rejected'); assert.equal(await page.locator('#single').inputValue(), '');
  });
  await test('empty final preserves prior committed count', async () => {
    const t = await claim(); assert.equal((await append(t, 'one', {final: false})).committedCharacters, 3);
    assert.equal((await append(t, '', {sequence: 2, expectedCommittedCharacters: 3})).committedCharacters, 3);
    assert.equal(await page.locator('#a').inputValue(), 'one');
  });
  await test('maxlength is respected without partial insertion', async () => {
    await page.locator('#a').evaluate(e => e.maxLength = 2); const t = await claim();
    assert.equal((await append(t, 'long')).outcome, 'rejected'); assert.equal(await page.locator('#a').inputValue(), '');
  });
  for (const attribute of ['readonly', 'data-voco-private']) await test(`${attribute} rejects target`, async () => {
    await page.locator('#a').evaluate((e, attribute) => e.setAttribute(attribute, ''), attribute);
    assert.equal(await trigger(), undefined);
  });
  await test('carriage return is rejected before mutation', async () => { const t = await claim(); assert.equal((await append(t, 'a\rb')).outcome, 'rejected'); assert.equal(await page.locator('#a').inputValue(), ''); });
  await test('UTF8 limit is enforced before mutation', async () => { const t = await claim(); assert.equal((await append(t, '🦊'.repeat(25_001))).outcome, 'rejected'); assert.equal(await page.locator('#a').inputValue(), ''); });
  await test('claim expires after two seconds', async () => { const t = await trigger(); await page.waitForTimeout(2100); assert.equal((await request(t, 'claim')).outcome, 'rejected'); });
  if (nativeMode) for (const nativeCase of ['applied', 'focus-loss', 'disable']) {
    const reject = nativeCase !== 'applied';
    await reset();
    const log = path.join(temp, `broker-${nativeCase}.jsonl`);
    const fixture = spawn(fixtureBinary, [log, reject ? '750' : '0', ...(reject ? ['rejected'] : [])], {env: isolatedEnv, stdio: ['ignore', 'pipe', 'pipe']});
    let errors = ''; fixture.stderr.on('data', data => { errors += data.toString(); });
    const exited = new Promise(resolve => fixture.on('exit', resolve));
    try {
      for (let i = 0; i < 100; i++) { if ((await fs.readFile(log, 'utf8').catch(() => '')).includes('ready')) break; await new Promise(r => setTimeout(r, 20)); }
      await worker.evaluate(async tabId => { await enableTab(await chrome.tabs.get(tabId)); }, tabId);
      if (!await worker.evaluate(() => ready)) assert.fail('actual native host handshake: ' + await worker.evaluate(async () => new Promise(resolve => { const p = chrome.runtime.connectNative('com.voco.exact_field'); p.onDisconnect.addListener(() => resolve(chrome.runtime.lastError?.message)); p.onMessage.addListener(m => { resolve(m); p.disconnect(); }); p.postMessage({protocol:1,type:'hello',client:'chromium',capabilities:['plain-text-atomic-v1']}); })));
      await page.locator('#a').focus(); await page.keyboard.press('Alt+Shift+v');
      if (reject) {
        for (let i = 0; i < 100; i++) { if ((await fs.readFile(log, 'utf8')).includes('claim')) break; await new Promise(r => setTimeout(r, 10)); }
        if (nativeCase === 'disable') {
          await worker.evaluate(async tabId => enableTab(await chrome.tabs.get(tabId)), tabId);
          assert.equal(await worker.evaluate(tabId => chrome.action.getBadgeText({tabId}), tabId), '');
        } else { await page.locator('#b').focus(); await page.locator('#a').focus(); }
      }
      const outcome = await Promise.race([exited, new Promise(resolve => { const timer = setTimeout(() => resolve('timeout'), 15_000); timer.unref(); })]);
      assert.equal(outcome, 0, errors || await fs.readFile(log, 'utf8'));
      assert.equal(await page.locator('#a').inputValue(), reject ? '' : 'Native café 🦀 你好.');
      assert.equal(await page.locator('#b').inputValue(), '');
      results.push({name: nativeCase === 'disable' ? 'toolbar toggle disarms real content and stops exact native session' : reject ? 'actual native host rejects A to B to A after claim' : 'actual native host and Rust broker claim plus Unicode append', passed: true, broker: (await fs.readFile(log, 'utf8')).trim().split('\n').map(JSON.parse)});
    } finally { if (fixture.exitCode === null) fixture.kill(); }
    for (let i = 0; i < 100 && await worker.evaluate(() => ready); i++) await page.waitForTimeout(10);
  }
  const sourceHashes = Object.fromEntries(await Promise.all(['manifest.json', 'content.js', 'background.js'].map(async file => [file, crypto.createHash('sha256').update(await fs.readFile(`integrations/chromium/${file}`)).digest('hex')])));
  console.log(JSON.stringify({sourceHashes, browser: browser.browser().version(), productionPermissions: manifest.permissions, harnessOnlyHostGrant: 'http://127.0.0.1/*', tests: results}, null, 2));
} finally { await browser.close(); server.close(); await fs.rm(temp, {recursive: true, force: true}); }
