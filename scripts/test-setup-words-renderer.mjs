import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareEvidence, productionShell, openRenderer, routeTauriModules, routeAppShell, installRendererMocks } from './renderer-fixture.mjs';
// Setup's words step and Say it in the actual App, with packaged fonts and CSS:
// the account's name as the first entry, saying it, teaching VOCO what it heard,
// everyday words, nothing heard, more words, skipping, and the step's place in
// setup. The speech worker is an explicit double that answers each check with a
// scripted text; capture is the mocked WebKit worklet. Nothing reaches a
// microphone, a model or the desktop, and nothing is pasted or copied.
const { out, save } = await prepareEvidence(import.meta.url, [
    'src/App.tsx', 'src/components/ControlPanel.tsx', 'src/components/SetupWords.tsx', 'src/components/WordCheck.tsx',
    'src/components/Onboarding.tsx', 'src/hooks/useWordCheck.ts', 'src/lib/myWords.ts', 'src/lib/dictationRecording.ts',
    'src/store/useStore.ts', 'src/my-words.css',
]);
const shell = await productionShell(out);
const results = [], errors = [];
let server, browser, page, origin;
const coreInvoke = `export async function invoke(name, args) {
    if (name === "native_capture_capabilities") return { enabled: false };
    if (name === "get_crash_journal_epoch") return 1;
    if (name.endsWith("_crash_journal")) { (window.journalCalls ??= []).push(name); return; }
    if (name !== "speech_stream") throw new Error("Unexpected native command: " + name);
    const { request } = args;
    (window.speechRequests ??= []).push(request);
    if (["warmup", "quality", "diagnostic"].includes(request.op)) return {};
    // The worker double: each check hears the next scripted text.
    const text = request.op === "finish" ? (window.heardNext ?? "") : null;
    return { session: request.session, seq: request.seq, mode: "append-only", text };
}`;
try {
    ({ server, browser, page, origin } = await openRenderer(errors));
    await routeTauriModules(page, coreInvoke);
    await routeAppShell(page, shell);
    await installRendererMocks(page, { worklet: true });
    await page.addInitScript(() => {
        window.config = { ...window.config, ...JSON.parse(new URLSearchParams(location.search).get('config') || '{}') };
        window.saves = [];
        window.accountName = new URLSearchParams(location.search).get('name');
        window.nativeHandlers.getAccountName = () => window.accountName;
        window.nativeHandlers.getDesktopInputStatus = () => ({ available: true, detail: '' });
        window.nativeHandlers.getPanelSetupStatus = () => ({ status: 'other-desktop', detail: 'Use the VOCO tray menu for status and Stop.', canEnable: false });
        window.nativeHandlers.saveConfigPatch = ([patch]) => {
            if (window.failNextSave) {
                window.failNextSave = false;
                throw new Error('No space left on device');
            }
            window.saves.push(patch);
            window.config = { ...window.config, ...patch };
            return { revision: 2 + window.saves.length, config: window.config };
        };
        // Speech, then quiet, through the mocked capture worklet, the way a person says a word.
        window.say = async (seconds = 0.6) => {
            const batch = (loud) => Float32Array.from({ length: 1600 }, (_, i) => loud ? Math.sin(i / 20) * 0.2 : 0);
            const send = (loud) => window.captureWorklet?.port.onmessage?.({ data: { type: 'samples', data: batch(loud) } });
            for (let at = 0; at < seconds; at += 0.1) { send(true); await new Promise(resolve => setTimeout(resolve, 100)); }
            for (let at = 0; at < 2.5 && window.store.getState().status === 'recording'; at += 0.1) {
                send(false);
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        };
        window.quiet = async () => {
            const silence = Float32Array.from({ length: 1600 }, () => 0);
            for (let at = 0; at < 7 && window.store.getState().status === 'recording'; at += 0.1) {
                window.captureWorklet?.port.onmessage?.({ data: { type: 'samples', data: silence } });
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        };
    });
    const load = async ({ config = {}, name = 'Siobhán Kelly', passedShot = null } = {}) => {
        const query = new URLSearchParams({ config: JSON.stringify({ onboardingCompleted: false, englishSpelling: 'british', myWords: [], ...config }) });
        if (name !== null) query.set('name', name);
        await page.goto(origin + '/app-microphone-check?' + query);
        await page.waitForFunction(() => window.store?.getState().config);
        // The voice test has its own suites; here it has passed, and moves on to the words step.
        await page.evaluate(() => window.store.getState().setOnboardingTestPassed(true));
        await page.getByRole('heading', { name: 'VOCO heard you.' }).waitFor();
        assert.equal(await page.locator('.voco-panel__eyebrow').textContent(), 'Setup, step 2 of 4');
        if (passedShot) await shot(passedShot);
        await page.getByRole('button', { name: 'Continue', exact: true }).click();
        await page.getByRole('heading', { name: 'Will VOCO get your name right?' }).waitFor();
    };
    const shot = async (name, viewport = { width: 1040, height: 760 }) => {
        await page.setViewportSize(viewport);
        await page.evaluate(async () => { await document.fonts.load('600 19px Geist'); await document.fonts.ready; });
        await page.waitForTimeout(350);
        assert.equal(await page.locator('vite-error-overlay').count(), 0);
        await page.screenshot({ path: path.join(out, name + '.png') });
    };
    const saves = () => page.evaluate(() => window.saves);
    const nameField = () => page.getByRole('textbox', { name: 'Your name' });
    const result = () => page.locator('.voco-words-name .voco-word-check');
    // Say it, then speak; the check ends by itself when the voice stops.
    const sayName = async (heard, speak = true) => {
        await page.evaluate(heard => { window.heardNext = heard; }, heard);
        await page.locator('.voco-words-name').getByRole('button', { name: /^Say it/ }).click();
        await page.waitForFunction(() => window.store.getState().status === 'recording');
        await page.locator('.voco-words-name').getByText(/^Say “/).waitFor();
        await page.evaluate(speak => speak ? window.say() : window.quiet(), speak);
        await page.waitForFunction(() => window.store.getState().status === 'idle');
    };
    const pastes = () => page.evaluate(() => window.calls.filter(call => ['pasteDesktopText', 'copyDesktopText'].includes(call[0])).length);

    // The step opens with the account's name, focus on its question, and Skip.
    await load({ passedShot: 'setup-voice-passed' });
    assert.equal(await nameField().inputValue(), 'Siobhán Kelly');
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'voco-words-title');
    await page.getByText('Say it the way you usually do.', { exact: false }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Skip for now', exact: true }).count(), 1);
    // Setup names its step for screen readers; the marks show it.
    assert.equal(await page.locator('.voco-panel__eyebrow').textContent(), 'Setup, step 3 of 4');
    assert.deepEqual(await page.locator('.voco-setup-progress > [aria-hidden]').evaluateAll(marks => marks.map(mark => mark.dataset.state)),
        ['done', 'done', 'current', 'next']);
    assert.deepEqual(await saves(), [], 'Nothing is saved until the person says or keeps their name');
    // Setup suggests no kinds of words.
    assert.equal(await page.getByText(/people you work with|products/i).count(), 0);
    await shot('setup-words-name');
    results.push({ case: 'opens-with-the-account-name', passed: true });

    // Say it saves the name, listens, ends when the voice does, and shows what VOCO heard.
    await page.evaluate(() => { window.heardNext = 'Shivon Kelly.'; });
    await page.locator('.voco-words-name').getByRole('button', { name: /^Say it/ }).click();
    await page.waitForFunction(() => window.store.getState().status === 'recording');
    await page.locator('.voco-words-name').getByText('Say “Siobhán Kelly”.').waitFor();
    const done = page.getByRole('button', { name: 'Done saying Siobhán Kelly' });
    assert.equal(await done.evaluate(button => button === document.activeElement), true, 'Focus stays on the button that ends the check');
    await page.evaluate(() => {
        const loud = Float32Array.from({ length: 1600 }, (_, i) => Math.sin(i / 20) * 0.2);
        window.captureWorklet.port.onmessage({ data: { type: 'samples', data: loud } });
    });
    await shot('setup-words-listening');
    await page.evaluate(() => window.say());
    await page.waitForFunction(() => window.store.getState().status === 'idle');
    assert.deepEqual((await saves())[0], { myWords: ['Siobhán Kelly'], myWordsHeard: [] });
    await result().getByText('VOCO heard “Shivon Kelly”.').waitFor();
    assert.equal(await result().locator('mark').innerText(), 'Shivon');
    await result().getByText('Teach VOCO, and it writes “Siobhán” whenever it hears “Shivon”.').waitFor();
    const starts = await page.evaluate(() => window.speechRequests.filter(request => request.op === 'start'));
    assert.equal(starts.length, 1);
    assert.equal(starts[0].words_check, true, 'Rust starts a check as recognized');
    assert.equal(await pastes(), 0, 'A check never pastes or copies');
    assert.equal(await page.evaluate(() => (window.journalCalls ?? []).length), 0, 'A check never writes the crash journal');
    await shot('setup-words-heard');
    results.push({ case: 'say-it-shows-what-vocos-heard', passed: true });

    // Teaching saves the version for the one word VOCO misheard, then asks to check again.
    await result().getByRole('button', { name: 'Teach VOCO', exact: true }).click();
    await result().getByText('VOCO learned “Shivon”.').waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Say it again: Siobhán Kelly');
    assert.deepEqual((await saves()).at(-1), { myWords: ['Siobhán Kelly'], myWordsHeard: [{ heard: 'Shivon', writes: 'Siobhán' }] });
    await page.locator('.voco-words-name').getByRole('button', { name: 'Say it again: Siobhán Kelly' }).waitFor();
    await shot('setup-words-taught');
    // The worker now writes the name for that version.
    await sayName('Siobhán Kelly.');
    await result().getByText('VOCO writes “Siobhán Kelly”.').waitFor();
    await shot('setup-words-right');
    results.push({ case: 'teaching-saves-the-misheard-word', passed: true, saves: await saves() });

    // Nothing heard: check the microphone, and personalise VOCO later if they like.
    await sayName('', false);
    await result().getByText('VOCO didn’t hear anything.').waitFor();
    await result().getByText('You can always come back and personalise VOCO in Settings.', { exact: false }).waitFor();
    await shot('setup-words-nothing');
    results.push({ case: 'nothing-heard', passed: true });

    // A microphone that fails to open says why at once, with no notification,
    // and leaves setup as it was.
    await page.evaluate(() => { window.failNextStream = true; });
    const failedAt = Date.now();
    await page.locator('.voco-words-name').getByRole('button', { name: /^Say it/ }).click();
    await result().getByText('The check couldn’t finish.').waitFor();
    assert.ok(Date.now() - failedAt < 3000, 'A failed start is reported at once');
    await result().getByText('Initial preview failure', { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => window.calls.filter(call => call[0] === 'showNotification').length), 0);
    assert.deepEqual(await page.evaluate(() => ({ status: window.store.getState().status, error: window.store.getState().error })),
        { status: 'idle', error: null });
    results.push({ case: 'a-failed-start-is-reported-in-place', passed: true });

    // Anything else is theirs to type, and checks the same way.
    const more = page.getByRole('textbox', { name: 'Anything else VOCO should know?' });
    assert.equal(await more.getAttribute('placeholder'), 'Type a word or name');
    await more.fill('Tadhg');
    await more.press('Enter');
    await page.getByRole('list', { name: 'Words you added' }).getByText('Tadhg', { exact: true }).waitFor();
    assert.deepEqual((await saves()).at(-1).myWords, ['Siobhán Kelly', 'Tadhg']);
    await page.evaluate(() => { window.heardNext = 'Tiger.'; });
    await page.getByRole('button', { name: 'Say it: Tadhg' }).click();
    await page.waitForFunction(() => window.store.getState().status === 'recording');
    await page.evaluate(() => window.say());
    const tadhg = page.getByRole('list', { name: 'Words you added' }).locator('.voco-word-check');
    await tadhg.getByText('VOCO heard “Tiger”.').waitFor();
    // An everyday word: VOCO suggests saying it again before teaching it.
    await tadhg.getByText('“Tiger” is an everyday word, so VOCO would write “Tadhg” every time you say it.', { exact: false }).waitFor();
    assert.deepEqual(await tadhg.getByRole('button').allInnerTexts(), ['Try again', 'Teach anyway']);
    await shot('setup-words-everyday');
    results.push({ case: 'everyday-words-warn', passed: true });

    // Continue leaves the step, and the last screen hands off without the reminder.
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Your voice, ready.' }).waitFor();
    assert.equal(await page.getByText('You can always come back and personalise VOCO', { exact: false }).count(), 0);
    assert.equal(await page.locator('.voco-setup__transcript').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Test again', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
    assert.equal(await page.locator('.voco-panel__eyebrow').textContent(), 'Setup, step 4 of 4');
    await shot('setup-ready');
    results.push({ case: 'continue-reaches-the-handoff', passed: true });

    // A failed save while teaching keeps setup able to finish: Continue saves
    // again before it hands over.
    await load();
    await sayName('Shivon Kelly.');
    await page.evaluate(() => { window.failNextSave = true; });
    await result().getByRole('button', { name: 'Teach VOCO', exact: true }).click();
    await result().getByRole('alert').filter({ hasText: 'No space left on device' }).waitFor();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Your voice, ready.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Done', exact: true }).isEnabled(), true);
    assert.equal(await page.getByText('No space left on device', { exact: false }).count(), 0);
    results.push({ case: 'a-failed-save-never-blocks-done', passed: true });

    // Skip saves nothing, and the last screen says where My words is for later.
    await load();
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await page.getByRole('heading', { name: 'Your voice, ready.' }).waitFor();
    await page.getByText('You can always come back and personalise VOCO in Settings, under My words.').waitFor();
    assert.deepEqual(await saves(), []);
    await shot('setup-ready-skipped');
    results.push({ case: 'skip-saves-nothing-and-says-where-to-come-back', passed: true });

    // Continue without saying it keeps the name, edited if they changed it.
    await load();
    await nameField().fill('  Siobhán   Ní Kelly ');
    assert.equal(await page.getByRole('button', { name: 'Skip for now', exact: true }).count(), 1, 'Editing saves nothing yet');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Your voice, ready.' }).waitFor();
    assert.deepEqual(await saves(), [{ myWords: ['Siobhán Ní Kelly'], myWordsHeard: [] }]);
    await page.getByText('You can always come back and personalise VOCO in Settings, under My words.').waitFor();
    results.push({ case: 'continue-keeps-the-name', passed: true, saves: await saves() });

    // Without an account name the field asks for one, and an empty field saves nothing.
    await load({ name: null });
    assert.equal(await nameField().inputValue(), '');
    assert.equal(await nameField().getAttribute('placeholder'), 'Your name');
    assert.equal(await page.locator('.voco-words-name').getByRole('button', { name: /^Say it/ }).isDisabled(), true);
    await page.getByText('Type your name the way you write it.').waitFor();
    await shot('setup-words-no-name');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Your voice, ready.' }).waitFor();
    assert.deepEqual(await saves(), []);
    results.push({ case: 'no-account-name', passed: true });

    // A name VOCO can't list says why and stays to fix.
    await load({ name: null });
    await nameField().fill('Ops (on call)');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.locator('.voco-words-name').getByRole('alert').filter({ hasText: 'Use letters, digits' }).waitFor();
    assert.deepEqual(await saves(), []);
    results.push({ case: 'an-unlistable-name-stays-to-fix', passed: true });

    // A setup run again shows the saved name and nothing to skip.
    await load({ config: { myWords: ['Siobhán Kelly', 'GitHub'], myWordsHeard: [{ heard: 'Shivon', writes: 'Siobhán' }] } });
    assert.equal(await nameField().inputValue(), 'Siobhán Kelly');
    assert.equal(await page.getByRole('button', { name: 'Skip for now', exact: true }).count(), 0);
    results.push({ case: 'setup-again-keeps-the-saved-name', passed: true });

    // The smallest window keeps the name card and Continue on screen.
    await load();
    await page.setViewportSize({ width: 760, height: 560 });
    const box = await page.getByRole('button', { name: 'Continue', exact: true }).boundingBox();
    assert.ok(box && box.y + box.height <= 560, `Continue is visible: ${JSON.stringify(box)}`);
    await shot('setup-words-minimum-window', { width: 760, height: 560 });
    // Reduced motion, more contrast and forced colours keep every boundary.
    await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' });
    await shot('setup-words-more-contrast');
    await page.emulateMedia({ forcedColors: 'active' });
    await shot('setup-words-forced-colors');
    await page.emulateMedia({ reducedMotion: null, contrast: null, forcedColors: null });
    results.push({ case: 'minimum-window-and-accessibility-modes', passed: true });

    assert.equal(await pastes(), 0);
    assert.deepEqual(errors, []);
    await save('RESULTS.json', { passed: true, results, errors, mockedPlatform: true });
}
catch (error) {
    await save('FAILURE.json', {
        error: String(error), stack: error.stack, results, errors,
        diagnostics: await page?.evaluate(() => ({ text: document.body.innerText, state: { ...window.store?.getState(), config: window.store?.getState().config }, calls: window.calls, speech: window.speechRequests })).catch(() => null),
    });
    await page?.screenshot({ path: path.join(out, 'FAILURE.png') }).catch(() => {});
    throw error;
}
finally {
    await browser?.close();
    await server?.close();
}
