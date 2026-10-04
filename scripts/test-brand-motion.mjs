import { chromium, webkit } from 'playwright';
import { createServer } from 'vite';
import { mkdir, writeFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.VOCO_RENDERER_EVIDENCE_DIR;
if (!out) throw new Error('An exclusive VOCO_RENDERER_EVIDENCE_DIR is required');
await mkdir(out, { recursive: false });
const server = await createServer({
  configFile: path.join(root, 'apps/desktop/vite.config.ts'), root: path.join(root, 'apps/desktop'),
  logLevel: 'warn', server: { host: '127.0.0.1', port: Number(process.env.VOCO_RENDERER_PORT ?? 5189), hmr: false, watch: null,
    fs: { allow: [root, await realpath(path.join(root, 'node_modules'))] } },
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
        window.__reviewEntries = [{id:'crash-one',createdAt:1790630000000,text:('A public fixture sentence for crash recovery.\n').repeat(500)+'Final visible sentence.'}, {id:'crash-two',createdAt:1790631000000,text:'Second interrupted dictation.'}];
        // Review copies through the desktop command and uses the browser clipboard only as a fallback.
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {writeText: async text => {
          if (window.__copyFails) throw new Error('Fixture copy failure');
          window.__browserCopiedText = text;
        }} });
        if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => {
          window.__fixtureViolations.push('microphone'); throw new Error('Fixture must not capture');
        };
        window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
          if (command === 'list_crash_recovery') return window.__reviewEntries;
          if (command === 'copy_desktop_text') {
            if (window.__copyFails || window.__desktopCopyFails) throw {outcome:'no-mutation',message:'Fixture copy failure',clipboardChanged:false};
            window.__copiedText = args.text; return;
          }
          if (command === 'dismiss_crash_recovery') {
            if(window.__discardFails) throw new Error('Fixture discard failure');
            window.__reviewEntries = window.__reviewEntries.filter(entry => entry.id !== args.id); return;
          }
          if (command === 'get_panel_setup_status') return window.__panelStatus ?? {status:'active',detail:'Live panel bars and Stop are active.',canEnable:false};
          if (command === 'enable_gnome_panel') {
            if (window.__holdPanel) await window.__holdPanel;
            return {status:'restart',detail:'Panel enabled. Sign out and back in to load it; saving your work first is recommended.',canEnable:false};
          }
          if (command === 'trace_hotkey_event') return;
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
      const control = page.locator('.voco-voice-control');
      const finish = page.getByRole('button', { name: 'Finish test', exact: true });
      await page.keyboard.press('Tab');
      await finish.focus();
      const focus = await control.evaluate(el => {
        const button = el.querySelector('button');
        const signal = el.querySelector('[role="meter"]');
        const group = el.getBoundingClientRect();
        const wave = signal.getBoundingClientRect();
        return { groupOutline: getComputedStyle(el).outlineStyle,
          buttonOutline: getComputedStyle(button).outlineStyle,
          buttonBorder: getComputedStyle(button).borderTopColor,
          signalContained: wave.left >= group.left && wave.right <= group.right && wave.top >= group.top && wave.bottom <= group.bottom };
      });
      await capture('onboarding-keyboard-focus');
      assert.equal(focus.signalContained, true, 'Signal stays inside its shared control');
      assert.equal(focus.groupOutline, 'solid', 'Keyboard focus must surround the complete voice control');
      assert.equal(focus.buttonOutline, 'none', 'Do not draw a competing inner focus ring');
      assert.equal(focus.buttonBorder, 'rgba(0, 0, 0, 0)', 'Do not draw a second pill inside the voice control');
      await page.getByRole('button', { name: 'Finish test', exact: true }).click();
      assert.equal(await page.getByRole('meter', { name: 'Microphone signal' }).count(), 0);
      await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).isEnabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).evaluate(el=>el===document.activeElement),true);
      assert.equal(await page.getByText('Voice test complete.', { exact: true }).count(), 1);
      await capture('onboarding-success');
      results.push({ engine: name, check: 'onboarding start/stop, level, explicit completion', passed: true });
      await page.evaluate(()=>window.__panelStatus={status:'disabled',detail:'Enable live bars, Listening and Stop in your top panel.',canEnable:true});
      // Remount only the ready phase so its panel check uses the disabled fixture.
      await page.getByRole('button',{name:'Test again',exact:true}).click();
      await page.getByRole('button',{name:'Finish test',exact:true}).click();
      // A control disabled while focused can drop keyboard focus, so a keyboard
      // enable keeps the panel button focused and enabled while it runs and after.
      await page.evaluate(()=>{window.__holdPanel=new Promise(resolve=>{window.__releasePanel=resolve;});});
      const panelFocus=()=>page.evaluate(()=>({label:document.activeElement?.textContent,disabled:document.activeElement?.disabled}));
      await page.getByRole('button',{name:'Enable live panel',exact:true}).focus();
      await page.keyboard.press('Enter');
      await page.getByRole('button',{name:'Checking panel…',exact:true}).waitFor();
      assert.deepEqual(await panelFocus(),{label:'Checking panel…',disabled:false});
      await page.evaluate(()=>{window.__holdPanel=null;window.__releasePanel();});
      await page.getByText('Panel enabled. Sign out and back in to load it; saving your work first is recommended.',{exact:true}).waitFor();
      assert.deepEqual(await panelFocus(),{label:'Check panel again',disabled:false});
      await page.setViewportSize({width:760,height:560});
      await capture('panel-restart-required');
      assert.equal(await page.locator('.voco-setup').evaluate(el => el.scrollHeight <= el.clientHeight + 1), true,
        'Panel setup and Done must fit the minimum canvas without scrolling');
      assert.equal(await page.getByRole('button',{name:'Done',exact:true}).isEnabled(),true);
      await capture('panel-restart-done-reachable');
      assert.equal(await page.getByRole('button',{name:'Check panel again',exact:true}).count(),1);
      results.push({engine:name,check:'explicit panel activation and session restart feedback',passed:true});
      await page.setViewportSize({width:850,height:680});


      for (const [state, label] of [['starting', 'Preparing…'], ['processing', 'Finishing…']]) {
        await load(`surface=onboarding&state=${state}`);
        assert.equal(await page.getByRole('button', { name: label, exact: true }).isDisabled(), true);
        await capture(`onboarding-${state}`);
      }
      await load('surface=onboarding');
      await page.getByRole('button', { name: 'Change microphone', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: 'Back to test', exact: true }).getAttribute('aria-expanded'), 'true');
      await capture('onboarding-microphone');
      const microphoneCanvas = await page.locator('.voco-setup').evaluate(el => ({
        height: el.clientHeight, content: el.scrollHeight,
        bottom: el.getBoundingClientRect().bottom, viewport: innerHeight,
      }));
      assert.ok(microphoneCanvas.content <= microphoneCanvas.height + 1,
        `Microphone setup must fit without page scrolling: ${JSON.stringify(microphoneCanvas)}`);
      for (const viewport of [{width:760,height:560}, {width:850,height:680}]) {
        await page.setViewportSize(viewport);
        await page.getByText('Microphone access details', {exact:true}).click();
        await capture(`onboarding-microphone-details-${viewport.width}`);
        assert.equal(await page.locator('.voco-setup').evaluate(el => el.scrollHeight <= el.clientHeight + 1), true,
          `Expanded microphone details fit ${viewport.width}x${viewport.height}`);
        await page.getByText('Microphone access details', {exact:true}).click();
      }
      const setupCombo = page.getByRole('combobox', {name:'Microphone',exact:true});
      await setupCombo.press('u'); await setupCombo.press('Enter');
      await page.getByRole('button',{name:'Start test',exact:true}).waitFor();
      assert.equal(await page.getByRole('combobox',{name:'Microphone',exact:true}).count(),0);
      await capture('onboarding-microphone-applied');
      results.push({engine:name,check:'microphone selection and expanded details fit one canvas; apply returns to the test',passed:true});
      await load('surface=settings');
      await capture('settings');
      const combo = page.getByRole('combobox', { name: 'Microphone', exact: true });
      await combo.press('ArrowDown');
      await combo.press('Home');
      await combo.press('ArrowDown'); // Studio
      await combo.press('ArrowDown'); // Must skip disconnected device
      assert.equal(await page.locator(`[id="${await combo.getAttribute('aria-activedescendant')}"]`).getAttribute('data-value'), 'usb');
      await combo.press('Escape');
      assert.equal(await combo.getAttribute('aria-expanded'), 'false');
      assert.equal(await combo.innerText(), 'Choose a microphone');
      await combo.press('u');
      await combo.press('Enter');
      assert.equal(await combo.innerText(), 'USB microphone');
      await page.getByText('Selected: USB microphone.', { exact: false }).waitFor();
      assert.equal(await page.getByRole('checkbox').count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Use this microphone', exact: true }).count(), 0);
      await combo.click();
      // Deliberately deliver a pointer click to verify the component also rejects it.
      await page.getByRole('option', { name: /Disconnected microphone/ }).click({ force: true });
      assert.equal(await combo.innerText(), 'USB microphone');
      await combo.press('Home');
      await combo.press('ArrowDown');
      await combo.press('Enter');
      await page.getByText('Selected: Studio microphone.', { exact: false }).waitFor();
      await combo.click();
      await capture('settings-selector');
      await combo.press('End');
      assert.equal(await page.locator(`[id="${await combo.getAttribute('aria-activedescendant')}"]`).getAttribute('data-value'), 'device-11');
      await capture('settings-long-list');
      await combo.press('Tab');
      assert.equal(await combo.getAttribute('aria-expanded'), 'false');
      results.push({ engine: name, check: 'selector navigation, typeahead, disabled option, Escape, Tab and immediate explicit selection', passed: true });

      assert.equal(await page.getByRole('button',{name:'Change shortcut',exact:true}).count(),0);
      await page.getByRole('button',{name:'Shortcut',exact:true}).click();
      assert.equal(await page.locator('.voco-preferences__shortcut-summary kbd').innerText(),'Alt+D');
      await page.getByRole('button',{name:'Change shortcut',exact:true}).click();
      const shortcutInput = page.getByLabel('Start and stop dictation',{exact:true});
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
      await page.getByText('Keep the app you’re dictating into focused.',{exact:false}).waitFor();
      await page.getByRole('button',{name:'Updates',exact:true}).click();
      await capture('updates');
      results.push({engine:name,check:'shortcut cancel, focus restoration, capture and apply; Help disclosures and Updates',passed:true});

      await page.setViewportSize({width:420,height:380});
      await load('surface=popover');
      await capture('popover-ready');
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight),true);
      const picker = page.getByRole('button', { name: /^Microphone:/ });
      const box = await picker.boundingBox();
      assert.ok(box && box.width > 40, 'Microphone button must retain its hit area');
      const settings = page.getByRole('button', { name: 'Settings', exact: true });
      await settings.focus();
      await page.getByRole('tooltip').waitFor();
      await settings.press('Escape');
      assert.equal(await page.getByRole('tooltip').count(), 0);
      results.push({ engine: name, check: 'compact popover, microphone target, focus tooltip and Escape', passed: true });

      await page.goto(`${origin}tests/brand-motion.html?surface=review`);
      const recovered = page.getByRole('textbox', {name:'Recovered transcript'});
      await recovered.waitFor();
      const focusedOn = selector => page.waitForFunction(selector => document.activeElement?.matches(selector), selector, {timeout: 2000});
      const focusedButton = label => page.waitForFunction(label => document.activeElement?.tagName === 'BUTTON' && document.activeElement.textContent === label, label, {timeout: 2000});
      // Review takes focus when it opens, so the keyboard starts inside it.
      await focusedOn('.voco-review textarea');
      const originalText = await recovered.inputValue();
      for (const viewport of [{width:1040,height:760},{width:760,height:560},{width:390,height:600}]) {
        await page.setViewportSize(viewport);
        await capture(`review-${viewport.width}`);
        const geometry = await page.locator('.voco-review').evaluate(el => {
          const textarea = el.querySelector('textarea');
          const footer = el.querySelector('footer').getBoundingClientRect();
          return {pageFits:document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight,
            footerFits:footer.bottom <= innerHeight && footer.top >= textarea.getBoundingClientRect().bottom,
            textScrolls:textarea.scrollHeight > textarea.clientHeight};
        });
        assert.deepEqual(geometry,{pageFits:true,footerFits:true,textScrolls:true});
      }
      await page.setViewportSize({width:760,height:560});
      await recovered.evaluate(el => {el.scrollTop=el.scrollHeight;});
      await capture('review-end-of-transcript');
      await page.evaluate(()=>window.__copyFails=true);
      await page.getByRole('button',{name:'Copy transcript',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'Copy failed'}).waitFor();
      assert.equal(await recovered.inputValue(), originalText);
      await page.evaluate(()=>window.__copyFails=false);
      await page.getByRole('button',{name:'Copy transcript',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Copied.'}).waitFor();
      assert.equal(await page.evaluate(()=>window.__copiedText), originalText);
      assert.equal(await page.evaluate(()=>window.__browserCopiedText), undefined, 'Copy sets CLIPBOARD and PRIMARY through the desktop command');
      await page.evaluate(()=>window.__desktopCopyFails=true);
      await page.getByRole('button',{name:'Copy transcript',exact:true}).click();
      await page.waitForFunction(text=>window.__browserCopiedText===text, originalText);
      await page.getByRole('status').filter({hasText:'Copied.'}).waitFor();
      await page.evaluate(()=>window.__desktopCopyFails=false);
      assert.equal(await page.evaluate(()=>window.__reviewEntries.length),2,'Copy does not discard or paste');
      await page.getByRole('button',{name:'Discard',exact:true}).click();
      await focusedButton('Keep');
      await page.keyboard.press('Escape');
      await focusedButton('Discard');
      assert.equal(await page.locator('html').getAttribute('data-closed'), null, 'Escape cancels the confirmation before it hides Review');
      await page.getByRole('button',{name:'Discard',exact:true}).click();
      await page.getByRole('button',{name:'Keep',exact:true}).click();
      await focusedButton('Discard');
      await page.getByRole('button',{name:'Discard',exact:true}).click();
      await page.evaluate(()=>window.__discardFails=true);
      await page.getByRole('button',{name:'Discard transcript',exact:true}).click();
      await page.getByRole('alert').filter({hasText:'It has been kept.'}).waitFor();
      assert.equal(await recovered.inputValue(),originalText);
      await page.evaluate(()=>window.__discardFails=false);
      await page.getByRole('button',{name:'Discard transcript',exact:true}).click();
      await page.waitForFunction(()=>document.querySelector('textarea')?.value==='Second interrupted dictation.');
      await focusedOn('.voco-review textarea');
      await page.getByRole('button',{name:'Discard',exact:true}).click();
      await page.getByRole('button',{name:'Discard transcript',exact:true}).click();
      await page.getByRole('status').filter({hasText:'No interrupted dictation.'}).waitFor();
      await focusedOn('.voco-review__empty p');
      await capture('review-empty');
      await page.getByRole('button',{name:'Settings',exact:true}).click();
      assert.equal(await page.locator('html').getAttribute('data-settings'),'true');
      await page.getByRole('button',{name:'Hide to tray',exact:true}).click();
      assert.equal(await page.locator('html').getAttribute('data-closed'),'true');
      await page.goto(`${origin}tests/brand-motion.html?surface=review`);
      await focusedOn('.voco-review textarea');
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('html').getAttribute('data-closed'),'true', 'Escape hides Review as soon as it opens');
      results.push({engine:name,check:'crash review long text, compact geometry, focus and Escape, desktop copy with browser fallback, discard confirmation/failure/success, empty state and explicit navigation',passed:true});

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
