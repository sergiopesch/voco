// Universal paste into Chromium on the private X11 display. Every case pastes
// with the one production chord through fixtures/focused-paste.py and reads the
// result back from the page or the browser's own copy. Run only through
// scripts/test-application-delivery.sh.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

assert.equal(process.env.DISPLAY, ':0');
assert.ok(!existsSync('/dev/input'), 'Private fixture display required');
const output = process.argv[2];
const helper = fileURLToPath(new URL('fixtures/focused-paste.py', import.meta.url));
const paste = text => execFileSync('/usr/bin/python3', [helper, text], { stdio: ['ignore', 'inherit', 'inherit'], timeout: 40_000 });
// Test-only keys that focus and read back the address bar; delivery never sends these.
const key = (...keys) => execFileSync('xdotool', ['key', '--clearmodifiers', ...keys], { timeout: 5000 });
const browser = await chromium.launch({ executablePath: process.env.VOCO_DELIVERY_BROWSER, headless: false, args: ['--ozone-platform=x11'] });
const page = await browser.newPage();
const results = [];

const waitFor = async (read, expected, what) => {
  const deadline = performance.now() + 10_000;
  let value;
  while ((value = await read()) !== expected) {
    if (performance.now() > deadline) throw new Error(`${what}: expected ${JSON.stringify(expected)}, found ${JSON.stringify(value)}`);
    await page.waitForTimeout(50);
  }
};
// Rich editors may keep a trailing line-break element after the text.
const text = (selector = '#target') => page.locator(selector).evaluate(node => (node.value ?? node.innerText).replace(/\n+$/, ''));
// No window manager runs here; bringing the page to front also gives the
// browser window keyboard focus.
const setup = async html => {
  await page.setContent(html);
  await page.bringToFront();
  await page.locator('#target').click();
  await page.keyboard.press('Control+End');
};
const editor = html => `<div role="textbox" contenteditable="true" style="white-space:pre-wrap" id="target">${html}</div>`;
const chunks = async (pairs, read = text) => {
  for (const [chunk, expected] of pairs) {
    paste(chunk);
    await waitFor(read, expected, `After ${JSON.stringify(chunk)}`);
  }
};
const trial = async (name, run) => {
  const result = { name, status: 'failed' };
  results.push(result);
  try {
    await run();
    result.status = 'passed';
  } catch (error) {
    result.error = String(error?.message ?? error);
    await page.screenshot({ path: `${output}/${name.replace(/\W+/g, '-')}.png` }).catch(() => {});
  }
  console.log(JSON.stringify(result));
};

try {
  await trial('input field', async () => {
    await setup('<input id="target">');
    await chunks([['Hello', 'Hello'], [' Chromium.', 'Hello Chromium.']]);
  });
  await trial('textarea line break arrives as a space', async () => {
    await setup('<textarea id="target"></textarea>');
    await chunks([['one\ntwo', 'one two'], [' three', 'one two three']]);
  });
  for (const [name, html] of [['bare empty editor', ''], ['bare line break', '<br>'], ['empty block editor', '<div><br></div>']]) {
    await trial(name, async () => {
      await setup(editor(html));
      await chunks([['W', 'W'], ['elcome.', 'Welcome.']]);
    });
  }
  await trial('empty paragraph and subsequent chunks', async () => {
    await setup(editor('<p><br></p>'));
    await chunks([['Hello', 'Hello'], [' there,', 'Hello there,'], [' can you hear me?', 'Hello there, can you hear me?']]);
  });
  await trial('editor placeholder disappears during first paste', async () => {
    await setup(editor('<p><br><span contenteditable="false" id="placeholder">Message here</span></p>'));
    await page.keyboard.press('Control+Home');
    await page.evaluate(() => document.querySelector('#target').addEventListener('input', () => document.querySelector('#placeholder')?.remove()));
    await chunks([['Hello', 'Hello'], [' there', 'Hello there']]);
  });
  await trial('selection replacement', async () => {
    await setup(editor('<p>Before <b>bold</b> tail</p>'));
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await chunks([['replacement', 'Before bold replacement']]);
  });
  await trial('non-ASCII text', async () => {
    await setup(editor('<p>Café </p>'));
    await chunks([['👩‍💻 ready', 'Café 👩‍💻 ready']]);
  });
  await trial('the next chunk follows focus', async () => {
    await setup('<input id="target"><input id="other">');
    await chunks([['First', 'First']]);
    await page.locator('#other').click();
    await chunks([['Second', 'Second']], () => text('#other'));
    assert.equal(await text(), 'First');
  });
  // The address bar trims a pasted leading space, which is why the joining
  // space is its own key.
  await trial('address bar', async () => {
    key('ctrl+l', 'BackSpace');
    await chunks([['hello', 'hello'], [' linux', 'hello linux']], () => {
      // Replace the pasted clipboard first so an empty field cannot read back as the paste.
      execFileSync('xclip', ['-selection', 'clipboard', '-in'], { input: 'nothing copied', stdio: ['pipe', 'ignore', 'ignore'], timeout: 5000 });
      key('ctrl+a', 'ctrl+c', 'End');
      return execFileSync('xclip', ['-selection', 'clipboard', '-out'], { encoding: 'utf8', timeout: 5000 });
    });
  });
} finally {
  const pasteMode = process.env.VOCO_FIXTURE_PASTE_BINARY ? 'production' : 'replica';
  writeFileSync(`${output}/results.json`, JSON.stringify({ browser: browser.version(), paste: pasteMode, results }, null, 2) + '\n');
  await browser.close();
}
process.exitCode = results.length && results.every(result => result.status === 'passed') ? 0 : 1;
