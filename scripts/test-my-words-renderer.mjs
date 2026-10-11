import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareEvidence, productionShell, openRenderer, routeTauriModules, routeAppShell, installRendererMocks } from './renderer-fixture.mjs';
// My words in the actual App, with packaged fonts and CSS: adding and removing
// entries, the rules Settings checks before saving, a failed save, a full list
// and where focus goes. Every native boundary is mocked; no microphone, model
// or desktop is touched.
const { out, save } = await prepareEvidence(import.meta.url, [
    'src/App.tsx', 'src/components/ControlPanel.tsx', 'src/components/MyWords.tsx', 'src/store/useStore.ts',
    'src/preferences.css',
]);
const shell = await productionShell(out);
const results = [], errors = [];
let server, browser, page, origin;
try {
    ({ server, browser, page, origin } = await openRenderer(errors));
    await routeTauriModules(page, 'export async function invoke(name) { if (name === "native_capture_capabilities") return {enabled:false}; if(name === "get_crash_journal_epoch") return 1; if(name.endsWith("_crash_journal")) return; throw new Error("Unexpected native command: " + name); }');
    await routeAppShell(page, shell);
    await installRendererMocks(page);
    // Each load names its saved settings in the URL; saves update them.
    await page.addInitScript(() => {
        window.config = { ...window.config, ...JSON.parse(new URLSearchParams(location.search).get('config') || '{}') };
        window.saves = [];
        window.nativeHandlers.saveConfigPatch = ([patch]) => {
            if (window.failNextSave) {
                window.failNextSave = false;
                throw new Error('No space left on device');
            }
            window.saves.push(patch);
            window.config = { ...window.config, ...patch };
            return { revision: 2 + window.saves.length, config: window.config };
        };
    });
    const load = async (config) => {
        await page.goto(origin + '/app-microphone-check?config=' + encodeURIComponent(JSON.stringify(config)));
        await page.waitForFunction(() => window.store?.getState().config);
        await page.evaluate(() => window.store.getState().setSurface('settings'));
        await page.getByRole('button', { name: 'My words', exact: true }).click();
        await page.getByRole('heading', { name: 'My words', exact: true }).waitFor();
    };
    const shot = async (name) => {
        await page.setViewportSize({ width: 1040, height: 760 });
        await page.evaluate(async () => { await document.fonts.load('600 19px Geist'); await document.fonts.ready; });
        await page.waitForTimeout(300);
        assert.equal(await page.locator('vite-error-overlay').count(), 0);
        await page.screenshot({ path: path.join(out, name + '.png') });
    };
    const saves = () => page.evaluate(() => window.saves);
    const field = () => page.getByRole('textbox', { name: 'Word or name' });
    const feedback = () => page.locator('#voco-my-words-feedback');
    const entries = () => page.getByRole('list', { name: 'My words' }).getByRole('listitem').evaluateAll(items =>
        items.map(item => item.querySelector('span').textContent));
    const add = async (text, how = 'button') => {
        await field().fill(text);
        if (how === 'enter') await field().press('Enter');
        else await page.getByRole('button', { name: 'Add', exact: true }).click();
    };

    // An empty list says so, and the page names what it does and where it stays.
    await load({ onboardingCompleted: true, englishSpelling: 'british', myWords: [] });
    await page.getByText('No words yet.', { exact: true }).waitFor();
    assert.equal(await feedback().textContent(), '0 of 100');
    await page.getByText('The list stays on this computer.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Add', exact: true }).isDisabled(), true, 'Add waits for a word');
    await shot('settings-my-words-empty');
    results.push({ case: 'empty-list', passed: true });

    // Entries save at once, tidied: composed accents and single spaces. Enter adds too.
    await add('Siobhán');
    await page.waitForFunction(() => window.saves.length === 1);
    await add('  Pipe   Wire ', 'enter');
    await page.waitForFunction(() => window.saves.length === 2);
    await add('Ma\u0301laga');
    await page.waitForFunction(() => window.saves.length === 3);
    assert.deepEqual((await saves()).at(-1), { myWords: ['Siobhán', 'Pipe Wire', 'Málaga'] });
    assert.deepEqual(await entries(), ['Siobhán', 'Pipe Wire', 'Málaga']);
    assert.equal(await field().inputValue(), '', 'The field clears after a save');
    assert.equal(await field().evaluate(input => input === document.activeElement), true, 'Focus stays in the field');
    assert.equal(await feedback().textContent(), '3 of 100');
    results.push({ case: 'adds-tidied-entries', passed: true, saves: await saves() });

    // Settings checks the worker's rules before saving and says what is wrong.
    const rejected = [
        ['siobhan', '“Siobhán” is already in My words.'],
        ['C++', 'Use letters, digits, single spaces, hyphens, apostrophes and full stops, starting with a letter or digit.'],
        ['one two three four five', 'Keep each entry to 4 words and 40 characters.'],
        ['x'.repeat(41), 'Keep each entry to 4 words and 40 characters.'],
    ];
    for (const [text, message] of rejected) {
        await add(text);
        await page.getByRole('alert').filter({ hasText: message }).waitFor();
        assert.equal(await field().getAttribute('aria-invalid'), 'true');
    }
    assert.equal((await saves()).length, 3, 'A rejected entry is never saved');
    assert.equal(await field().inputValue(), 'x'.repeat(41), 'A rejected entry stays in the field to fix');
    await shot('settings-my-words-rejected');
    // Typing again clears the message.
    await field().fill('Kubernetes');
    assert.equal(await feedback().textContent(), '3 of 100');
    results.push({ case: 'rejects-what-the-worker-would-skip', passed: true });

    // A failed save keeps the list as saved and the entry in the field.
    await page.evaluate(() => { window.failNextSave = true; });
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'No space left on device' }).waitFor();
    assert.deepEqual(await entries(), ['Siobhán', 'Pipe Wire', 'Málaga']);
    assert.equal(await field().inputValue(), 'Kubernetes');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.waitForFunction(() => window.saves.length === 4);
    assert.deepEqual(await entries(), ['Siobhán', 'Pipe Wire', 'Málaga', 'Kubernetes']);
    results.push({ case: 'a-failed-save-keeps-the-saved-list', passed: true });

    // Removing an entry saves at once and moves focus to the one that took its place.
    await page.getByRole('button', { name: 'Remove Pipe Wire', exact: true }).click();
    await page.waitForFunction(() => window.saves.length === 5);
    assert.deepEqual((await saves()).at(-1), { myWords: ['Siobhán', 'Málaga', 'Kubernetes'] });
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Remove Málaga');
    await page.getByRole('button', { name: 'Remove Kubernetes', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Remove Málaga');
    await shot('settings-my-words-list');
    for (const word of ['Málaga', 'Siobhán']) {
        await page.getByRole('button', { name: `Remove ${word}`, exact: true }).click();
        await page.waitForFunction(word => !window.config.myWords.includes(word), word);
    }
    await page.getByText('No words yet.', { exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.matches('.voco-my-words__add input'));
    results.push({ case: 'removes-and-moves-focus', passed: true, saves: await saves() });

    // A full list explains why nothing more is added.
    const full = Array.from({ length: 100 }, (_, index) => `term${index}`);
    await load({ onboardingCompleted: true, englishSpelling: 'british', myWords: full });
    assert.equal(await feedback().textContent(), '100 of 100');
    await add('Kubernetes');
    await page.getByRole('alert').filter({ hasText: 'My words holds up to 100 entries. Remove one to add another.' }).waitFor();
    assert.equal((await saves()).length, 0);
    results.push({ case: 'a-full-list', passed: true });

    assert.deepEqual(errors, []);
    await save('RESULTS.json', { passed: true, results, errors, mockedPlatform: true });
}
catch (error) {
    await save('FAILURE.json', {
        error: String(error), stack: error.stack, results, errors,
        diagnostics: await page?.evaluate(() => ({ text: document.body.innerText, state: window.store?.getState(), calls: window.calls })).catch(() => null),
    });
    throw error;
}
finally {
    await browser?.close();
    await server?.close();
}
