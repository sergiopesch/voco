import { chromium } from 'playwright';
import { createServer } from 'vite';
import { readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
// Actual App, hooks, store and ControlPanel; every native/media boundary is mocked.
// These checks never request host microphone access or model inference.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = process.env.VOCO_RENDERER_EVIDENCE_DIR;
if (!out)
    throw Error('Exclusive VOCO_RENDERER_EVIDENCE_DIR required');
await mkdir(out, {
    recursive: false
});
await writeFile(path.join(out, 'harness.mjs'), await readFile(fileURLToPath(import.meta.url)), {
    flag: 'wx'
});
const results = [], errors = [];
let server, browser, page;
const save = (n, v) => writeFile(path.join(out, n), JSON.stringify(v, null, 2) + '\n', {
    flag: 'wx'
});
const files = [
    'src/App.tsx', 'src/components/ControlPanel.tsx', 'src/lib/microphoneRefresh.ts', 'src/lib/audioInput.ts', 'src/store/useStore.ts', 'src/lib/nativeCaptureSettings.ts', 'src/hooks/useNativeCaptureSettings.ts'
];
await save('SOURCE.json', Object.fromEntries(await Promise.all(files.map(async (f) => [
    f, createHash('sha256').update(await readFile(path.join(root, 'apps/desktop', f))).digest('hex')
]))));
try {
    server = await createServer({
        configFile: path.join(root, 'apps/desktop/vite.config.ts'),
        root: path.join(root, 'apps/desktop'),
        logLevel: 'warn',
        server: {
            host: '127.0.0.1',
            port: 0,
            hmr: false,
            fs: {
                allow: [
                    root, await realpath(path.join(root, 'node_modules'))
                ]
            }
        }
    });
    await server.listen();
    const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
    browser = await chromium.launch({
        headless: true
    });
    const context = await browser.newContext({
        viewport: {
            width: 1100,
            height: 800
        }
    });
    await context.grantPermissions([
        'local-network-access'
    ], {
        origin
    });
    page = await context.newPage();
    page.setDefaultTimeout(8000);
    page.on('pageerror', e => errors.push(e.message));
    const tauri = await readFile(path.join(root, 'apps/desktop/src/lib/tauri.ts'), 'utf8');
    const names = [
        ...tauri.matchAll(/export (?:async )?function (\w+)/g)
    ].map(x => x[1]);
    const native = names.map(n => `export const ${n} = async (...args) => window.nativeCall(${JSON.stringify(n)},args);`).join('\n');
    await page.route('**/src/lib/tauri.ts*', r => r.fulfill({
        contentType: 'application/javascript',
        body: native
    }));
    await page.route('**/@tauri-apps_api_core.js*', r => r.fulfill({
        contentType: 'application/javascript',
        body: 'export async function invoke(name) { if (name === "native_capture_capabilities") return {enabled:false}; throw new Error("Unexpected native command: " + name); }'
    }));
    await page.route('**/@tauri-apps_api_app.js*', r => r.fulfill({
        contentType: 'application/javascript',
        body: 'export const getVersion=async()=>"2026.0.21";'
    }));
    await page.route('**/@tauri-apps_api_window.js*', r => r.fulfill({
        contentType: 'application/javascript',
        body: `
          const windowHandle = new Proxy({}, {
            get: (_, name) => {
              if (name === 'listen') return async (event, callback) => {
                window.listeners[event] = callback;
                return () => delete window.listeners[event];
              };
              if (name.startsWith('on')) return async () => () => {};
              if (name === 'startDragging') return async () => { window.dragRequests = (window.dragRequests || 0) + 1; };
              if (name === 'scaleFactor') return async () => 1;
              if (name === 'isFocused') return async () => true;
              return async () => {};
            }
          });
          export const getCurrentWindow = () => windowHandle;
          export const currentMonitor = async () => null;
          export const availableMonitors = async () => [];
        `
    }));
    await page.route('https://api.github.com/**', r => r.fulfill({
        json: []
    }));
    await page.route('**/app-microphone-check', r => r.fulfill({
        contentType: 'text/html',
        body: `
          <title>VOCO isolated settings</title>
          <link rel="stylesheet" href="/src/styles.css">
          <div id="root"></div>
          <script type="module">
            import React from '/node_modules/.vite/deps/react.js';
            import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
            import { App } from '/src/App.tsx';
            import { useStore } from '/src/store/useStore.ts';
            window.store = useStore;
            window.reactRoot = ReactDOM.createRoot(document.getElementById('root'));
            window.reactRoot.render(React.createElement(App));
          </script>
        `
    }));
    // Install deterministic device, permission and audio mocks before App imports.
    await page.addInitScript(() => {
        window.listeners = {};
        window.calls = [];
        window.tracks = [];
        window.enums = [];
        window.probes = [];
        window.deferEnums = false;
        window.deferProbe = false;
        window.permissionMode = 'missing';
        window.contexts = [];
        window.pendingResumes = [];
        window.resumeMode = 'normal';
        window.config = {
            hotkey: 'Alt+D',
            selectedMic: null,
            insertionStrategy: 'auto',
            transcriptTarget: 'cursor',
            liveCursorMode: 'final-text-only',


            transcriptEnhancement: 'off',


            onboardingCompleted: false,
            updateChannel: 'stable',
            installChannel: 'github-release',
            voiceProfile: 'default'
        };
        window.nativeCall = async (name, args) => {
            window.calls.push([
                name, ...args
            ]);
            if (name === 'getConfig')
                return {
                    revision: 1,
                    config: window.config
                };
            if (name === 'getRuntimeDiagnostics')
                return {
                    sessionType: 'wayland',
                    typeSimulation: {
                        available: true,
                        missingCommands: [],
                        optionalMissingCommands: []
                    },
                    clipboard: {
                        available: true,
                        missingCommands: []
                    },
                    ownedPreedit: {
                        setupState: 'ready',
                        available: true
                    }
                };
            if (name === 'beginRuntimeStatusSession')
                return 1;
            if (name === 'loadCachedUpdateState')
                return null;
            return false;
        };
        const media = new EventTarget();
        media.enumerateDevices = () => {
            window.enumCount = (window.enumCount || 0) + 1;
            return window.deferEnums ? new Promise(resolve => window.enums.push(resolve)) : Promise.resolve([
                {
                    kind: 'audioinput',
                    deviceId: window.enumDevice || 'mic-a',
                    label: 'Mic A'
                }
            ]);
        };
        const stream = () => {
            const track = new EventTarget();
            track.readyState = 'live';
            track.stop = () => {
                track.readyState = 'ended';
                track.stops = (track.stops || 0) + 1;
            };
            window.tracks.push(track);
            return {
                getTracks: () => [
                    track
                ],
                getAudioTracks: () => [
                    track
                ]
            };
        };
        media.getUserMedia = async () => {
            window.streamRequests = (window.streamRequests || 0) + 1;
            if (window.failNextStream) {
                window.failNextStream = false;
                throw new DOMException("Initial preview failure", "NotReadableError");
            }
            if (window.deferProbe)
                return new Promise((resolve, reject) => window.probes.push({
                    resolve: () => resolve(stream()),
                    reject
                }));
            return stream();
        };
        Object.defineProperty(navigator, 'mediaDevices', {
            configurable: true,
            value: media
        });
        window.setPermission = mode => {
            window.permissionMode = mode;
            Object.defineProperty(navigator, 'permissions', {
                configurable: true,
                value: mode === 'missing' ? undefined : {
                    query: () => {
                        if (mode === 'pending')
                            return new Promise(resolve => window.resolvePermission = resolve);
                        if (mode === 'throw')
                            throw Error('unsupported');
                        if (mode === 'reject')
                            return Promise.reject(Error('unsupported'));
                        return Promise.resolve({
                            state: mode
                        });
                    }
                }
            });
        };
        window.setPermission('missing');
        class Node {
            connect() {
            }
            disconnect() {
            }
        }
        window.AudioContext = class {
            constructor() { window.contexts.push(this); }
            sourceConnections = 0;
            resumeCalls = 0;
            closeCalls = 0;
            state = 'suspended';
            sampleRate = 16000;
            destination = {};
            audioWorklet = {
                addModule: async () => {
                }
            };
            resume() {
                this.resumeCalls += 1;
                if (window.resumeMode === 'reject') return Promise.reject(new Error('Preview resume rejected'));
                if (window.resumeMode === 'pending') return new Promise((resolve, reject) => {
                    window.pendingResumes.push({
                        context: this,
                        resolve: () => { if (this.state !== 'closed') this.state = 'running'; resolve(); },
                        reject,
                    });
                });
                if (window.resumeMode !== 'stays-suspended') this.state = 'running';
                return Promise.resolve();
            }
            close() {
                this.closeCalls += 1;
                this.state = 'closed';
                return Promise.resolve();
            }
            createMediaStreamSource() {
                this.sourceConnections += 1;
                return new Node();
            }
            createAnalyser() {
                return Object.assign(new Node(), {
                    fftSize: 512,
                    getFloatTimeDomainData: a => {
                        for (let i = 0; i < a.length; i++)
                            a[i] = this.state === 'running' ? Math.sin(i / 8) * .2 : 0;
                    }
                });
            }
        };
    });
    // Each case starts a fresh App and enters the actual onboarding microphone step.
    const load = async (failPreview = false, resumeMode = 'normal') => {
        await page.goto(origin + '/app-microphone-check');
        await page.waitForFunction(() => window.store?.getState().availableDevices.length === 1);
        await page.evaluate(({failPreview, resumeMode}) => {
            window.store.getState().setSurface('onboarding');
            window.failNextStream = failPreview;
            window.resumeMode = resumeMode;
        }, {failPreview, resumeMode});
        await page.getByRole('button', {
            name: 'Start setup',
            exact: true
        }).click();
        await page.getByRole('button', {
            name: 'Retry microphone access',
            exact: true
        }).waitFor();
    };
    const retry = () => page.getByRole('button', {
        name: 'Retry microphone access',
        exact: true
    }).click();
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
            window.store.setState({surface:'hidden',status,interimTranscript:'This transcript must not appear in a popup.',captureNotice:'Capture notice'});
        },status);
        await page.waitForTimeout(60);
        assert.equal(await page.locator('.voco-status-overlay').count(),0);
        assert.equal(await page.evaluate(()=>window.calls.some(c=>c[0]==='showStatusOverlay')),false);
        assert.equal(await page.getByText('This transcript must not appear in a popup.').count(),0);
        results.push({case:'dictation-keeps-window-hidden-'+status,passed:true});
    }
    await page.screenshot({path:path.join(out,'hidden-dictation.png')});
    await load();
    await page.evaluate(() => window.store.setState({surface:'settings',status:'idle'}));
    await page.getByRole('heading', {name:'Overview',exact:true}).waitFor();
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
    await page.getByRole('button', {name:'Dictation',exact:true}).click();
    await page.getByRole('heading', {name:'Dictation',exact:true}).waitFor();
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
