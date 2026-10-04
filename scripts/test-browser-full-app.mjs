import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {scoreLongDelivery} from './browser-long-accuracy.mjs';
import {browserCaptureStopEvidence} from './browser-capture-lifecycle.mjs';
import {longCapture, root, results, longPlan, origin, browser, page, worker, tabId, delay, traces, start, until, launch, playFixture, shortCase, failed, finish} from './browser-app-harness.mjs';
await start({grantLocalHostPermission: true});
const enable = () => worker.evaluate(async tabId=>enableTab(await chrome.tabs.get(tabId)),tabId);
async function disconnectStagedNativeHost() {
  // Closing the extension-side Port does not fire its own onDisconnect event.
  // Terminate the remote native host to exercise the real reconnect boundary.
  const executable = `${root}/voco-browser-host`;
  const candidates = (await Promise.all((await fs.readdir('/proc'))
    .filter(entry => /^\d+$/.test(entry))
    .map(async entry => (await fs.readlink(`/proc/${entry}/exe`).catch(() => null)) === executable
      ? Number(entry) : null))).filter(pid => pid !== null);
  assert.equal(candidates.length, 1, 'exactly one staged native host in the private PID namespace');
  process.kill(candidates[0], 'SIGTERM');
  await until(() => worker.evaluate(() => native === null && ready === false),
    'native host loss reaches the production disconnect handler');
}
try {
  await launch();
  await shortCase(enable, false);
  if (longCapture) {
    await page.reload(); await page.bringToFront();
    await enable();
    await page.locator('#a').focus();
    const traceStart=(await traces()).length;
    await page.keyboard.press('Alt+Shift+v');
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='recording_state_active'),'long real microphone recording');
    const player=await playFixture(`${root}/long.wav`);
    await until(async()=> (await page.locator('#a').inputValue()).length > 0,'long live browser prefix',30_000);
    assert.equal(player.record?.exitCode, undefined);
    assert.equal(await player.done,0);
    await delay(600); await page.keyboard.press('Alt+Shift+v');
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_stop_to_idle'),'long stream returns idle',45_000);
    const text=await page.locator('#a').inputValue();
    const report=scoreLongDelivery(longPlan,text,'');
    await fs.writeFile(`${root}/evidence/long-accuracy.json`,JSON.stringify({plan:longPlan,text,...report},null,2));
    assert.ok(report.passed,`Complete browser transcript must satisfy the frozen full-reference WER and repetition checks: ${report.failures.join('; ')}`);
    assert.equal(await page.locator('#b').inputValue(),'');
    results.push({case:'full-reference-long-stream',passed:report.passed,score:report.score,events:(await traces()).slice(traceStart).map(t=>t.event)});
    await page.screenshot({path:`${root}/evidence/long-delivery.png`});
  }
  await shortCase(enable, true);
  // Nothing waits in VOCO after focus loss, so the next recording starts directly.
  await shortCase(enable, false, true);

  // Exercise terminal browser lifetime with real capture and native receipts.
  // Unit tests cannot prove that the packaged renderer actually stops its mic.
  for (const departure of ['navigation', 'tab-close', 'native-disconnect']) {
    const recipient = await browser.newPage();
    const url = `${origin}/?lifetime=${departure}`;
    await recipient.goto(url); await recipient.bringToFront();
    const recipientId = await worker.evaluate(async url =>
      (await chrome.tabs.query({})).find(tab => tab.url === url).id, url);
    await worker.evaluate(async id => enableTab(await chrome.tabs.get(id)), recipientId);
    await recipient.locator('#a').focus();
    const sourceOutputs = () => JSON.parse(execFileSync(process.env.VOCO_BROWSER_PACTL || 'pactl',
      ['--format=json', 'list', 'source-outputs'], {encoding: 'utf8'}));
    const activeSources = () => sourceOutputs().filter(output => output.corked === false).map(output => output.index);
    const baselineSources = activeSources();
    const traceStart = (await traces()).length;
    await recipient.keyboard.press('Alt+Shift+v');
    await until(async () => (await traces()).slice(traceStart).some(row =>
      row.event === 'recording_state_active'), `${departure}: recording starts`);
    const recording = (await traces()).slice(traceStart).find(row => row.event === 'recording_state_active');
    assert.ok(Number.isSafeInteger(recording.dictation_session_id));
    let recordingSources;
    await until(() => {
      recordingSources = activeSources().filter(index => !baselineSources.includes(index));
      return recordingSources.length > 0;
    }, `${departure}: private Pulse observes active capture`);
    const playback = await playFixture('tests/fixtures/speech/84-121123-0000.wav');
    await until(async () => (await recipient.locator('#a').inputValue()).length > 0,
      `${departure}: live prefix arrives`);
    if (departure === 'navigation') await recipient.goto(url + '&departed=1');
    else if (departure === 'tab-close') await recipient.close();
    else await disconnectStagedNativeHost();
    let captureStop;
    await until(async () => {
      captureStop = browserCaptureStopEvidence((await traces()).slice(traceStart), recording.dictation_session_id);
      return captureStop !== null;
    }, `${departure}: capture tears down and recording ends`, 15_000);
    let afterSources;
    await until(() => {
      afterSources = activeSources();
      return recordingSources.every(index => !afterSources.includes(index)) &&
        afterSources.every(index => baselineSources.includes(index));
    }, `${departure}: private Pulse confirms capture release`, 5_000);
    assert.equal(await playback.done, 0);
    if (departure === 'navigation') assert.equal(await recipient.locator('#a').inputValue(), '');
    if (!recipient.isClosed()) assert.equal(await recipient.locator('#b').inputValue(), '');
    const stopped = (await traces()).slice(traceStart);
    assert.equal(stopped.filter(row => row.event === 'recording_state_active').length, 1);
    if (!recipient.isClosed()) await recipient.close();
    results.push({case: `${departure}-stops-active-capture`, passed: true, captureStop,
      pulseCapture: {baselineSources, recordingSources, activeAfterStop: afterSources},
      events: stopped.map(row => row.event)});
    // A fresh successful recording proves the pending Stop receipt was retired.
    await shortCase(enable, false, true);
  }

} catch (error) {
  await failed(error);
  throw error;
} finally {
  await finish();
}
