import {spawn, execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {scoreLongDelivery} from './browser-long-accuracy.mjs';
import {root, results, longPlan, manifest, extension, extensionHashes, page, worker, tabId, hash, delay, traces, start, until, launch, playFixture, observeNativeRequests, shortCase, failed, finish} from './browser-app-harness.mjs';
await start({grantLocalHostPermission: false});
try {
  // Chromium exposes its toolbar over AT-SPI only when it is told an assistive
  // technology is running; the renderer flag alone covers just the page.
  await launch({env:{...process.env,ACCESSIBILITY_ENABLED:'1'},args:['--force-renderer-accessibility=complete']});
  let activationIndex = 0;
  async function toolbarUI(action) {
    const args = ['scripts/test-browser-toolbar-action.py', '--stage', String(activationIndex), ...(action ? ['--action', action] : [])];
    const child = spawn('/usr/bin/python3', args, {stdio: ['ignore', 'pipe', 'pipe']});
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { errors += chunk; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 20_000);
    const status = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve); }).finally(() => clearTimeout(timer));
    assert.equal(status, 0, `Actual Chromium toolbar UI failed: ${errors}`);
    return JSON.parse(output);
  }
  async function activateToolbar() {
    activationIndex += 1;
    await page.bringToFront();
    const before = await toolbarUI();
    const direct = before.nodes.find(node => node.actionable && node.name === manifest.action.default_title);
    if (direct) await toolbarUI(direct.name);
    else {
      await toolbarUI('Extensions');
      const menu = await toolbarUI();
      const candidates = menu.nodes.filter(node => node.actionable && (node.name === manifest.name || node.name.startsWith(manifest.name + ',')));
      assert.equal(candidates.length, 1, `Expected one observed VOCO extension action; found ${JSON.stringify(candidates)}`);
      await toolbarUI(candidates[0].name);
    }
    await until(async () => await worker.evaluate(async id => (await chrome.action.getBadgeText({tabId: id})) === 'ON', tabId), 'real toolbar action grants activeTab and arms tab');
    assert.equal(await hash(`${extension}/manifest.json`), extensionHashes['manifest.json']);
    assert.equal(await worker.evaluate(() => ready), true);
    await fs.writeFile(`${root}/evidence/toolbar-activation-${activationIndex}.json`, JSON.stringify({actualBrowserUIClick:true, badge:'ON', shippedManifestSha256:extensionHashes['manifest.json'], broadHostPermissionGranted:false}, null, 2));
  }
  if (process.env.VOCO_BROWSER_TOOLBAR_PROBE_ONLY === '1') {
    await activateToolbar();
    assert.ok(!(await traces()).some(row => row.event === 'recording_state_active'), 'Action-only probe must never record');
    results.push({case:'actual-toolbar-activeTab-native-host',passed:true,recordingRequested:false});
  }
  if (process.env.VOCO_BROWSER_TOOLBAR_PROBE_ONLY !== '1') {
  for (const reject of (process.env.VOCO_BROWSER_LONG_CAPTURE === '1' ? [] : [false, true])) await shortCase(activateToolbar, reject);
  if (process.env.VOCO_BROWSER_LONG_CAPTURE === '1') {
    await page.reload(); await page.bringToFront();
    await activateToolbar();
    await observeNativeRequests();
    await page.locator('#a').focus();
    const traceStart=(await traces()).length;
    await page.keyboard.press('Alt+Shift+v');
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='recording_state_active'),'long real microphone recording');
    const player=await playFixture(`${root}/long.wav`);
    const played=player.done;
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_desktop_live_prefix_dispatched'),'live browser prefix receipt',55_000);
    // Focus leaves first: its focusout revokes #a's lease synchronously, so
    // no later append can land between this sample and the final check.
    await page.locator('#b').focus();
    const prefix=await page.locator('#a').inputValue(); assert.ok(prefix.length>0);
    assert.equal(await played,0); await delay(600); await page.keyboard.press('Alt+Shift+v');
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_desktop_remainder_copied'),'long focus-loss remainder copied',45_000);
    await until(async()=> (await traces()).slice(traceStart).some(t=>t.event==='dictation_stop_to_idle'),'long dictation returns idle');
    assert.equal(await page.locator('#a').inputValue(),prefix); assert.equal(await page.locator('#b').inputValue(),'');
    const copied = execFileSync('xclip', ['-selection', 'clipboard', '-o'], {encoding: 'utf8', timeout: 5000});
    const report = scoreLongDelivery(longPlan, prefix, copied);
    await fs.writeFile(`${root}/evidence/long-accuracy.json`, JSON.stringify({plan: longPlan, prefix, copied, ...report}, null, 2));
    assert.ok(report.passed, `The kept prefix plus the copied remainder must meet the frozen full-reference WER and repetition checks: ${report.failures.join('; ')}`);
    results.push({case:'full-reference-long-accuracy', passed:report.passed, maxWer:longPlan.maxWer, score:report.score});
    results.push({case:'long-focus-loss',passed:true,prefixCharacters:Array.from(prefix).length,events:(await traces()).slice(traceStart).map(t=>t.event)});
    await page.screenshot({path:`${root}/evidence/long-focus-loss.png`});
  }

  // Nothing waits in VOCO after focus loss, so the next recording starts directly.
  await shortCase(activateToolbar, false, true);
  }

} catch (error) {
  await failed(error);
  throw error;
} finally {
  await finish({shippedManifestPreserved:await hash(`${extension}/manifest.json`)===extensionHashes['manifest.json']});
}
