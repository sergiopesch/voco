import assert from 'node:assert/strict';
import { prepareEvidence, productionShell, openRenderer, routeTauriModules, routeAppShell, installRendererMocks } from './renderer-fixture.mjs';
// The startup update check's off switch in the actual App. With "Only when I
// choose", VOCO asks GitHub nothing at startup or when the channel changes;
// turning automatic checks back on asks at once, and Check for updates always
// asks. Every native boundary is mocked; nothing leaves the test.
const { out, save } = await prepareEvidence(import.meta.url, [
    'src/App.tsx', 'src/lib/updates.ts', 'src/lib/updateCheckCoordinator.ts', 'src/components/ControlPanel.tsx',
]);
const shell = await productionShell(out);
const results = [], errors = [], requests = [];
let server, browser, page, origin;
try {
    ({ server, browser, page, origin } = await openRenderer(errors));
    await routeTauriModules(page, 'export async function invoke(name) { if (name === "native_capture_capabilities") return {enabled:false}; if(name === "get_crash_journal_epoch") return 1; if(name.endsWith("_crash_journal")) return; throw new Error("Unexpected native command: " + name); }');
    await routeAppShell(page, shell);
    await installRendererMocks(page);
    // Registered last, so it answers before the fixture's own GitHub route.
    await page.route('https://api.github.com/**', route => {
        requests.push(route.request().url());
        return route.fulfill({ json: [] });
    });
    await page.addInitScript(() => {
        window.config = { ...window.config, ...JSON.parse(new URLSearchParams(location.search).get('config') || '{}') };
        window.nativeHandlers.saveConfigPatch = ([patch]) => {
            window.config = { ...window.config, ...patch };
            return { revision: 3, config: window.config };
        };
    });
    const load = async config => {
        await page.goto(origin + '/app-microphone-check?config=' + encodeURIComponent(JSON.stringify(config)));
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

    // With nothing cached, startup can ask twice: once when init completes and
    // once at the end of init. Both are this one setting's checks.
    await load({ onboardingCompleted: true, automaticUpdateChecks: true, updateChannel: 'stable' });
    await settle();
    assert.ok(requests.length >= 2, 'The default asks at startup');
    results.push({ case: 'when-voco-starts-asks-at-startup', passed: true, requests: requests.length });

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
