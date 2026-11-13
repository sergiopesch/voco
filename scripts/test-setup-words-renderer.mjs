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
        // Rust says whether this VOCO can start at login: a package or the snap.
        if (new URLSearchParams(location.search).get('login') === '1') window.nativeHandlers.loginStartAvailable = () => true;
        // The Snap Store's VOCO, whose last screen always shows GNOME's setup.
        if (new URLSearchParams(location.search).get('store') === '1') window.nativeHandlers.storeUpdates = () => true;
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
    const load = async ({ config = {}, name = 'Siobhán Kelly', passedShot = null, desktopInput = null, panel = null, login = false, store = false } = {}) => {
        const query = new URLSearchParams({ config: JSON.stringify({ onboardingCompleted: false, englishSpelling: 'british', myWords: [], ...config }) });
        if (name !== null) query.set('name', name);
        if (login) query.set('login', '1');
        if (store) query.set('store', '1');
        await page.goto(origin + '/app-microphone-check?' + query);
        await page.waitForFunction(() => window.store?.getState().config);
        // Setup checks desktop input once the voice test passes.
        if (desktopInput) await page.evaluate(([input, status]) => {
            window.nativeHandlers.getDesktopInputStatus = () => input;
            window.nativeHandlers.getPanelSetupStatus = () => status;
        }, [desktopInput, panel]);
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
    // The offered name says where it came from.
    await page.getByText('From your account on this computer. Say it the way you usually do.', { exact: false }).waitFor();
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
    // A source build can't start at login, so the last screen says where to reopen VOCO.
    const handoffCopy = () => page.locator('.voco-setup__handoff').innerText();
    assert.match(await handoffCopy(), /from your app launcher/);
    assert.doesNotMatch(await handoffCopy(), /each time you sign in/);
    await shot('setup-ready');
    results.push({ case: 'continue-reaches-the-handoff', passed: true });

    // A package or the snap starts at login once setup is done, unless the
    // setting is off; setup itself saves nothing about it.
    const startsAtLogin = 'VOCO is running now, and starts by itself each time you sign in. You can turn that off in Settings.';
    await load({ login: true });
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await page.getByRole('heading', { name: 'Your voice, ready.' }).waitFor();
    await page.locator('.voco-setup__handoff').getByText(startsAtLogin, { exact: true }).waitFor();
    assert.doesNotMatch(await handoffCopy(), /from your app launcher/);
    assert.deepEqual(await saves(), []);
    await shot('setup-ready-starts-at-login');
    await load({ login: true, config: { startAtLogin: false } });
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await page.getByRole('heading', { name: 'Your voice, ready.' }).waitFor();
    assert.match(await handoffCopy(), /from your app launcher/);
    assert.doesNotMatch(await handoffCopy(), /each time you sign in/);
    results.push({ case: 'the-handoff-says-voco-starts-at-login-where-it-will', passed: true });

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

    // A fresh install's panel loads at the next login. Until then the focused
    // app also gets the shortcut, so the last screen leads with that and the fix.
    const signOut = 'Panel enabled. Sign out and back in to load it; saving your work first is recommended.';
    const leak = `Alt+D also reaches the app you are dictating into: browsers move the cursor to the address bar, so your words land there, and terminals delete a word. ${signOut}`;
    await load({ desktopInput: { available: true, detail: leak, setupArea: 'panel' }, panel: { status: 'restart', detail: signOut, canEnable: false } });
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await page.getByRole('heading', { name: 'Your voice, ready.' }).waitFor();
    const handoff = page.locator('.voco-setup__handoff');
    await handoff.getByText(leak, { exact: true }).waitFor();
    const handoffText = await handoff.innerText();
    assert.ok(handoffText.indexOf(leak) < handoffText.indexOf('Then choose Done, click where you want the text'), handoffText);
    assert.equal(handoffText.split('Sign out and back in').length, 2, 'The fix reads once');
    await page.getByRole('button', { name: 'Done', exact: true }).waitFor();
    await shot('setup-ready-shortcut-note');
    // The longer step still keeps Done on screen in the smallest window.
    await page.setViewportSize({ width: 760, height: 560 });
    const doneBox = await page.getByRole('button', { name: 'Done', exact: true }).boundingBox();
    assert.ok(doneBox && doneBox.y + doneBox.height <= 560, `Done is visible: ${JSON.stringify(doneBox)}`);
    await shot('setup-ready-shortcut-note-minimum-window', { width: 760, height: 560 });
    results.push({ case: 'the-last-screen-leads-with-the-shortcut-fix', passed: true });

    // Enable live panel there: within a diagnostics poll the note gives the next
    // step, and still says what the shortcut does until then.
    const consequence = 'Alt+D also reaches the app you are dictating into: browsers move the cursor to the address bar, so your words land there, and terminals delete a word.';
    const enableNote = `${consequence} Enable the VOCO panel in Help, then sign out and back in.`;
    await load({ desktopInput: { available: true, detail: enableNote, setupArea: 'panel' },
        panel: { status: 'disabled', detail: 'Enable live microphone bars and the VOCO menu in your top panel.', canEnable: true } });
    await page.evaluate(([note, after, restart]) => {
        window.liveNote = note;
        window.nativeHandlers.getRuntimeDiagnostics = () => ({ sessionType: 'wayland', typeSimulation: { available: true, missingCommands: [] },
            clipboard: { available: true, missingCommands: [] }, ibusShortcut: { setupState: 'ready', available: true },
            desktopInput: { available: true, detail: window.liveNote, setupArea: 'panel' } });
        window.nativeHandlers.enableGnomePanel = () => { window.liveNote = after; return restart; };
    }, [enableNote, `${consequence} ${signOut}`, { status: 'restart', detail: signOut, canEnable: false }]);
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await handoff.getByText(enableNote, { exact: true }).waitFor();
    await handoff.getByRole('button', { name: 'Enable live panel', exact: true }).click();
    await handoff.getByText(`${consequence} ${signOut}`, { exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await handoff.getByText('Enable the VOCO panel in Help', { exact: false }).count(), 0);
    assert.equal((await handoff.innerText()).split('Sign out and back in').length, 2, 'The fix reads once');
    results.push({ case: 'enabling-the-panel-updates-the-shortcut-note', passed: true });

    // The snap on GNOME Wayland types through GNOME's RemoteDesktop portal, which
    // asks once, from the person's click. Its shortcut then joins GNOME's keyboard
    // shortcuts by itself, which asks nobody, and Done waits until GNOME holds it:
    // nothing else there reaches VOCO (AGENTS.md, Onboarding).
    const needsTyping = 'VOCO types into your apps through GNOME, which asks you once. Choose Allow typing, then turn on Allow Remote Interaction in GNOME\'s dialog and choose Share.';
    const needsShortcut = (hotkey) => `${hotkey} doesn't reach VOCO yet. Choose Add ${hotkey}, and VOCO adds it to GNOME's keyboard shortcuts.`;
    const portal = { applies: true, typingAllowed: false, panelAttached: false, panelHoldsShortcut: false, shortcutAvailable: true, shortcutBound: false };
    const shortcutCalls = () => page.evaluate(() => window.calls.filter(([name]) => name === 'holdGnomeShortcut').length);
    const doneButton = page.getByRole('button', { name: 'Done', exact: true });
    await load({
        desktopInput: { available: false, setupArea: 'portal', detail: needsTyping },
        panel: { status: 'optional', canEnable: false, url: 'https://extensions.gnome.org/extension/11710/voco/',
            detail: 'Optional: the VOCO panel adds live microphone bars and Stop to your top bar, and VOCO then types without GNOME\'s orange icon. Get it from extensions.gnome.org.' } });
    await page.evaluate(status => {
        window.portal = { ...status };
        window.nativeHandlers.getPortalSetupStatus = () => ({ ...window.portal });
        // GNOME's dialog stays open until the test answers it.
        window.nativeHandlers.allowPortalTyping = () => new Promise(resolve => { window.answerTyping = () => {
            window.portal.typingAllowed = true; resolve({ ...window.portal }); }; });
        // GNOME's keyboard shortcuts answer at once; held here to see setup wait.
        window.nativeHandlers.holdGnomeShortcut = () => new Promise(resolve => { window.answerShortcut = () => {
            window.portal.shortcutBound = true; resolve({ ...window.portal }); }; });
    }, portal);
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    const setup = page.getByRole('region', { name: 'Voice setup' }).or(page.locator('.voco-setup'));
    const permissions = setup.getByRole('group', { name: 'Typing and shortcut' });
    await permissions.getByText('GNOME asks you once: turn on Allow Remote Interaction, then choose Share.', { exact: false }).waitFor();
    assert.equal(await setup.getByRole('button', { name: 'Get the VOCO panel', exact: true }).count(), 0, 'Setup never asks for the panel');
    assert.equal(await setup.getByText('extensions.gnome.org', { exact: false }).count(), 0, 'Nothing outside VOCO and GNOME');
    assert.equal(await setup.getByText('Open setup instructions').count(), 0, 'GNOME\'s permission is the only remedy');
    assert.equal(await handoff.count(), 0, 'Setup stops until GNOME lets VOCO type');
    await shot('setup-snap-allow-typing');
    await permissions.getByRole('button', { name: 'Allow typing', exact: true }).click();
    await permissions.getByRole('button', { name: 'Waiting for GNOME…', exact: true }).waitFor();
    await permissions.getByText('GNOME’s dialog is open. Turn on Allow Remote Interaction, then choose Share.', { exact: true }).waitFor();
    // A second click while GNOME's dialog is open asks nothing more.
    await permissions.getByRole('button', { name: 'Waiting for GNOME…', exact: true }).click();
    assert.equal(await page.evaluate(() => window.calls.filter(([name]) => name === 'allowPortalTyping').length), 1);
    assert.equal(await shortcutCalls(), 0, 'The typing step adds no shortcut');
    await shot('setup-snap-waiting-for-gnome');
    // GNOME allowed it: setup checks desktop input again and moves on with no other click.
    await page.evaluate((detail) => {
        const ready = { available: true, detail, setupArea: 'portal' };
        window.nativeHandlers.getDesktopInputStatus = () => ready;
        const earlier = window.nativeHandlers.getRuntimeDiagnostics;
        window.nativeHandlers.getRuntimeDiagnostics = (args) => ({ ...(earlier ? earlier(args) : {}),
            sessionType: 'wayland', typeSimulation: { available: true, missingCommands: [] }, clipboard: { available: true, missingCommands: [] },
            ibusShortcut: { setupState: 'not-installed', available: false }, desktopInput: ready,
            desktopPaste: { enabled: true, available: true, detail: '' }, shortcut: { hotkey: 'Alt+D', route: null, state: 'unknown', detail: '' } });
        window.answerTyping();
    }, needsShortcut('Alt+D'));
    await handoff.waitFor({ timeout: 5000 });
    await page.getByRole('heading', { name: 'Your voice, ready.' }).waitFor();
    // The shortcut comes next with no click at all, and Done waits for it.
    const handoffPermissions = handoff.getByRole('group', { name: 'Typing and shortcut' });
    await handoffPermissions.getByText('VOCO can type into your apps.', { exact: false }).waitFor();
    await handoffPermissions.getByText('to GNOME’s keyboard shortcuts…', { exact: false }).waitFor();
    assert.equal(await shortcutCalls(), 1, 'Setup adds the shortcut by itself');
    assert.equal(await doneButton.isDisabled(), true, 'Done waits until GNOME holds the shortcut');
    assert.equal(await handoff.getByRole('button', { name: /^Add /, exact: false }).count(), 0, 'No button to find and choose');
    assert.equal(await page.getByRole('button', { name: 'Finish without a shortcut', exact: true }).count(), 0);
    assert.equal(await handoff.getByRole('button', { name: 'Get the VOCO panel', exact: true }).count(), 0, 'The handoff never asks for the panel');
    await shot('setup-snap-adding-shortcut');
    await page.evaluate(() => window.answerShortcut());
    await handoffPermissions.getByText('starts and stops dictation. You can change it in VOCO’s Settings, under Shortcut.', { exact: false }).waitFor();
    assert.equal(await handoffPermissions.locator('strong').last().textContent(), 'Alt+D');
    assert.equal(await doneButton.isEnabled(), true, 'The shortcut is ready when setup ends');
    assert.equal(await shortcutCalls(), 1);
    await handoff.getByText('Choose Done, click where you want the text and press', { exact: false }).waitFor();
    await shot('setup-snap-ready');
    results.push({ case: 'the-snap-asks-gnome-for-typing-then-adds-its-shortcut-itself', passed: true });

    // GNOME refused: setup says so in its words and offers the button again.
    await load({ desktopInput: { available: false, setupArea: 'portal', detail: needsTyping }, panel: { status: 'optional', canEnable: false, detail: 'Optional.' } });
    await page.evaluate(status => {
        window.nativeHandlers.getPortalSetupStatus = () => ({ ...status });
        window.nativeHandlers.allowPortalTyping = () => Promise.reject('GNOME didn\'t allow VOCO to type. Choose Allow typing again, turn on Allow Remote Interaction, then choose Share.');
    }, portal);
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await page.getByRole('button', { name: 'Allow typing', exact: true }).click();
    await page.getByRole('alert').filter({ hasText: 'GNOME didn\'t allow VOCO to type.' }).waitFor();
    await page.getByRole('button', { name: 'Allow typing', exact: true }).waitFor();
    assert.equal(await handoff.count(), 0, 'Setup stays until GNOME lets VOCO type');
    await shot('setup-snap-typing-refused');
    results.push({ case: 'a-refusal-keeps-the-step-and-offers-it-again', passed: true });

    // Something else in GNOME already uses the keys: setup says what, keeps
    // Done waiting, and offers VOCO's other shortcuts. Choosing one saves it,
    // and a refused choice is no failed save: setup stays on its last screen.
    const taken = 'Super+X is already your custom shortcut “Terminal”. Choose another shortcut, or free Super+X in GNOME Settings, under Keyboard.';
    await load({ desktopInput: { available: true, setupArea: 'portal', detail: needsShortcut('Super+X') },
        config: { hotkey: 'Super+X' }, panel: { status: 'optional', canEnable: false, detail: 'Optional.' } });
    await page.evaluate(([status, refusal]) => {
        window.portalTaken = { ...status, typingAllowed: true };
        window.nativeHandlers.getPortalSetupStatus = () => ({ ...window.portalTaken });
        window.nativeHandlers.holdGnomeShortcut = () => Promise.reject(refusal);
        // Rust saves the choice, moves GNOME's shortcut with the save and
        // tells the window its new config; refused, nothing changes.
        window.nativeHandlers.chooseGnomeShortcut = ([hotkey]) => {
            if (hotkey === 'Alt+D') return Promise.reject('Alt+D is already GNOME\'s show-desktop shortcut. Choose another shortcut, or free Alt+D in GNOME Settings, under Keyboard.');
            window.portalTaken.shortcutBound = true;
            const { config, setConfig } = window.store.getState();
            setConfig({ ...config, hotkey });
            return { ...window.portalTaken };
        };
    }, [portal, taken]);
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    const refused = handoff.getByRole('group', { name: 'Typing and shortcut' });
    await refused.getByRole('alert').filter({ hasText: 'Super+X is already your custom shortcut “Terminal”.' }).waitFor();
    assert.equal(await doneButton.isDisabled(), true, 'Done waits while no shortcut reaches VOCO');
    await refused.getByRole('button', { name: 'Try Super+X again', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Finish without a shortcut', exact: true }).waitFor();
    assert.equal(await handoff.getByText('click where you want the text and press', { exact: false }).count(), 0, 'Setup names no shortcut that does nothing');
    await shot('setup-snap-shortcut-taken');
    await refused.getByRole('button', { name: 'Try Super+X again', exact: true }).click();
    await refused.getByRole('alert').filter({ hasText: 'Super+X is already your custom shortcut “Terminal”.' }).waitFor();
    assert.equal(await shortcutCalls(), 2, 'Once by itself, once from the button');
    // Another preset that is taken too says so, and the choices stay.
    await refused.getByRole('button', { name: 'Use Alt+D', exact: true }).click();
    await refused.getByRole('alert').filter({ hasText: 'Alt+D is already GNOME\'s show-desktop shortcut.' }).waitFor();
    assert.equal(await page.evaluate(() => window.store.getState().config.hotkey), 'Super+X');
    assert.equal(await doneButton.isDisabled(), true);
    await refused.getByRole('button', { name: 'Use Alt+Shift+D', exact: true }).click();
    await refused.getByText('starts and stops dictation. You can change it in VOCO’s Settings, under Shortcut.', { exact: false }).waitFor();
    assert.equal(await refused.locator('strong').last().textContent(), 'Alt+Shift+D');
    assert.equal(await page.evaluate(() => window.store.getState().config.hotkey), 'Alt+Shift+D');
    await handoff.getByText('Choose Done, click where you want the text and press', { exact: false }).waitFor();
    assert.equal(await handoff.locator('kbd').first().innerText(), 'Alt+Shift+D', 'The last screen names the shortcut that works');
    assert.equal(await doneButton.isEnabled(), true);
    assert.equal(await page.getByRole('button', { name: 'Finish without a shortcut', exact: true }).count(), 0);
    assert.equal(await shortcutCalls(), 2, 'The save moved GNOME\'s shortcut; setup asks nothing more');
    await shot('setup-snap-other-shortcut');
    results.push({ case: 'a-taken-shortcut-offers-vocos-others', passed: true });

    // A panel from extensions.gnome.org before version 23 types but grabs only
    // Alt chords: with Super+X, setup still adds GNOME's shortcut, never
    // claiming the panel holds it.
    await load({ desktopInput: { available: true, setupArea: 'portal', detail: needsShortcut('Super+X') },
        config: { hotkey: 'Super+X' }, panel: { status: 'active', canEnable: false, detail: 'The VOCO panel is active.' } });
    await page.evaluate(status => {
        window.portalPanel = { ...status, panelAttached: true, panelHoldsShortcut: false };
        window.nativeHandlers.getPortalSetupStatus = () => ({ ...window.portalPanel });
        window.nativeHandlers.holdGnomeShortcut = () => { window.portalPanel.shortcutBound = true; return { ...window.portalPanel }; };
    }, portal);
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    const olderPanel = handoff.getByRole('group', { name: 'Typing and shortcut' });
    await olderPanel.getByText('The VOCO panel types for VOCO.', { exact: true }).waitFor();
    assert.equal(await olderPanel.getByText('holds Super+X', { exact: false }).count(), 0, 'An older panel never holds Super+X');
    assert.equal(await olderPanel.getByRole('button', { name: 'Allow typing', exact: true }).count(), 0, 'The panel types, so GNOME needn\'t');
    await olderPanel.getByText('starts and stops dictation. You can change it in VOCO’s Settings, under Shortcut.', { exact: false }).waitFor();
    assert.equal(await shortcutCalls(), 1);
    assert.equal(await doneButton.isEnabled(), true);
    await shot('setup-snap-older-panel-ready');
    results.push({ case: 'an-older-panel-still-gets-gnomes-shortcut', passed: true });

    // A panel that holds the saved chord itself: nothing to add. The store's
    // VOCO shows GNOME's setup on its last screen whatever the shortcut's state.
    await load({ store: true, desktopInput: { available: true, detail: '' }, config: { hotkey: 'Alt+D' }, panel: { status: 'active', canEnable: false, detail: 'The VOCO panel is active.' } });
    await page.evaluate(status => {
        window.nativeHandlers.getPortalSetupStatus = () => ({ ...status, panelAttached: true, panelHoldsShortcut: true });
        window.nativeHandlers.holdGnomeShortcut = () => { throw new Error('Setup must not add a shortcut the panel holds'); };
    }, portal);
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await handoff.getByText('The VOCO panel types for VOCO and holds', { exact: false }).waitFor();
    assert.equal(await doneButton.isEnabled(), true);
    assert.equal(await shortcutCalls(), 0);
    results.push({ case: 'a-panel-that-holds-the-shortcut-needs-none-added', passed: true });

    // GNOME's keyboard shortcuts out of VOCO's reach: setup says how to add
    // one by hand and never holds Done for something it can't do. On X11 the
    // snap grabs the chord itself and shows none of this.
    await load({ store: true, desktopInput: { available: true, detail: '' }, config: { hotkey: 'Super+X' }, panel: { status: 'optional', canEnable: false, detail: 'Optional.' } });
    await page.evaluate(status => {
        window.nativeHandlers.getPortalSetupStatus = () => ({ ...status, typingAllowed: true, shortcutAvailable: false });
        window.nativeHandlers.holdGnomeShortcut = () => { throw new Error('Nothing to add here'); };
    }, portal);
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await handoff.getByText('Add a shortcut named VOCO with the command', { exact: false }).waitFor();
    assert.equal(await doneButton.isEnabled(), true);
    assert.equal(await shortcutCalls(), 0);
    await load({ store: true, desktopInput: { available: true, detail: '' }, panel: { status: 'other-desktop', canEnable: false, detail: 'Use the tray menu.' } });
    await page.evaluate(status => { window.nativeHandlers.getPortalSetupStatus = () => ({ ...status, applies: false, shortcutAvailable: false }); }, portal);
    await page.getByRole('button', { name: 'Skip for now', exact: true }).click();
    await handoff.waitFor();
    await page.waitForFunction(() => !document.querySelector('.voco-setup__actions .voco-button--primary')?.disabled);
    assert.equal(await handoff.getByRole('group', { name: 'Typing and shortcut' }).count(), 0);
    assert.equal(await shortcutCalls(), 0);
    results.push({ case: 'setup-never-waits-for-a-shortcut-it-cannot-add', passed: true });

    // Continue without saying it keeps the name, edited if they changed it.
    await load();
    await nameField().fill('  Siobhán   Ní Kelly ');
    assert.equal(await page.getByRole('button', { name: 'Skip for now', exact: true }).count(), 1, 'Editing saves nothing yet');
    assert.equal(await page.getByText('From your account on this computer.', { exact: false }).count(), 0, 'An edited name is the person\'s own');
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
    assert.equal(await page.getByText('From your account on this computer.', { exact: false }).count(), 0, 'A saved name is already theirs');
    // A name changed in an earlier setup isn't offered beside the account's again.
    await load({ config: { myWords: ['Shiv Kelly'] } });
    assert.equal(await nameField().inputValue(), '');
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('heading', { name: 'Your voice, ready.' }).waitFor();
    assert.deepEqual(await saves(), []);
    results.push({ case: 'setup-again-keeps-the-saved-list', passed: true });

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
