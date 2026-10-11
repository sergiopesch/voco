import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareEvidence, productionShell, openRenderer, routeTauriModules, routeAppShell, installRendererMocks } from './renderer-fixture.mjs';
// The English spelling choice in the actual App, with packaged fonts and CSS:
// setup's first question, keyboard and screen-reader semantics, the voice
// test's sentence, the Settings control and the one-time popover note. Every
// native boundary is mocked; no microphone, model or desktop is touched.
const { out, save } = await prepareEvidence(import.meta.url, [
    'src/App.tsx', 'src/components/ControlPanel.tsx', 'src/components/EnglishSpellingChoice.tsx',
    'src/components/Onboarding.tsx', 'src/lib/englishSpelling.ts', 'src/store/useStore.ts', 'src/english-spelling.css',
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
    const load = async (config, surface) => {
        await page.goto(origin + '/app-microphone-check?config=' + encodeURIComponent(JSON.stringify(config)));
        await page.waitForFunction(() => window.store?.getState().config);
        if (surface) await page.evaluate(surface => window.store.getState().setSurface(surface), surface);
    };
    const shot = async (name, viewport = { width: 1040, height: 760 }) => {
        await page.setViewportSize(viewport);
        await page.evaluate(async () => { await document.fonts.load('600 19px Geist'); await document.fonts.ready; });
        // Let the selection and sample transitions settle.
        await page.waitForTimeout(400);
        assert.equal(await page.locator('vite-error-overlay').count(), 0);
        await page.screenshot({ path: path.join(out, name + '.png') });
    };
    const saves = () => page.evaluate(() => window.saves);
    const reopenPopover = async () => {
        await page.evaluate(() => window.store.getState().setSurface('hidden'));
        await page.waitForFunction(() => !document.querySelector('.voco-popover'));
        await page.evaluate(() => window.store.getState().setSurface('popover'));
        await page.locator('.voco-popover').waitFor();
    };

    // A new person: the question comes first, British preselected.
    await load({ onboardingCompleted: false, englishSpelling: null });
    const group = page.getByRole('radiogroup', { name: 'Which English do you write?' });
    await group.waitFor();
    assert.equal(await page.evaluate(() => document.activeElement?.id), 'voco-spelling-title', 'The question takes focus');
    const british = group.getByRole('radio', { name: 'British English' });
    const american = group.getByRole('radio', { name: 'American English' });
    assert.equal(await british.isChecked(), true);
    assert.equal(await american.isChecked(), false);
    assert.equal(await british.evaluate(radio => radio.getAttribute('aria-describedby') && document.getElementById(radio.getAttribute('aria-describedby')).innerText.replace(/\s+/g, ' ')), 'colour · organise · travelling');
    assert.equal(await page.getByRole('button', { name: 'Start test', exact: true }).count(), 0);
    const flags = await page.locator('.voco-spelling__flag').evaluateAll(images => images.map(image => ({ src: image.getAttribute('src'), loaded: image.complete && image.naturalWidth > 0, alt: image.alt })));
    assert.deepEqual(flags, [{ src: '/flags/gb.svg', loaded: true, alt: '' }, { src: '/flags/us.svg', loaded: true, alt: '' }]);
    await shot('setup-spelling-british');
    results.push({ case: 'setup-opens-with-british-preselected', passed: true });

    // Keyboard: Tab reaches the checked card, an arrow key chooses and saves.
    await page.keyboard.press('Tab');
    assert.equal(await british.evaluate(radio => radio === document.activeElement), true);
    const ring = await page.locator('.voco-spelling__card').first().evaluate(card => getComputedStyle(card).outlineStyle);
    assert.equal(ring, 'solid', 'The focused card shows a focus ring');
    await page.keyboard.press('ArrowRight');
    await page.waitForFunction(() => window.saves.some(patch => patch.englishSpelling === 'american'));
    assert.equal(await american.isChecked(), true);
    await page.getByText('organized', { exact: true }).waitFor();
    assert.match(await page.locator('.voco-spelling__sample').innerText(), /I've organized the theater trip with my favorite neighbors\./);
    await shot('setup-spelling-american');
    results.push({ case: 'keyboard-choice-saves-and-updates-the-sample', passed: true, saves: await saves() });

    // Continue leads to the voice test, with focus on Start test and the sentence in that spelling.
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    const start = page.getByRole('button', { name: 'Start test', exact: true });
    await start.waitFor();
    assert.equal(await start.evaluate(button => button === document.activeElement), true);
    await page.getByText('Try saying “My favorite color is blue.”', { exact: true }).waitFor();
    await shot('setup-voice-test-american');
    results.push({ case: 'continue-reaches-the-voice-test-in-the-chosen-spelling', passed: true });

    // A failed save puts the saved choice back and says why. Continue saves the
    // shown choice again, so the voice test starts without the old error.
    await load({ onboardingCompleted: false, englishSpelling: null });
    await page.locator('.voco-spelling__card').nth(1).click();
    await page.waitForFunction(() => window.saves.at(-1)?.englishSpelling === 'american');
    await page.evaluate(() => { window.failNextSave = true; });
    await page.locator('.voco-spelling__card').nth(0).click();
    await page.getByRole('alert').filter({ hasText: 'No space left on device' }).waitFor();
    assert.equal(await page.getByRole('radio', { name: 'American English' }).isChecked(), true);
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    await page.getByRole('button', { name: 'Start test', exact: true }).waitFor();
    assert.equal(await page.getByText('Failed to save settings', { exact: false }).count(), 0);
    assert.deepEqual((await saves()).at(-1), { englishSpelling: 'american' });
    results.push({ case: 'a-failed-save-reverts-and-continue-saves-again', passed: true });

    // The smallest window shows every control without scrolling, after a save too.
    await load({ onboardingCompleted: false, englishSpelling: null });
    await page.setViewportSize({ width: 760, height: 560 });
    await page.locator('.voco-spelling__card').nth(1).click();
    await page.getByText('Saved on this device.', { exact: true }).waitFor();
    assert.equal(await page.locator('.voco-setup').evaluate(element => element.scrollHeight <= element.clientHeight + 1), true);
    // The clicked card may still be lifting on hover.
    const rows = await page.locator('.voco-spelling__card').evaluateAll(cards => cards.map(card => card.getBoundingClientRect().y));
    assert.ok(Math.abs(rows[0] - rows[1]) < 2, 'The cards stay side by side');
    await shot('setup-spelling-minimum-window', { width: 760, height: 560 });
    results.push({ case: 'minimum-window', passed: true });

    // Reduced motion, more contrast and forced colours keep the choice visible without motion.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await load({ onboardingCompleted: false, englishSpelling: null });
    assert.equal(await page.locator('.voco-spelling__card').first().evaluate(card => getComputedStyle(card).transitionDuration), '0s');
    const dots = await page.locator('.voco-spelling__mark').evaluateAll(marks => marks.map(mark => getComputedStyle(mark, '::after').transform));
    assert.deepEqual(dots, ['matrix(1, 0, 0, 1, 0, 0)', 'matrix(0, 0, 0, 0, 0, 0)'], 'Only the chosen card shows its dot');
    await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' });
    await shot('setup-spelling-more-contrast');
    await page.emulateMedia({ forcedColors: 'active' });
    const checked = await page.locator('.voco-spelling__card[data-checked="true"]').evaluate(card => getComputedStyle(card).borderTopWidth);
    assert.equal(checked, '2px', 'Forced colours mark the choice with a border');
    assert.deepEqual(await page.locator('.voco-spelling__mark').evaluateAll(marks => marks.map(mark => getComputedStyle(mark, '::after').transform)),
        ['matrix(1, 0, 0, 1, 0, 0)', 'matrix(0, 0, 0, 0, 0, 0)']);
    await shot('setup-spelling-forced-colors');
    await page.emulateMedia({ reducedMotion: null, contrast: null, forcedColors: null });
    results.push({ case: 'reduced-motion-contrast-and-forced-colors', passed: true });

    // Settings: the same cards, plus spelling as recognised.
    await load({ onboardingCompleted: true, englishSpelling: 'british' }, 'settings');
    const settings = page.getByRole('radiogroup', { name: 'Spelling' });
    await settings.waitFor();
    assert.equal(await settings.getByRole('radio').count(), 3);
    await page.getByText('Changes spelling only, never names or meaning.', { exact: false }).waitFor();
    await settings.getByText('Leave spelling as recognised', { exact: true }).click();
    await page.waitForFunction(() => window.saves.at(-1)?.englishSpelling === 'as-recognised');
    await settings.getByText('British English', { exact: true }).click();
    await page.waitForFunction(() => window.saves.at(-1)?.englishSpelling === 'british');
    await page.getByRole('heading', { name: 'Spelling' }).scrollIntoViewIfNeeded();
    await shot('settings-spelling');
    results.push({ case: 'settings-offers-three-spellings', passed: true, saves: await saves() });

    // For an earlier setup, choosing the preselected British in Settings saves it.
    await load({ onboardingCompleted: true, englishSpelling: null }, 'settings');
    const preselected = page.getByRole('radiogroup', { name: 'Spelling' });
    await preselected.waitFor();
    await preselected.getByText('British English', { exact: true }).click();
    await page.waitForFunction(() => window.saves.at(-1)?.englishSpelling === 'british');
    results.push({ case: 'settings-saves-the-preselected-british-for-earlier-setups', passed: true });

    // Someone set up before the choice existed sees a note in the popover until
    // they choose.
    await load({ onboardingCompleted: true, englishSpelling: null }, 'popover');
    await page.getByText('VOCO now spells in British English.', { exact: true }).waitFor();
    assert.equal(await page.locator('.voco-lens').count(), 0);
    await shot('popover-spelling-notice', { width: 420, height: 380 });
    const footer = await page.locator('.voco-popover__footer').evaluate(element => element.getBoundingClientRect().bottom);
    assert.ok(footer <= 380, 'The note keeps the popover footer inside the window');
    await reopenPopover();
    await page.getByText('VOCO now spells in British English.', { exact: true }).waitFor();
    // An answer by keyboard is confirmed where the note was, and focus moves on.
    await page.getByRole('button', { name: 'Use American English', exact: true }).focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => window.saves.at(-1)?.englishSpelling === 'american');
    await page.getByRole('status').filter({ hasText: 'VOCO spells in American English.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Hide to tray', exact: true }).evaluate(button => button === document.activeElement), true);
    await shot('popover-spelling-answered', { width: 420, height: 380 });
    // The next time the popover opens, the lens is back.
    await reopenPopover();
    await page.locator('.voco-lens').waitFor();
    assert.equal(await page.getByText('VOCO spells in American English.', { exact: true }).count(), 0);
    results.push({ case: 'popover-note-until-earlier-setups-choose', passed: true });

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
