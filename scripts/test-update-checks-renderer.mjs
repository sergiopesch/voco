import assert from 'node:assert/strict';
import { prepareEvidence, productionShell, openRenderer, routeTauriModules, routeAppShell, installRendererMocks } from './renderer-fixture.mjs';
// The startup update check's off switch in the actual App. With "Only when I
// choose", VOCO asks GitHub nothing at startup or when the channel changes;
// turning automatic checks back on asks at once, and Check for updates always
// asks. The snap asks nothing: the Snap Store updates it. Install update starts
// only from its button, and its window follows the stages Rust reports. Every
// native boundary is mocked; nothing leaves the test.
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
        window.nativeHandlers.saveConfigPatch = ([patch]) => {
            window.config = { ...window.config, ...patch };
            return { revision: 3, config: window.config };
        };
    });
    const load = async (config, store = false, install = false) => {
        await page.goto(origin + '/app-microphone-check?' + (store ? 'store=1&' : '') + (install ? 'install=1&' : '') + 'config=' + encodeURIComponent(JSON.stringify(config)));
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
    await report({ stage: 'downloading', version: '2026.0.66', file: 3, files: 3, received: 350 * 1048576, total: 700 * 1048576 });
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
