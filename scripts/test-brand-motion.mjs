import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.VOCO_RENDERER_EVIDENCE_DIR;
if (!out) throw new Error('An exclusive VOCO_RENDERER_EVIDENCE_DIR is required');
await mkdir(out, { recursive: false });
const server = await createServer({
  configFile: path.join(root, 'apps/desktop/vite.config.ts'), root: path.join(root, 'apps/desktop'),
  logLevel: 'warn', server: { host: '127.0.0.1', port: Number(process.env.VOCO_RENDERER_PORT ?? 5189), hmr: false, watch: null },
});
const results = [];
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0];
  const requested = (process.env.VOCO_MOTION_BROWSERS ?? 'chromium').split(',');
  assert.ok(requested.every(name => ['chromium', 'webkit'].includes(name)), 'Unknown browser');
  for (const [name, engine] of [['chromium', chromium], ['webkit', webkit]].filter(([name]) => requested.includes(name))) {
    const browser = await engine.launch({ headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1040, height: 760 } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      // Fail closed if the presentation fixture ever attempts capture or a native command.
      await page.addInitScript(() => {
        window.__fixtureViolations = [];
        if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
          window.__fixtureViolations.push('microphone'); throw new Error('Fixture must not capture');
        };
        window.__TAURI_INTERNALS__ = { invoke: async command => {
          if (command === 'get_desktop_input_status') return {available:true,detail:'Fixture desktop prerequisites ready'};
          window.__fixtureViolations.push(command); throw new Error('Fixture must not invoke native commands');
        } };
      });
      const load = async query => {
        await page.goto(`${origin}tests/brand-motion.html?${query}`);
        await page.getByRole('heading', { name: 'VOCO', exact: true }).waitFor();
        assert.equal(await page.locator('vite-error-overlay').count(), 0);
        assert.equal(await page.title(), 'VOCO · motion fixture');
      };
      const capture = async (label, settle = true) => {
        if (settle) await page.evaluate(async () => {
          await Promise.all(document.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity)
            .map(animation => animation.finished.catch(() => {})));
        });
        await page.screenshot({ path: path.join(out, `${name}-${label}.png`) });
        assert.deepEqual(await page.evaluate(() => window.__fixtureViolations), []);
      };
      await page.setViewportSize({width:850,height:680});
      await load('surface=onboarding');
      await capture('onboarding-idle');
      assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).count(), 0);
      await page.getByRole('button', { name: 'Start test', exact: true }).click();
      assert.equal(await page.getByRole('meter', { name: 'Microphone signal' }).getAttribute('aria-valuenow'), '65');
      await capture('onboarding-transition', false);
      await page.locator('.voco-voice-pill__reveal').evaluate(async el => {
        await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
      });
      await capture('onboarding-listening');
      await page.getByRole('button', { name: 'Finish test', exact: true }).click();
      assert.equal(await page.getByRole('meter', { name: 'Microphone signal' }).count(), 0);
      await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).isEnabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.getByText('Voice test complete.', { exact: true }).count(), 1);
      await capture('onboarding-success');
      results.push({ engine: name, check: 'onboarding start/stop, level, explicit completion', passed: true });

      await load('surface=settings');
      await capture('settings');
      const combo = page.getByRole('combobox', { name: 'Microphone', exact: true });
      await combo.press('ArrowDown');
      await combo.press('Home');
      await combo.press('ArrowDown'); // Default device
      await combo.press('ArrowDown'); // Studio
      await combo.press('ArrowDown'); // Must skip disconnected device
      assert.equal(await page.locator(`[id="${await combo.getAttribute('aria-activedescendant')}"]`).getAttribute('data-value'), 'usb');
      await combo.press('Escape');
      assert.equal(await combo.getAttribute('aria-expanded'), 'false');
      assert.equal(await combo.innerText(), 'Choose a microphone');
      await combo.press('u');
      await combo.press('Enter');
      assert.equal(await combo.innerText(), 'USB microphone');
      const apply = page.getByRole('button', { name: 'Use this microphone', exact: true });
      assert.equal(await apply.isDisabled(), true);
      await page.getByRole('checkbox').check();
      assert.equal(await apply.isEnabled(), true);
      await combo.click();
      // Deliberately deliver a pointer click to verify the component also rejects it.
      await page.getByRole('option', { name: /Disconnected microphone/ }).click({ force: true });
      assert.equal(await combo.innerText(), 'USB microphone');
      await combo.press('Home');
      await combo.press('ArrowDown');
      await combo.press('Enter');
      assert.equal(await page.getByRole('checkbox').isChecked(), false);
      assert.equal(await apply.isDisabled(), true);
      await page.getByRole('checkbox').check();
      await apply.click();
      await page.getByText('Selected: Studio microphone.', { exact: false }).waitFor();
      await combo.click();
      await capture('settings-selector');
      await combo.press('End');
      assert.equal(await page.locator(`[id="${await combo.getAttribute('aria-activedescendant')}"]`).getAttribute('data-value'), 'device-11');
      await capture('settings-long-list');
      await combo.press('Tab');
      assert.equal(await combo.getAttribute('aria-expanded'), 'false');
      results.push({ engine: name, check: 'selector navigation, typeahead, disabled option, Escape, Tab, consent reset and explicit apply', passed: true });

      assert.equal(await page.getByRole('button',{name:'Change shortcut',exact:true}).count(),0);
      await page.getByRole('button',{name:'Shortcut',exact:true}).click();
      assert.equal(await page.locator('.voco-preferences__shortcut-summary kbd').innerText(),'Alt+D');
      await page.getByRole('button',{name:'Change shortcut',exact:true}).click();
      const shortcutInput = page.getByLabel('Start and stop listening',{exact:true});
      assert.equal(await shortcutInput.evaluate(el => document.activeElement === el),true);
      await shortcutInput.fill('Ctrl+Alt+K');
      await page.getByRole('button',{name:'Cancel',exact:true}).click();
      assert.equal(await page.getByRole('button',{name:'Change shortcut',exact:true}).evaluate(el => document.activeElement === el),true);
      await page.getByRole('button',{name:'Change shortcut',exact:true}).click();
      await page.getByRole('button',{name:'Record keys',exact:true}).click();
      await shortcutInput.press('Control+Alt+k');
      await page.getByRole('button',{name:'Apply shortcut',exact:true}).click();
      await page.getByRole('button',{name:'Change shortcut',exact:true}).waitFor();
      assert.equal(await page.locator('.voco-preferences__shortcut-summary kbd').innerText(),'Ctrl+Alt+K');
      await page.locator('.voco-preferences__content').evaluate(el => el.scrollTop=0);
      await page.getByRole('button',{name:'Change shortcut',exact:true}).click();
      await shortcutInput.fill('Alt+D');
      await page.getByRole('button',{name:'Apply shortcut',exact:true}).click();
      assert.equal(await page.locator('.voco-preferences__shortcut-summary kbd').innerText(),'Alt+D');
      await capture('shortcut');
      await page.setViewportSize({width:760,height:560});
      await page.locator('.voco-preferences__content').evaluate(el => el.scrollTop=0);
      await capture('shortcut-minimum');
      assert.equal(await page.locator('.voco-preferences__content').evaluate(el => el.scrollHeight <= el.clientHeight),true);
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      await capture('settings-minimum');
      await page.setViewportSize({width:850,height:680});
      await page.getByRole('button',{name:'Help',exact:true}).click();
      await capture('help');
      await page.getByText('My words are not appearing',{exact:true}).click();
      await page.getByText('Keep an editable text field focused.',{exact:false}).waitFor();
      await page.getByRole('button',{name:'Updates',exact:true}).click();
      await capture('updates');
      results.push({engine:name,check:'shortcut cancel, focus restoration, capture and apply; Help disclosures and Updates',passed:true});

      await page.setViewportSize({width:420,height:380});
      await load('surface=popover');
      await capture('popover-ready');
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight),true);
      await load('surface=popover&state=recording');
      await page.setViewportSize({ width: 420, height: 380 });
      await capture('popover-listening');
      const picker = page.getByRole('button', { name: /^Microphone:/ });
      const box = await picker.boundingBox();
      assert.ok(box && box.width > 40, 'Microphone button must retain its hit area');
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      await settings.focus();
      await page.getByRole('tooltip').waitFor();
      await settings.press('Escape');
      assert.equal(await page.getByRole('tooltip').count(), 0);
      results.push({ engine: name, check: 'compact popover, microphone target, focus tooltip and Escape', passed: true });

      await page.setViewportSize({ width: 760, height: 620 });
      await load('surface=onboarding&state=error');
      await capture('onboarding-error-minimum');
      assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).count(), 0);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await load('surface=onboarding&state=starting');
      assert.equal(await page.locator('.voco-status-mark__ring').evaluate(el => getComputedStyle(el).animationName), 'none');
      await capture('reduced-motion');
      await page.emulateMedia({ forcedColors: 'active' });
      await load('surface=settings');
      await page.getByRole('combobox', { name: 'Microphone', exact: true }).click();
      await capture('high-contrast');
      assert.deepEqual(errors, []);
      results.push({ engine: name, check: 'error completion gate, minimum window, reduced motion, high-contrast rendering, no console errors or capture', passed: true });
    } finally { await browser.close(); }
  }
  await writeFile(path.join(out, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  console.log(JSON.stringify(results, null, 2));
} finally { await server.close(); }
