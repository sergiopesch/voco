import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareEvidence, productionShell, openRenderer, routeTauriModules, routeAppShell, installRendererMocks } from './renderer-fixture.mjs';
// My words in the actual App, with packaged fonts and CSS: adding and removing
// entries, the rules Settings checks before saving, a failed save, a full list,
// where focus goes, and Say it: teaching VOCO what it heard, forgetting a
// version, and an entry's versions going with it. Every native boundary is
// mocked, the speech worker is a scripted double and capture the mocked WebKit
// worklet; no microphone, model or desktop is touched, and nothing is pasted.
const { out, save } = await prepareEvidence(import.meta.url, [
    'src/App.tsx', 'src/components/ControlPanel.tsx', 'src/components/MyWords.tsx', 'src/components/WordCheck.tsx',
    'src/hooks/useWordCheck.ts', 'src/lib/myWords.ts', 'src/store/useStore.ts', 'src/preferences.css', 'src/my-words.css',
]);
const shell = await productionShell(out);
const results = [], errors = [];
let server, browser, page, origin;
try {
    ({ server, browser, page, origin } = await openRenderer(errors));
    await routeTauriModules(page, `export async function invoke(name, args) {
        if (name === "native_capture_capabilities") return { enabled: false };
        if (name === "get_crash_journal_epoch") return 1;
        if (name.endsWith("_crash_journal")) return;
        if (name !== "speech_stream") throw new Error("Unexpected native command: " + name);
        const { request } = args;
        (window.speechRequests ??= []).push(request);
        if (["warmup", "quality", "diagnostic"].includes(request.op)) return {};
        return { session: request.session, seq: request.seq, mode: "append-only", text: request.op === "finish" ? (window.heardNext ?? "") : null };
    }`);
    await routeAppShell(page, shell);
    await installRendererMocks(page, { worklet: true });
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
        // A word said, then quiet, through the mocked capture worklet.
        window.say = async () => {
            const batch = (loud) => Float32Array.from({ length: 1600 }, (_, i) => loud ? Math.sin(i / 20) * 0.2 : 0);
            for (let at = 0; at < 0.6; at += 0.1) { window.captureWorklet?.port.onmessage?.({ data: { type: 'samples', data: batch(true) } }); await new Promise(resolve => setTimeout(resolve, 100)); }
            for (let at = 0; at < 2.5 && window.store.getState().status === 'recording'; at += 0.1) {
                window.captureWorklet?.port.onmessage?.({ data: { type: 'samples', data: batch(false) } });
                await new Promise(resolve => setTimeout(resolve, 100));
            }
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
        items.map(item => item.querySelector('.voco-my-words__word').textContent));
    const add = async (text, how = 'button') => {
        await field().fill(text);
        if (how === 'enter') await field().press('Enter');
        else await page.getByRole('button', { name: 'Add', exact: true }).click();
    };

    // An empty list says so, and the page names what it does and where it stays.
    await load({ onboardingCompleted: true, englishSpelling: 'british', myWords: [] });
    await page.getByText('No words yet.', { exact: true }).waitFor();
    assert.equal(await feedback().textContent(), '0 of 100');
    await page.getByText('How My words works', { exact: true }).click();
    await page.getByText('Your words, and the versions VOCO learns, stay on this computer.', { exact: true }).waitFor();
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
    assert.deepEqual((await saves()).at(-1), { myWords: ['Siobhán', 'Pipe Wire', 'Málaga'], myWordsHeard: [] });
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
    assert.deepEqual((await saves()).at(-1), { myWords: ['Siobhán', 'Málaga', 'Kubernetes'], myWordsHeard: [] });
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

    // Say it in Settings: VOCO shows what it heard, learns the version it's taught,
    // shows it under the entry, and forgets it when asked.
    await load({ onboardingCompleted: true, englishSpelling: 'british', myWords: ['Siobhán', 'GitHub'], myWordsHeard: [] });
    const siobhan = page.getByRole('list', { name: 'My words' }).getByRole('listitem').filter({ hasText: 'Siobhán' });
    await page.evaluate(() => { window.heardNext = 'Shivon.'; });
    await page.getByRole('button', { name: 'Say it: Siobhán' }).click();
    await page.waitForFunction(() => window.store.getState().status === 'recording');
    assert.equal(await page.getByRole('button', { name: 'Say it: GitHub' }).isDisabled(), true, 'One check at a time');
    // The list the check started with stays as it is until the check ends.
    for (const name of ['Remove Siobhán', 'Remove GitHub', 'Add']) {
        assert.equal(await page.getByRole('button', { name, exact: true }).isDisabled(), true, name);
    }
    assert.equal(await field().isDisabled(), true);
    await page.evaluate(() => window.say());
    await siobhan.getByText('VOCO heard “Shivon”.').waitFor();
    await shot('settings-my-words-heard');
    await siobhan.getByRole('button', { name: 'Teach VOCO', exact: true }).click();
    await siobhan.getByText('VOCO learned “Shivon”.').waitFor();
    assert.deepEqual((await saves()).at(-1), { myWords: ['Siobhán', 'GitHub'], myWordsHeard: [{ heard: 'Shivon', writes: 'Siobhán' }] });
    await siobhan.getByRole('group', { name: 'Versions VOCO learned for Siobhán' }).getByText('Shivon', { exact: true }).waitFor();
    await page.evaluate(() => { window.heardNext = 'Siobhán.'; });
    await page.getByRole('button', { name: 'Say it again: Siobhán' }).click();
    await page.waitForFunction(() => window.store.getState().status === 'recording');
    await page.evaluate(() => window.say());
    await siobhan.getByText('VOCO writes “Siobhán”.').waitFor();
    await shot('settings-my-words-taught');
    // No check pastes, copies or keeps a crash journal, and each starts as recognized.
    assert.equal(await page.evaluate(() => window.calls.filter(call => ['pasteDesktopText', 'copyDesktopText'].includes(call[0])).length), 0);
    assert.ok(await page.evaluate(() => window.speechRequests.filter(request => request.op === 'start').every(request => request.words_check === true)));
    // Without its list of everyday words, a check teaches nothing; a restart reads it again.
    await page.route('**/everyday-words.txt*', route => route.abort());
    await load({ onboardingCompleted: true, englishSpelling: 'british', myWords: ['Siobhán', 'GitHub'], myWordsHeard: [{ heard: 'Shivon', writes: 'Siobhán' }] });
    await page.evaluate(() => { window.heardNext = 'Shivonne.'; });
    await page.getByRole('button', { name: 'Say it: Siobhán' }).click();
    await page.waitForFunction(() => window.store.getState().status === 'recording');
    await page.evaluate(() => window.say());
    await siobhan.getByText("VOCO couldn't read its list of everyday words. Restart VOCO, then try again.", { exact: false }).waitFor();
    assert.equal(await siobhan.getByRole('button', { name: /Teach/ }).count(), 0);
    await page.unroute('**/everyday-words.txt*');
    await load({ onboardingCompleted: true, englishSpelling: 'british', myWords: ['Siobhán', 'GitHub'], myWordsHeard: [{ heard: 'Shivon', writes: 'Siobhán' }] });
    await page.evaluate(() => { window.heardNext = 'Shivonne.'; });
    await page.getByRole('button', { name: 'Say it: Siobhán' }).click();
    await page.waitForFunction(() => window.store.getState().status === 'recording');
    await page.evaluate(() => window.say());
    await siobhan.getByText('VOCO heard “Shivonne”.').waitFor();
    // A failed save while teaching says why and keeps the versions as saved.
    await page.evaluate(() => { window.heardNext = 'Gitthub.'; });
    await page.getByRole('button', { name: 'Say it: GitHub' }).click();
    await page.waitForFunction(() => window.store.getState().status === 'recording');
    await page.evaluate(() => window.say());
    const github = page.getByRole('list', { name: 'My words' }).getByRole('listitem').filter({ hasText: 'GitHub' });
    await github.getByText('VOCO heard “Gitthub”.').waitFor();
    await page.evaluate(() => { window.failNextSave = true; });
    await github.getByRole('button', { name: 'Teach VOCO', exact: true }).click();
    await github.getByRole('alert').filter({ hasText: 'No space left on device' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.config.myWordsHeard), [{ heard: 'Shivon', writes: 'Siobhán' }]);
    // Forgetting a version saves at once.
    await siobhan.getByRole('button', { name: 'Forget “Shivon”' }).click();
    await page.waitForFunction(() => window.config.myWordsHeard.length === 0);
    // Removing an entry removes its versions in the same save.
    await load({ onboardingCompleted: true, englishSpelling: 'british', myWords: ['Siobhán Kelly', 'GitHub'],
        myWordsHeard: [{ heard: 'Shivon', writes: 'Siobhán' }, { heard: 'get hub', writes: 'GitHub' }] });
    await page.getByRole('group', { name: 'Versions VOCO learned for Siobhán Kelly' }).getByText('→ Siobhán', { exact: false }).waitFor();
    await shot('settings-my-words-versions');
    // A word VOCO already writes for a version can't be listed as well.
    await add('Get Hub');
    await page.getByRole('alert').filter({ hasText: 'VOCO already writes “GitHub” when it hears “get hub”.' }).waitFor();
    await page.getByRole('button', { name: 'Remove Siobhán Kelly', exact: true }).click();
    await page.waitForFunction(() => window.saves.length === 1);
    assert.deepEqual((await saves()).at(-1), { myWords: ['GitHub'], myWordsHeard: [{ heard: 'get hub', writes: 'GitHub' }] });
    results.push({ case: 'say-it-teaches-and-forgets-versions', passed: true, saves: await saves() });

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
