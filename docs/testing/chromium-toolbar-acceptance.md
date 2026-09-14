# Actual Chromium toolbar activation

`scripts/test-browser-toolbar-app.sh` creates a disposable Xvfb, user profile, session bus and PulseAudio fixture namespace. It copies the selected packaged GUI and native host, loads the shipped extension unchanged, and drives its real browser UI. It uses the same binary/model/dependency variables as `test-browser-full-app.sh`. Evidence goes to `VOCO_BROWSER_EVIDENCE_DIR`.

Set `VOCO_BROWSER_TOOLBAR_PROBE_ONLY=1` for activation without recording. The probe clicks the visible Chromium Extensions button and the observed VOCO action through private XTest input. Accessibility names, roles, bounds and pre-action screenshots identify the clicked controls. Duplicate accessibility paths to the same name/role/bounds are treated as one physical control; different controls remain ambiguous and fail. The action must establish native-host readiness and the ON badge. Recording-state traces are forbidden in this mode.

With probe mode unset, the harness additionally requests synthetic capture using the actual Alt+Shift+V chord after focusing the local plain field. It verifies exact delivery, refusal to mutate either field after focus loss, actual Discard recovery, and a fresh recording. Each reloaded tab is enabled by a new real toolbar action. A failing action or missing visible control is not replaced by calling an extension listener.

The manifest retains only `activeTab`, `scripting` and `nativeMessaging`; no host permission is added. The harness cannot query a tab URL before activation, so it obtains the active tab's ID without accessing its URL. Read-only extension inspection observes the resulting badge/readiness; it never invokes `enableTab`, action listeners or a permission-grant API. The earlier `test-browser-full-app.mjs` localhost grant remains explicitly separate evidence and is not claimed as toolbar qualification.

The action-only baseline probe passed with the existing packaged GUI and real native host. Earlier failed harness attempts are retained: one assumed URL access before `activeTab`; another counted duplicated accessibility paths as separate physical buttons. The final short capture journey also passed on 5 September 2026, as recorded below. No physical microphone, host profile, arbitrary website or general Chromium packaging support is established by this private local-fixture test.

## Final packaged short journey

The run at `foundations-evidence/iteration-5/platform/chromium-toolbar/final-short` exited 0. All three cases passed: delivery of the four normalized words `GO DO YOU HEAR`, focus-loss rejection without inserting into either field, and a fresh successful recording after the actual **Discard recovery** accessibility action. Each case used a new real Chromium toolbar activation. The retained screenshots show Chromium's “Access requested” menu before the VOCO action and the resulting `Go! Do you hear?` in the intended field afterward.

| Artifact | SHA-256 |
| --- | --- |
| Packaged GUI | `0783700482cdfee9808efbce80c4c8ce8ccdba4608be200411a14ed7c0b2e631` |
| Packaged native host | `e225cd4f8c9c49e99dde4fa7ebdb0826fd1bc956543f13bc5d6136b9e6cdfbab` |
| Unchanged base.en model | `a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002` |
| Shipped extension manifest | `98e78f11cf5c6ae36e57b000cb3d2ca80d86e9e068936357284391aab5d68d3c` |

`result.json` records all cases, artifact identities and `harnessOnlyHostGrant: null`. Three `toolbar-activation-*.json` files record the actual UI click, ON badge and absence of a broad permission grant. `execution.json` records exit status and hashes every retained runner dependency, screenshot and trace. Earlier probe failures remain separate; existing evidence directories are refused before a new launch.

This establishes the activeTab toolbar permission path for the shipped unpacked extension in disposable X11 Chromium, local plain fields and public synthetic audio. It does not qualify extension-store installation, arbitrary sites, rich editors, confined Chromium packages, physical microphone input, Wayland browser UI or general speech reliability. The separately scoped long runs below extend this package evidence. The separate speech integrity failures remain unresolved.

Validation of the harness change: Bash and Node syntax, Python AST parsing, and `bash scripts/check-devops.sh` passed. The new shell and Python helper paths are included in that DevOps check.

## Final packaged long journeys

The prospective `iteration-5/platform/chromium-toolbar/long-plan/plan.json` froze runner hashes, complete references and thresholds before inference. The same final packaged GUI and unchanged extension then ran two sequential journeys; both exited 0. Evidence is retained separately in `final-long-repeated` and `final-long-natural` under that toolbar evidence directory.

| Public playback | Complete reference | Canonical and final errors (S / D / I) | Accuracy result |
| --- | --- | --- | --- |
| First fixture repeated 16 times, 37.44 seconds | 64 words | 0 / 0 / 0 | WER 0; exact sequence and count of 16 repetitions pass |
| First complete fixtures in manifest order, 39.755 seconds | 88 words | 4 / 1 / 0 | WER 5/88 = 0.056818; original maximum 0.25 passes |

Both journeys establish a real canonical checkpoint, preserve its committed prefix when focus moves to the second field, leave that second field empty, activate the actual **Discard recovery** control and complete a fresh short recording. The natural committed prefix contains 401 characters. Each reload uses real toolbar activation without added host permissions. `long-accuracy.json` retains the complete reference, actual outputs, separate edit counts and gate results; canonical and final outputs are scored separately. Natural speech is not word-exact. This passing 16-repeat fixture does not resolve the separately failing 18-repeat continuity diagnostic or the broader canonical speech failures.

The long-run shell refuses nonzero `PYTHONOPTIMIZE` before creating temporary or evidence directories. Both direct Python action helpers refuse disabled assertions, including `python -O`. Three negative subprocess checks, syntax validation and the full DevOps check passed before the frozen runs. The earlier short-run evidence retains its original runner hashes and was executed with assertions enabled.
