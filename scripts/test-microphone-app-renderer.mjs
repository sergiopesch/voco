import assert from 'node:assert/strict';
import path from 'node:path';
import { prepareEvidence, openRenderer, routeTauriModules, routeAppShell, isolatedShell, installRendererMocks } from './renderer-fixture.mjs';
// WebKit microphone permission, device enumeration, retry and preview lifecycle in the actual
// App, hooks, store and ControlPanel; every native/media boundary is mocked.
// These checks never request host microphone access or model inference.
const { out, save } = await prepareEvidence(import.meta.url, [
    'src/App.tsx', 'src/components/ControlPanel.tsx', 'src/lib/microphoneRefresh.ts', 'src/lib/audioInput.ts', 'src/store/useStore.ts', 'src/lib/nativeCaptureSettings.ts', 'src/hooks/useNativeCaptureSettings.ts'
]);
const results = [], errors = [];
let server, browser, page, origin;
try {
    ({ server, browser, page, origin } = await openRenderer(errors));
    await routeTauriModules(page, 'export async function invoke(name) { if (name === "native_capture_capabilities") return {enabled:false}; if(name === "get_crash_journal_epoch") return 1; if(name.endsWith("_crash_journal")) return; throw new Error("Unexpected native command: " + name); }');
    await routeAppShell(page, isolatedShell);
    await installRendererMocks(page);
    // Each case starts a fresh App and enters the actual Microphone settings.
    const load = async (failPreview = false, resumeMode = 'normal') => {
        await page.goto(origin + '/app-microphone-check');
        await page.waitForFunction(() => window.store?.getState().availableDevices.length === 1);
        await page.evaluate(({failPreview, resumeMode}) => {
            window.store.getState().setSurface('settings');
            window.failNextStream = failPreview;
            window.resumeMode = resumeMode;
        }, {failPreview, resumeMode});
        await page.getByRole('button', {
            name: 'Test microphone',
            exact: true
        }).click();
        await page.getByRole('combobox', { name: /Input device/ }).waitFor();
    };
    const retry = async () => {
        await page.evaluate(() => window.store.getState().setMicrophonePermission('denied'));
        await page.getByRole('button', {name:'Retry microphone access',exact:true}).click();
        // Restore the pre-probe permission state while the injected request is pending.
        if (await page.evaluate(() => window.deferProbe)) await page.evaluate(() => window.store.getState().setMicrophonePermission('unknown'));
    };
    // Optional Permissions API support must not suppress enumeration or access.
    for (const mode of [
        'missing', 'throw', 'reject'
    ]) {
        await load();
        const before = await page.evaluate(mode => {
            window.setPermission(mode);
            window.store.getState().setMicrophonePermission('granted');
            window.enumDevice = 'refreshed-' + mode;
            const count = window.enumCount;
            navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
            return count;
        }, mode);
        await page.waitForFunction(({ mode, before }) => window.enumCount > before && window.store.getState().availableDevices[0]?.deviceId === 'refreshed-' + mode, {
            mode,
            before
        });
        const tracks = await page.evaluate(() => window.tracks.length);
        await retry();
        await page.waitForFunction(tracks => window.tracks.length > tracks && window.tracks[tracks].stops === 1, tracks);
        assert.equal(await page.evaluate(() => window.store.getState().microphonePermission), 'granted');
        results.push({
            case: 'optional-permission-' + mode,
            passed: true
        });
    }
    await load();
    await page.evaluate(() => {
        window.deferEnums = true;
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    await page.waitForFunction(() => window.enums.length === 1);
    await page.evaluate(() => navigator.mediaDevices.dispatchEvent(new Event('devicechange')));
    await page.waitForFunction(() => window.enums.length === 2);
    await page.evaluate(() => window.enums[1]([
        {
            kind: 'audioinput',
            deviceId: 'new',
            label: 'New'
        }
    ]));
    await page.waitForFunction(() => window.store.getState().availableDevices[0]?.deviceId === 'new');
    await page.evaluate(() => window.enums[0]([]));
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => window.store.getState().availableDevices[0].deviceId), 'new');
    results.push({
        case: 'out-of-order-enumeration',
        passed: true
    });
    await load();
    // The real settings-open event must complete while Permissions stays pending.
    const beforePending = await page.evaluate(() => {
        window.setPermission('pending');
        const n = window.enumCount;
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
        return n;
    });
    await page.waitForFunction(() => Boolean(window.resolvePermission));
    await page.waitForFunction(() => window.enumCount > 0);
    assert.ok(await page.evaluate(() => window.enumCount) > beforePending, 'Pending optional permission query must not block enumeration');
    await page.evaluate(() => {
        window.enumDevice = 'pending-new';
        window.store.getState().setSurface('hidden');
        window.listeners['voco:open-settings']({
            payload: {}
        });
    });
    await page.waitForFunction(() => window.store.getState().surface === 'settings' && window.store.getState().availableDevices[0]?.deviceId === 'pending-new');
    results.push({
        case: 'pending-permission-enumeration-and-open-settings',
        passed: true
    });
    await load();
    await page.evaluate(() => {
        window.deferProbe = true;
    });
    await retry();
    await page.waitForFunction(() => window.probes.length === 1);
    await page.evaluate(() => window.probes[0].reject(new DOMException('Device is busy', 'NotReadableError')));
    await page.waitForFunction(() => window.store.getState().status === 'error');
    assert.match(await page.evaluate(() => window.store.getState().error || ''), /Microphone could not be read/);
    results.push({
        case: 'device-error-detail-retained',
        passed: true
    });
    for (const name of [
        'NotAllowedError', 'OverconstrainedError', 'NotFoundError'
    ]) {
        await load();
        await page.evaluate(() => {
            window.deferProbe = true;
        });
        await retry();
        const attempts = name === 'NotAllowedError' ? 1 : 3;
        for (let i = 0; i < attempts; i++) {
            await page.waitForFunction(i => window.probes.length === i + 1, i);
            await page.evaluate(({ i, name }) => window.probes[i].reject(new DOMException('fixture detail', name)), {
                i,
                name
            });
        }
        await page.waitForFunction(() => window.store.getState().status === 'error');
        const state = await page.evaluate(() => ({
            error: window.store.getState().error,
            permission: window.store.getState().microphonePermission
        }));
        assert.match(state.error, /fixture detail/);
        assert.equal(state.permission === 'denied', name === 'NotAllowedError');
        results.push({
            case: 'error-' + name,
            passed: true
        });
    }
    await load();
    await page.evaluate(() => {
        window.deferProbe = true;
    });
    await retry();
    await page.waitForFunction(() => window.probes.length === 1);
    await retry();
    await page.waitForFunction(() => window.probes.length === 2);
    await page.evaluate(() => window.probes[1].resolve());
    await page.waitForFunction(() => window.store.getState().microphoneReady);
    await page.evaluate(() => window.probes[0].reject(new DOMException('obsolete refusal', 'NotAllowedError')));
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(() => window.store.getState().microphonePermission), 'granted');
    assert.equal(await page.evaluate(() => window.store.getState().microphoneReady), true);
    results.push({
        case: 'newer-success-older-refusal',
        passed: true
    });
    await load();
    await page.evaluate(() => {
        window.setPermission('pending');
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    await page.waitForFunction(() => Boolean(window.resolvePermission));
    await page.evaluate(() => {
        window.oldPermission = window.resolvePermission;
        window.setPermission('missing');
    });
    await retry();
    await page.waitForFunction(() => window.store.getState().microphoneReady);
    await page.evaluate(() => window.oldPermission({
        state: 'denied'
    }));
    await page.waitForTimeout(30);
    assert.equal(await page.evaluate(() => window.store.getState().microphonePermission), 'granted');
    results.push({
        case: 'stale-query-after-success',
        passed: true
    });
    // Old retry success and failure must not publish after ownership changes.
    for (const transition of [
        'recording', 'selection', 'unmount'
    ])
        for (const outcome of [
            'success', 'failure'
        ]) {
            await load();
            await page.evaluate(() => {
                window.deferProbe = true;
            });
            await retry();
            await page.waitForFunction(() => window.probes.length === 1);
            await page.evaluate(({ transition, outcome }) => {
                if (transition === 'recording')
                    window.store.getState().setStatus('recording');
                if (transition === 'selection')
                    window.store.getState().setSelectedDeviceId('different');
                if (transition === 'unmount')
                    window.reactRoot.unmount();
                window.store.getState().setMicrophoneReady(false);
                if (outcome === 'success')
                    window.probes[0].resolve();
                else
                    window.probes[0].reject(new DOMException('stale denial', 'NotAllowedError'));
            }, {
                transition,
                outcome
            });
            await page.waitForTimeout(70);
            assert.equal(await page.evaluate(() => window.store.getState().microphoneReady), false);
            if (transition === 'recording')
                assert.equal(await page.evaluate(() => window.store.getState().status), 'recording');
            if (outcome === 'success')
                assert.equal(await page.evaluate(() => window.tracks.at(-1).stops), 1);
            assert.notEqual(await page.evaluate(() => window.store.getState().microphonePermission), 'denied');
            results.push({
                case: 'late-retry-' + transition + '-' + outcome,
                passed: true
            });
        }
    await load();
    await page.evaluate(() => {
        window.deferEnums = true;
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
    });
    await page.waitForFunction(() => window.enums.length === 1);
    await page.evaluate(() => {
        window.reactRoot.unmount();
        window.enums[0]([
            {
                kind: 'audioinput',
                deviceId: 'obsolete',
                label: 'Obsolete'
            }
        ]);
    });
    await page.waitForTimeout(30);
    assert.notEqual(await page.evaluate(() => window.store.getState().availableDevices[0]?.deviceId), 'obsolete');
    results.push({
        case: 'enumeration-after-unmount',
        passed: true
    });
    // The actual ControlPanel owns the preview stream. Retry first probes and closes
    // that probe, then a successful current result must open exactly one preview.
    await load(true);
    await page.getByText('Initial preview failure', {
        exact: true
    }).waitFor();
    const beforeSuccess = await page.evaluate(() => window.streamRequests);
    await retry();
    await page.waitForFunction(() => window.tracks.length === 2 && window.tracks[0].stops === 1);
    await page.waitForFunction(() => Number(document.querySelector('.voco-meter__fill').style.transform.match(/scaleX\(([^)]+)\)/)?.[1]) > 0);
    assert.equal(await page.evaluate(() => window.streamRequests), beforeSuccess + 2);
    assert.equal(await page.evaluate(() => window.tracks[1].readyState), 'live');
    assert.equal(await page.getByText('Initial preview failure', {
        exact: true
    }).count(), 0);
    results.push({
        case: 'successful-retry-restarts-owned-preview-once',
        passed: true
    });
    await load(true);
    await page.getByText('Initial preview failure', {
        exact: true
    }).waitFor();
    const beforeFailure = await page.evaluate(() => {
        window.deferProbe = true;
        return window.streamRequests;
    });
    await retry();
    await page.waitForFunction(() => window.probes.length === 1);
    await page.evaluate(() => window.probes[0].reject(new DOMException('Retry still unavailable', 'NotReadableError')));
    await page.waitForFunction(() => window.store.getState().status === 'error');
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(() => window.streamRequests), beforeFailure + 1);
    assert.equal(await page.evaluate(() => window.tracks.length), 0);
    assert.equal(await page.getByText('Initial preview failure', {
        exact: true
    }).count(), 1);
    results.push({
        case: 'failed-retry-does-not-restart-preview',
        passed: true
    });
    // Resume is an asynchronous ownership boundary: failures release only this
    // preview, and a late completion must not connect an obsolete context.
    for (const mode of ['reject', 'stays-suspended']) {
        await load(false, mode);
        const message = mode === 'reject' ? 'Preview resume rejected' : 'Microphone preview audio context did not start.';
        await page.getByText(message, {exact:true}).waitFor();
        assert.equal(await page.evaluate(() => window.contexts.at(-1).state), 'closed');
        assert.equal(await page.evaluate(() => window.contexts.at(-1).sourceConnections), 0);
        assert.equal(await page.evaluate(() => window.tracks.at(-1).readyState), 'ended');
        results.push({case:'preview-resume-'+mode,passed:true});
    }
    for (const transition of ['selection', 'unmount']) {
        await load(false, 'pending');
        await page.waitForFunction(() => window.pendingResumes.length === 1);
        await page.evaluate(transition => {
            if (transition === 'selection') window.store.getState().setSelectedDeviceId('new-input');
            else window.reactRoot.unmount();
        }, transition);
        await page.waitForFunction(() => window.pendingResumes[0].context.state === 'closed');
        await page.evaluate(() => window.pendingResumes[0].resolve());
        await page.waitForTimeout(30);
        assert.equal(await page.evaluate(() => window.pendingResumes[0].context.sourceConnections), 0);
        assert.equal(await page.evaluate(() => window.tracks[0].readyState), 'ended');
        if (transition === 'selection') {
            await page.waitForFunction(() => window.pendingResumes.length === 2);
            await page.evaluate(() => window.pendingResumes[1].resolve());
            await page.waitForFunction(() => window.pendingResumes[1].context.sourceConnections === 1);
            assert.equal(await page.evaluate(() => window.tracks[1].readyState), 'live');
        }
        results.push({case:'late-preview-resume-'+transition,passed:true});
    }
    await load(false, 'pending');
    await page.waitForFunction(() => window.pendingResumes.length === 1);
    await page.evaluate(() => window.reactRoot.unmount());
    await page.waitForFunction(() => window.pendingResumes[0].context.state === 'closed');
    await page.evaluate(() => window.pendingResumes[0].reject(new Error('Late resume rejection')));
    await page.waitForTimeout(40);
    assert.equal(await page.evaluate(() => window.pendingResumes[0].context.closeCalls), 1);
    assert.equal(await page.evaluate(() => window.tracks[0].stops), 1);
    assert.equal(await page.evaluate(() => window.pendingResumes[0].context.sourceConnections), 0);
    results.push({case:'late-resume-rejection-releases-once',passed:true});
    await load();
    for (const status of ['starting','recording','processing','error','idle']) {
        await page.evaluate(status => {
            window.calls = [];
            window.store.setState({surface:'hidden',status,transcript:'This transcript must not appear in a popup.',captureNotice:'Capture notice'});
        },status);
        await page.waitForTimeout(60);
        assert.equal(await page.locator('.voco-status-overlay').count(),0);
        assert.equal(await page.getByText('This transcript must not appear in a popup.').count(),0);
        results.push({case:'dictation-keeps-window-hidden-'+status,passed:true});
    }
    await page.screenshot({path:path.join(out,'hidden-dictation.png')});
    await load();
    await page.evaluate(() => window.store.setState({surface:'settings',status:'idle'}));
    await page.getByRole('button', {name:'Settings',exact:true}).click();
    await page.getByRole('heading', {name:'Settings',exact:true}).waitFor();
    assert.equal(await page.title(), 'VOCO isolated settings');
    assert.equal(new URL(page.url()).pathname, '/app-microphone-check');
    for (const label of ['Appearance','Integrations','Realtime conversation']) {
        assert.equal(await page.getByRole('button', {name:label,exact:true}).count(), 0);
    }
    const bar = page.getByLabel('Move VOCO window', {exact:true});
    await bar.click({position:{x:12,y:20}});
    assert.equal(await page.evaluate(() => window.dragRequests), 1);
    await bar.click({position:{x:12,y:20},button:'right'});
    assert.equal(await page.evaluate(() => window.dragRequests), 1);
    await page.getByRole('button', {name:'Help',exact:true}).click();
    await page.getByRole('heading', {name:'Help',exact:true}).waitFor();
    assert.equal(await page.getByRole('combobox').count(),0);
    assert.equal(await page.locator('vite-error-overlay').count(),0);
    await page.screenshot({path:path.join(out,'dictation-settings.png')});
    await page.setViewportSize({width:760,height:560});
    await page.screenshot({path:path.join(out,'dictation-settings-compact.png')});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.screenshot({path:path.join(out,'dictation-settings-reduced-motion.png')});
    await page.getByRole('button', {name:'Hide to tray',exact:true}).click();
    await page.waitForFunction(() => window.store.getState().surface === 'hidden');
    assert.equal(await page.evaluate(() => window.dragRequests),1);
    assert.equal(await page.evaluate(() => Boolean(window.listeners['voco:toggle-realtime'])),false);
    results.push({case:'dictation-only-settings-and-single-drag-request',passed:true,
        scope:'Rendered App, mocked native startDragging; actual compositor movement requires native test'});
    assert.deepEqual(errors, []);
    await save('RESULTS.json', {
        passed: true,
        results,
        errors,
        mockedCapture: true,
        physicalMicrophone: false
    });
}
catch (error) {
    await save('FAILURE.json', {
        error: String(error),
        stack: error.stack,
        results,
        errors,
        diagnostics: await page?.evaluate(() => ({
            text: document.body.innerText,
            state: window.store?.getState(),
            calls: window.calls
        })).catch(() => null)
    });
    throw error;
}
finally {
    await browser?.close();
    await server?.close();
}
