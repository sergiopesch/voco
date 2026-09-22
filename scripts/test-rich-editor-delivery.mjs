// Real Chromium + AT-SPI + clipboard, exclusively inside the private desktop wrapper.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

assert.equal(process.env.DISPLAY, ':0');
assert.ok(process.env.HOME.startsWith('/tmp/voco-rich-editor-'));
const output = process.argv[2];
const platform = process.env.VOCO_RICH_EDITOR_PLATFORM || 'x11';
assert.ok(['x11', 'wayland'].includes(platform));
const helperPath = process.env.VOCO_RICH_EDITOR_HELPER || fileURLToPath(new URL('../apps/desktop/src-tauri/resources/voco_desktop_target.py', import.meta.url));
const helper = spawn('/usr/bin/python3', ['-u', helperPath, '--serve'], { stdio: ['pipe', 'pipe', 'inherit'] });
let sequence = 0;
let resolveResponse;
createInterface({ input: helper.stdout }).on('line', line => resolveResponse?.(JSON.parse(line)));
async function request(body) {
  const seq = sequence++;
  let timeout;
  try {
    const result = await new Promise((resolve, reject) => {
      resolveResponse = resolve;
      timeout = setTimeout(() => reject(new Error('Accessibility helper deadline exceeded')), 4000);
      helper.stdin.write(JSON.stringify({ ...body, seq }) + '\n');
    });
    assert.equal(result.seq, seq);
    return result;
  } finally { clearTimeout(timeout); resolveResponse = undefined; }
}
const browser = await chromium.launch({ executablePath: process.env.VOCO_RICH_EDITOR_BROWSER, headless: false, args: [`--ozone-platform=${platform}`, '--force-renderer-accessibility'] });
const results = [];
let clipboard;
try {
  const page = await browser.newPage();
  if (platform === 'wayland') {
    await page.waitForTimeout(700);
    const windows = execFileSync('xdotool', ['search', '--pid', process.env.VOCO_RICH_EDITOR_SHELL_PID], { encoding: 'utf8' }).trim().split('\n');
    execFileSync('xdotool', ['windowfocus', windows[0], 'key', 'Escape'], { timeout: 3000 });
    await page.waitForTimeout(200);
  }
  const setup = async html => {
    await page.setContent(`<div role="textbox" aria-label="Message" contenteditable="true" style="white-space:pre-wrap" id="target">${html}</div><input id="other" aria-label="Other field">`);
    await page.locator('#target').click();
    await page.keyboard.press('Control+End');
    await page.bringToFront();
    await page.waitForTimeout(100);
    for (let i = 0; i < 30; i++) {
      if ((await request({ op: 'probe' })).scope === 'control') return;
      await page.waitForTimeout(20);
    }
    throw new Error('Fixture did not expose a focused editable control');
  };
  const prepare = async (text, first = true) => {
    const target = await request({ op: 'probe' });
    assert.equal(target.scope, 'control');
    const prepared = await request({ op: 'prepare', text, first_delivery: first, expected_token: target.token });
    assert.equal(prepared.observation, 'prepared');
    return prepared;
  };
  const nativeKey = value => execFileSync('xdotool', ['key', '--clearmodifiers', value], { timeout: 3000 });
  let browserChrome = false;
  const paste = async text => {
    // Match insertion.rs: address bars strip a pasted joining space, so the
    // production gesture sends that single separator before Ctrl+V.
    const nativeGesture = browserChrome || platform === 'wayland';
    const leadingSeparator = nativeGesture && /^ \S/u.test(text);
    clipboard?.kill();
    const clipboardEnv = platform === 'wayland' ? { ...process.env,
      DISPLAY: process.env.VOCO_RICH_EDITOR_CLIPBOARD_DISPLAY,
      XAUTHORITY: process.env.VOCO_RICH_EDITOR_CLIPBOARD_XAUTHORITY } : process.env;
    clipboard = spawn('xclip', ['-selection', 'clipboard', '-in', '-quiet'], { stdio: ['pipe', 'ignore', 'pipe'], env: clipboardEnv });
    const owner = clipboard;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Clipboard fixture deadline exceeded')), 2000);
      owner.stderr.once('data', data => {
        clearTimeout(timer);
        if (data.toString().includes('Waiting for selection requests')) resolve();
        else reject(new Error(`Clipboard fixture was not ready: ${data}`));
      });
      owner.once('error', error => { clearTimeout(timer); reject(error); });
      owner.once('exit', code => { if (code) { clearTimeout(timer); reject(new Error(`Clipboard fixture exited ${code}`)); } });
      owner.stdin.end(leadingSeparator ? text.slice(1) : text);
    });
    if (nativeGesture) execFileSync('xdotool', ['key', '--clearmodifiers', ...(leadingSeparator ? ['space'] : []), 'ctrl+v'], { timeout: 3000 });
    else await page.keyboard.press('Control+v');
  };
  const verify = async receipt => {
    const started = performance.now();
    let result;
    do {
      result = await request({ op: 'verify', receipt_id: receipt.receipt_id });
      if (result.observation !== 'pending') return { observation: result.observation, waitMs: performance.now() - started };
      await page.waitForTimeout(15);
    } while (performance.now() - started < 3000);
    return { observation: 'timeout', waitMs: performance.now() - started };
  };
  const delivery = async (text, first = true) => {
    const started = performance.now();
    const receipt = await prepare(text, first);
    const preparedAt = performance.now();
    await paste((receipt.added_separator ? ' ' : '') + text);
    const dispatchedAt = performance.now();
    const result = await verify(receipt);
    assert.equal(result.observation, 'observed');
    return { ...result, prepareMs: preparedAt - started, dispatchMs: dispatchedAt - preparedAt, totalMs: performance.now() - started };
  };
  const waitForAccessiblePosition = async (count, caret) => {
    // The browser can finish a DOM selection change before AT-SPI publishes it.
    // Settle the negative-case fixture using a separate read-only client; never
    // replace the production helper's outstanding delivery receipt.
    const probe = `import importlib.util,json,sys
spec=importlib.util.spec_from_file_location('target',sys.argv[1])
h=importlib.util.module_from_spec(spec);spec.loader.exec_module(h)
r=h.safe_probe()
print(json.dumps(h.text_position(h.TRACKER.hint)[1][:2] if r['scope']=='control' else None))`;
    for (let i = 0; i < 30; i++) {
      const position = JSON.parse(execFileSync('/usr/bin/python3', ['-c', probe, helperPath], { encoding: 'utf8', timeout: 2000 }));
      if (position?.[0] === count && position?.[1] === caret) return;
      await page.waitForTimeout(20);
    }
    throw new Error('Accessibility position did not settle before the negative case');
  };
  const trial = async (name, run) => {
    const result = { name, passed: false }; results.push(result);
    Object.assign(result, await run()); result.passed = true;
    console.log(`${name}: passed`);
  };
  for (const [name, html] of [['bare empty editor', ''], ['bare line break', '<br>'], ['empty block editor', '<div><br></div>']]) {
    await trial(name, async () => {
      await setup(html);
      const timings = [await delivery('W'), await delivery('elcome.', false)];
      assert.equal(await page.locator('#target').innerText(), 'Welcome.');
      return { timings };
    });
  }
  await trial('empty paragraph, first word, subsequent chunks and second session', async () => {
    await setup('<p><br></p>');
    const timings = [];
    for (const [index, text] of ['Hello', ' there,', ' can you hear me?'].entries()) timings.push(await delivery(text, index === 0));
    timings.push(await delivery('Another sentence.'));
    assert.equal(await page.locator('#target').innerText(), 'Hello there, can you hear me? Another sentence.');
    return { timings };
  });
  await trial('editor placeholder disappears during first paste', async () => {
    await setup('<p><br><span contenteditable="false" id="placeholder">Message here</span></p>');
    await page.keyboard.press('Control+Home');
    await page.waitForTimeout(100);
    await page.evaluate(() => document.querySelector('#target').addEventListener('input', () => document.querySelector('#placeholder')?.remove()));
    const timings = [await delivery('Hello'), await delivery(' there', false)];
    assert.equal((await page.locator('#target').innerText()).trim(), 'Hello there');
    return { timings };
  });
  await trial('formatted paragraph and selection replacement', async () => {
    await setup('<p>Before <b>bold</b> tail</p>');
    await page.keyboard.press('Control+Shift+ArrowLeft');
    await page.waitForTimeout(100);
    const result = await delivery('replacement');
    assert.equal(await page.locator('#target').innerText(), 'Before bold replacement');
    return result;
  });
  await trial('non-ASCII characters preserve accessible offsets', async () => {
    await setup('<p>Café </p>');
    const result = await delivery('👩‍💻 ready', false);
    assert.equal(await page.locator('#target').innerText(), 'Café 👩‍💻 ready');
    return result;
  });
  for (const paragraphs of [1, 1000]) await trial(`bounded caret lookup with ${paragraphs} paragraphs`, async () => {
    await setup('<p>Existing paragraph.</p>'.repeat(paragraphs));
    const timings = [];
    for (let i = 0; i < 5; i++) timings.push(await delivery(' More text.'));
    assert.equal(await page.locator('#target p').last().innerText(), 'Existing paragraph.' + ' More text.'.repeat(5));
    return { timings };
  });
  await trial('paragraph departure rejects receipt', async () => {
    await setup('<p>First.</p><p>Second.</p>');
    const receipt = await prepare(' More.'); await paste(' More.');
    await page.keyboard.press('Control+Home');
    await waitForAccessiblePosition(2, 0);
    assert.equal((await verify(receipt)).observation, 'changed');
  });
  await trial('focus departure rejects receipt without replay', async () => {
    await setup('<p><br></p>');
    const receipt = await prepare('Hello'); await paste('Hello');
    await page.locator('#other').focus();
    await waitForAccessiblePosition(0, 0);
    assert.equal((await verify(receipt)).observation, 'changed');
    assert.equal(await page.locator('#other').inputValue(), '');
    assert.equal(await page.locator('#target').innerText(), 'Hello');
  });
  await trial('wrong text fails closed', async () => {
    await setup('<p><br></p>');
    const receipt = await prepare('Hello'); await paste('Other');
    assert.equal((await verify(receipt)).observation, 'changed');
  });
  await trial('cross-paragraph selection is rejected before paste', async () => {
    await setup('<p>First.</p><p>Second.</p>'); await page.keyboard.press('Control+a');
    await page.waitForTimeout(100);
    const target = await request({ op: 'probe' });
    const result = await request({ op: 'prepare', text: 'Replacement', first_delivery: true, expected_token: target.token });
    assert.equal(result.observation, 'unsupported');
    assert.equal(await page.locator('#target p').count(), 2);
  });
  browserChrome = true;
  const focusAddress = async (value = '') => {
    nativeKey('Escape'); nativeKey('ctrl+l'); nativeKey('BackSpace');
    if (value) execFileSync('xdotool', ['type', '--clearmodifiers', value], { timeout: 3000 });
    await page.waitForTimeout(100);
    for (let i = 0; i < 30; i++) {
      if ((await request({ op: 'probe' })).scope === 'control') return;
      await page.waitForTimeout(20);
    }
    throw new Error('Address bar did not expose a focused editable control');
  };
  await trial('cold subprocess discovers address bar before and during suggestions', async () => {
    const coldProbeMs = [];
    for (const value of ['', 'Welcome']) {
      await focusAddress(value);
      const started = performance.now();
      const result = JSON.parse(execFileSync('/usr/bin/python3',
        ['-u', '-c', readFileSync(helperPath, 'utf8'), '--serve'], {
          input: '{"seq":1,"op":"probe"}\n', encoding: 'utf8', timeout: 1500,
        }));
      coldProbeMs.push(performance.now() - started);
      assert.equal(result.seq, 1);
      assert.equal(result.scope, 'control', JSON.stringify({value, ...result}));
      assert.equal(result.input_state, 'editable');
    }
    return { coldProbeMs };
  });
  await trial('address bar suggestions preserve first and subsequent receipts', async () => {
    await focusAddress();
    const timings = [await delivery('W'), await delivery('elcome', false), await delivery(' home', false)];
    nativeKey('Escape');
    timings.push(await delivery(' again', false));
    return { timings };
  });
  await trial('address bar selection replacement and end insertion', async () => {
    await focusAddress('https://example.com'); nativeKey('ctrl+a');
    const timings = [await delivery('Search this')];
    nativeKey('End'); timings.push(await delivery(' next', false));
    return { timings };
  });
  await trial('address bar departure rejects delivery without replay', async () => {
    await focusAddress();
    const receipt = await prepare('Hello'); await paste('Hello');
    nativeKey('Escape');
    await page.locator('#other').click();
    await waitForAccessiblePosition(0, 0);
    assert.equal((await verify(receipt)).observation, 'changed');
    assert.equal(await page.locator('#other').inputValue(), '');
  });
} finally {
  writeFileSync(`${output}/results.json`, JSON.stringify({ browser: browser.version(), platform, results }, null, 2) + '\n');
  clipboard?.kill(); helper.kill(); await browser.close();
}
