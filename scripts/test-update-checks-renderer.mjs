import assert from 'node:assert/strict';
import { prepareEvidence, productionShell, openRenderer, routeTauriModules, routeAppShell, installRendererMocks } from './renderer-fixture.mjs';
// The startup update check's off switch in the actual App. With "Only when I
// choose", VOCO asks GitHub nothing at startup or when the channel changes;
// turning automatic checks back on asks at once, and Check for updates always
// asks. The snap asks nothing: the Snap Store updates it. The switch for
// starting at login shows only where Rust says VOCO can, and saves only when
// used. Install update starts only from its button, and its window follows the
// stages Rust reports. Every native boundary is mocked; nothing leaves the test.
const { out, save } = await prepareEvidence(import.meta.url, [
    'src/App.tsx', 'src/lib/updates.ts', 'src/lib/updateCheckCoordinator.ts', 'src/components/ControlPanel.tsx',
    'src/lib/updateInstall.ts', 'src/components/UpdateInstall.tsx',
]);
const shell = await productionShell(out);
const results = [], errors = [], requests = [];
let releases = [];
let server, browser, page, origin;
try {
    ({ server, browser, page, origin } = await openRenderer(errors));
    // Install update's commands are recorded in window.updateCalls; availability
    // follows window.updateAvailable.
    await routeTauriModules(page, 'export async function invoke(name, args) { if (name === "native_capture_capabilities") return {enabled:false}; if(name === "get_crash_journal_epoch") return 1; if(name.endsWith("_crash_journal")) return; if (name === "update_install_availability") return window.updateAvailable ? {available:true} : {available:false, reason:"The Snap Store keeps VOCO up to date."}; if (name === "update_install_status") return window.updateStatus ?? null; if (name === "install_update" || name === "cancel_update_install" || name === "dismiss_update_install") { (window.updateCalls ||= []).push([name, args ?? null]); if (name === "dismiss_update_install") window.updateStatus = null; return name === "cancel_update_install" ? true : undefined; } throw new Error("Unexpected native command: " + name); }');
    await routeAppShell(page, shell);
    await installRendererMocks(page);
    // Registered last, so it answers before the fixture's own GitHub route.
    await page.route('https://api.github.com/**', route => {
        requests.push(route.request().url());
        return route.fulfill({ json: releases });
    });
    await page.addInitScript(() => {
        window.config = { ...window.config, ...JSON.parse(new URLSearchParams(location.search).get('config') || '{}') };
        if (new URLSearchParams(location.search).get('store') === '1') window.nativeHandlers.storeUpdates = () => true;
        window.updateAvailable = new URLSearchParams(location.search).get('install') === '1';
        // Rust says whether this VOCO can start at login: a package or the snap.
        if (new URLSearchParams(location.search).get('login') === '1') window.nativeHandlers.loginStartAvailable = () => true;
        window.nativeHandlers.saveConfigPatch = ([patch]) => {
            // A refused save rejects with Rust's reason and changes nothing.
            if (window.refuseSave) throw window.refuseSave;
            window.config = { ...window.config, ...patch };
            return { revision: 3, config: window.config };
        };
    });
    const load = async (config, store = false, install = false, login = false) => {
        await page.goto(origin + '/app-microphone-check?' + (store ? 'store=1&' : '') + (install ? 'install=1&' : '') + (login ? 'login=1&' : '') + 'config=' + encodeURIComponent(JSON.stringify(config)));
        await page.waitForFunction(() => window.calls.some(([name, event]) => name === 'traceHotkeyEvent' && event === 'frontend_init_complete'));
    };
    const patch = config => page.evaluate(config => {
        const { config: current, setConfig } = window.store.getState();
        setConfig({ ...current, ...config });
    }, config);
    // Long enough for a check the App would make on its own.
    const settle = () => page.waitForTimeout(1500);

    await load({ onboardingCompleted: true, automaticUpdateChecks: false, updateChannel: 'stable' });
    await settle();
    assert.deepEqual(requests, [], 'No request at startup with "Only when I choose"');
    await patch({ updateChannel: 'beta' });
    await settle();
    assert.deepEqual(requests, [], 'No request when the channel changes with "Only when I choose"');
    results.push({ case: 'only-when-i-choose-asks-nothing', passed: true });

    await patch({ automaticUpdateChecks: true });
    await settle();
    assert.equal(requests.length, 1, 'Turning automatic checks back on asks once');
    results.push({ case: 'turning-automatic-checks-on-asks-once', passed: true, requests: requests.length });

    // Startup asks once, even with nothing cached.
    await load({ onboardingCompleted: true, automaticUpdateChecks: true, updateChannel: 'stable' });
    await settle();
    assert.equal(requests.length, 2, 'The default asks once at startup');
    results.push({ case: 'when-voco-starts-asks-at-startup', passed: true, requests: requests.length });

    // The snap: automatic checks on, yet it asks nothing, and Updates shows no controls.
    const asked = requests.length;
    await load({ onboardingCompleted: true, automaticUpdateChecks: true, updateChannel: 'stable' }, true);
    await settle();
    assert.equal(requests.length, asked, 'The snap never asks GitHub');
    await page.evaluate(() => window.store.getState().setSurface('settings'));
    await page.getByRole('button', { name: 'Updates', exact: true }).click();
    await page.getByText('The Snap Store keeps VOCO up to date.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Check for updates' }).count(), 0, 'No check button in the snap');
    assert.equal(await page.getByText('Update settings').count(), 0, 'No update settings in the snap');
    results.push({ case: 'the-snap-asks-nothing-and-shows-no-update-controls', passed: true, requests: requests.length });

    // The snap's shortcut, once GNOME holds it, changes in Settings: VOCO
    // proposes the keys, GNOME's dialog confirms them, and Settings shows the
    // keys GNOME reports. Cancelled in GNOME, the earlier shortcut stays.
    await load({ onboardingCompleted: true, automaticUpdateChecks: true, hotkey: 'Super+X' }, true);
    await page.evaluate(() => {
        window.portal = { applies: true, typingAllowed: true, panelAttached: false, panelHoldsShortcut: false,
            shortcutPortal: true, shortcutCustom: false, shortcutBound: true, shortcutTrigger: 'Press <Super>x' };
        window.nativeHandlers.getPortalSetupStatus = () => ({ ...window.portal });
        window.changesAsked = [];
        window.nativeHandlers.changePortalShortcut = ([hotkey]) => new Promise((resolve, reject) => {
            window.changesAsked.push(hotkey);
            window.answerChange = (added) => {
                if (!added) { reject('GNOME kept your earlier shortcut. To change it to ' + hotkey + ', choose Apply shortcut again, then Add.'); return; }
                // GNOME reports the keys; Rust saves them and tells the window.
                window.portal.shortcutTrigger = 'Press <Control><Alt>k';
                const { config, setConfig } = window.store.getState();
                setConfig({ ...config, hotkey: 'Ctrl+Alt+K' });
                resolve({ ...window.portal });
            };
        });
        window.store.getState().setSurface('settings');
    });
    await page.getByRole('button', { name: 'Shortcut', exact: true }).click();
    const shortcutPage = page.locator('.voco-preferences__page');
    await shortcutPage.getByText('starts and stops dictation.', { exact: false }).waitFor();
    assert.equal(await shortcutPage.getByText('open GNOME Settings', { exact: false }).count(), 0, 'Settings sends nobody to GNOME Settings');
    assert.equal(await shortcutPage.locator('.voco-preferences__shortcut-summary kbd').innerText(), 'Super+X');
    await shortcutPage.getByText('GNOME keeps this shortcut for VOCO', { exact: false }).waitFor();
    await shortcutPage.getByRole('button', { name: 'Change shortcut', exact: true }).click();
    const shortcutField = shortcutPage.getByLabel('Start and stop dictation', { exact: true });
    await shortcutPage.getByText('When you apply it, GNOME asks you once: choose Add.', { exact: true }).waitFor();
    await shortcutPage.getByRole('button', { name: 'Record keys', exact: true }).click();
    await shortcutField.press('Control+Alt+k');
    assert.equal(await shortcutField.inputValue(), 'Ctrl+Alt+K');
    await shortcutPage.getByRole('button', { name: 'Apply shortcut', exact: true }).click();
    await shortcutPage.getByText('GNOME’s dialog is open. Choose Add.', { exact: true }).waitFor();
    assert.equal(await shortcutPage.getByRole('button', { name: 'Waiting for GNOME…', exact: true }).isDisabled(), true);
    assert.equal(await shortcutPage.getByRole('button', { name: 'Cancel', exact: true }).isDisabled(), true, 'GNOME\'s dialog decides, not a second Cancel');
    await page.screenshot({ path: out + '/snap-shortcut-waiting-for-gnome.png' });
    // Cancelled in GNOME's dialog: Settings says so and keeps the editor.
    await page.evaluate(() => window.answerChange(false));
    await shortcutPage.getByText('GNOME kept your earlier shortcut.', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.store.getState().config.hotkey), 'Super+X');
    await shortcutPage.getByRole('button', { name: 'Apply shortcut', exact: true }).click();
    await shortcutPage.getByText('GNOME’s dialog is open. Choose Add.', { exact: true }).waitFor();
    await page.evaluate(() => window.answerChange(true));
    await shortcutPage.getByRole('button', { name: 'Change shortcut', exact: true }).waitFor();
    assert.equal(await shortcutPage.locator('.voco-preferences__shortcut-summary kbd').innerText(), 'Ctrl+Alt+K');
    assert.equal(await shortcutPage.locator('.voco-portal-setup strong').last().textContent(), 'Ctrl+Alt+K', 'GNOME\'s keys, as VOCO writes shortcuts');
    assert.deepEqual(await page.evaluate(() => window.changesAsked), ['Ctrl+Alt+K', 'Ctrl+Alt+K']);
    assert.deepEqual(await page.evaluate(() => window.calls.filter(([name]) => name === 'saveConfigPatch')), [], 'GNOME takes the change; no plain save races it');
    await page.screenshot({ path: out + '/snap-shortcut-changed.png' });
    results.push({ case: 'the-snap-changes-its-shortcut-in-settings', passed: true });

    // Start at login: a switch in Settings where Rust says VOCO can, saved by
    // its own patch. A refused save puts the saved setting back and says why.
    const patches = () => page.evaluate(() => window.calls.filter(([name]) => name === 'saveConfigPatch').map(([, patch]) => patch));
    const loginSwitch = page.getByRole('switch', { name: 'Start VOCO when you sign in' });
    await load({ onboardingCompleted: true, startAtLogin: true });
    await page.evaluate(() => window.store.getState().setSurface('settings'));
    await page.getByRole('heading', { name: 'Settings', exact: true }).waitFor();
    assert.equal(await loginSwitch.count(), 0, 'A source build has no switch');
    results.push({ case: 'login-start-hidden-where-unavailable', passed: true });

    await load({ onboardingCompleted: true, startAtLogin: true }, false, false, true);
    await page.evaluate(() => window.store.getState().setSurface('settings'));
    await loginSwitch.waitFor();
    assert.equal(await loginSwitch.isChecked(), true, 'On until the user turns it off');
    await page.getByText('VOCO starts without opening a window, ready for your shortcut.').waitFor();
    assert.deepEqual(await patches(), [], 'Opening Settings saves nothing');
    await loginSwitch.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400); // Let the page's entrance settle.
    await page.screenshot({ path: out + '/login-start-on.png' });
    await loginSwitch.click();
    await page.getByText('After you sign in, open VOCO from your app launcher before you dictate.').waitFor();
    assert.equal(await loginSwitch.isChecked(), false);
    assert.deepEqual(await patches(), [{ startAtLogin: false }]);
    assert.equal(await page.evaluate(() => window.store.getState().config.startAtLogin), false);
    await loginSwitch.click();
    await page.getByText('VOCO starts without opening a window, ready for your shortcut.').waitFor();
    assert.deepEqual((await patches()).at(-1), { startAtLogin: true });
    results.push({ case: 'login-start-switch-saves-the-setting', passed: true, patches: await patches() });

    const refusal = "VOCO couldn't stop itself from starting when you sign in: /home/u/.config/autostart/voco-login.desktop must be a regular file";
    await page.evaluate(refusal => { window.refuseSave = refusal; }, refusal);
    await loginSwitch.click();
    await page.getByRole('alert').filter({ hasText: refusal }).waitFor();
    assert.equal(await loginSwitch.isChecked(), true, 'A refused save keeps the saved setting');
    assert.equal(await page.evaluate(() => window.store.getState().config.startAtLogin), true);
    await page.getByRole('alert').filter({ hasText: refusal }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: out + '/login-start-refused.png' });
    await page.evaluate(() => { window.refuseSave = null; });
    await loginSwitch.click();
    await page.getByText('After you sign in, open VOCO from your app launcher before you dictate.').waitFor();
    assert.equal(await page.getByRole('alert').filter({ hasText: refusal }).count(), 0, 'A saved choice clears the reason');
    results.push({ case: 'login-start-refused-save-keeps-the-setting', passed: true });

    // Install update: offered only for a newer release where Rust says it can
    // run, started only by its button, and its window follows Rust's stages.
    releases = [{ draft: false, prerelease: false, html_url: 'https://github.com/sergiopesch/voco/releases/tag/voco.2026.0.66', name: 'VOCO 2026.0.66', published_at: '2026-11-05T00:00:00Z', tag_name: 'voco.2026.0.66' }];
    const openUpdates = async () => {
        await page.evaluate(() => window.store.getState().setSurface('settings'));
        await page.getByRole('button', { name: 'Updates', exact: true }).click();
        await page.getByText('VOCO 2026.0.66 is available on the stable channel.').waitFor();
    };
    await load({ onboardingCompleted: true, automaticUpdateChecks: true, updateChannel: 'stable' });
    await openUpdates();
    await settle();
    assert.equal(await page.getByRole('button', { name: 'Install update' }).count(), 0, 'No Install update where Rust says it cannot run');
    results.push({ case: 'install-update-hidden-where-unavailable', passed: true });

    await load({ onboardingCompleted: true, automaticUpdateChecks: true, updateChannel: 'stable' }, false, true);
    await openUpdates();
    const install = page.getByRole('button', { name: 'Install update' });
    await install.waitFor();
    assert.deepEqual(await page.evaluate(() => window.updateCalls ?? []), [], 'Nothing installs until the button is chosen');
    await install.click();
    assert.deepEqual(await page.evaluate(() => window.updateCalls), [['install_update', { version: '2026.0.66' }]]);
    // Rust remembers the last stage it reported, as update_install_status does.
    const report = payload => page.evaluate(payload => { window.updateStatus = payload; window.listeners['voco:update-install']({ payload }); }, payload);
    await report({ stage: 'downloading', version: '2026.0.66', file: 3, files: 3, received: 350000000, total: 700000000 });
    await page.getByText('350 MB of 700 MB').waitFor();
    assert.equal(await page.getByRole('progressbar', { name: 'Download' }).getAttribute('aria-valuenow'), '50');
    // The install outlives the page: leaving Updates and coming back shows it still.
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('button', { name: 'Updates', exact: true }).click();
    await page.getByText('350 MB of 700 MB').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Install update' }).count(), 0, 'No second Install update while one runs');
    await page.getByRole('button', { name: 'Cancel' }).click();
    assert.deepEqual((await page.evaluate(() => window.updateCalls)).at(-1), ['cancel_update_install', null]);
    await report({ stage: 'verifying', version: '2026.0.66' });
    await report({ stage: 'authorizing', version: '2026.0.66' });
    await page.getByText('Enter your password to install it.').waitFor();
    assert.equal(await page.getByRole('button', { name: 'Cancel' }).count(), 0, 'No Cancel once the password prompt is up');
    await report({ stage: 'failed', version: '2026.0.66', message: 'The password prompt was dismissed, so nothing was installed. You can still update with the installer command on the release page.' });
    await page.getByText('The update didn’t install').waitFor();
    await page.getByText('The password prompt was dismissed').waitFor();
    // A failure that ended while the page was away is still there on return.
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    await page.getByRole('button', { name: 'Updates', exact: true }).click();
    await page.getByText('The password prompt was dismissed').waitFor();
    await page.getByRole('button', { name: 'Try again' }).click();
    assert.deepEqual((await page.evaluate(() => window.updateCalls)).at(-1), ['install_update', { version: '2026.0.66' }]);
    await report({ stage: 'installed', version: '2026.0.66' });
    await page.getByText('VOCO 2026.0.66 is installed. VOCO restarts when dictation ends.').waitFor();
    await report({ stage: 'restarting', version: '2026.0.66' });
    await page.getByText('Restarting into VOCO 2026.0.66…').waitFor();
    await page.waitForTimeout(400); // Let the step transitions settle.
    await page.screenshot({ path: out + '/install-update-window.png' });
    results.push({ case: 'install-update-follows-rusts-stages', passed: true, calls: await page.evaluate(() => window.updateCalls) });

    assert.deepEqual(errors, []);
    await save('RESULTS.json', { passed: true, results, errors, requests, mockedPlatform: true });
}
catch (error) {
    await save('FAILURE.json', {
        error: String(error), stack: error.stack, results, errors, requests,
        diagnostics: await page?.evaluate(() => ({ text: document.body.innerText, calls: window.calls })).catch(() => null),
    });
    throw error;
}
finally {
    await browser?.close();
    await server?.close();
}
