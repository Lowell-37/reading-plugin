# Task 5 report — WXT ebook session migration

## Delivered scope

- Added real Microsoft Edge WXT acceptance in `tests/e2e/wxt-ebook-session.spec.ts`: EPUB, MOBI, and AZW3 each cover title/content, Vue TOC jump, previous/next navigation, paginated → scrolled → paginated, persisted progress, close/reopen restoration, and page-error collection. A fourth scenario verifies rapid sequential EPUB opens leave the newest session and its persisted progress active.
- Extended `tests/e2e/wxt-data-continuity.spec.ts` to assert rendered progress after root → WXT and WXT → root reopen. The WXT ebook session owns EPUB/MOBI/AZW3 UI; legacy PDF/search/annotation UI is intentionally not asserted inside that session. Annotation records remain unchanged through the data handoff and are verified again in the root UI.
- Preserved the existing DOM IDs and root/PDF legacy ownership. `ReaderWorkspace.vue` now projects Vue ebook status into the existing loading view and reader footer only when an ebook session is active. `TocSidebar.vue` projects the Vue-owned ebook title into the existing sidebar title node only while active.
- Found and fixed a real Edge defect: Foliate's paginator could perform deferred visible-range work after its chapter body had been released, producing `TypeError: Failed to execute 'createTreeWalker' on 'Document': parameter 1 is not of type 'Node'` on EPUB reopen. `scripts/patch-foliate.mjs` now skips that released-document work. The EPUB acceptance scenario reproduced the error before the patch and passed 8 consecutive repeats after it.
- Fixed the surfaced `tests/legacy-reader-port.test.ts` implicit callback type so the required full TypeScript check completes.

## Fresh verification — 2026-09-02

| Exact command | Result |
| --- | --- |
| `npm run check` | pass |
| `npm test` | pass: 38 files, 234 tests |
| `npm run build:wxt:verify` | pass: 223 WXT output files |
| `npm run test:e2e:wxt:baseline` | pass: 6 Edge tests |
| `npm run test:e2e:wxt:continuity` | pass: 2 Edge tests |
| `npx playwright test tests/e2e/wxt-ebook-session.spec.ts --reporter=line` | pass: 4 Edge tests |
| `npx playwright test tests/e2e/wxt-ebook-session.spec.ts --grep "real EPUB content" --repeat-each=8 --reporter=line` | pass: 8 repeated EPUB reopen tests |
| `npm run test:e2e` | pass: 25 root stable-entry Edge tests |
| `npm run release` | pass: 303-file ZIP, SHA-256 `bf865c248b2d782fd48dd234fabc72f53193e0fb93dd1cd10837df446c2ccaa2` |

The initial root E2E retry was discarded because concurrent Playwright trace cleanup raised an artifact-only `ENOENT` during `context.close`; the isolated rerun passed all 25 tests. The first full check also surfaced the test callback implicit-any noted above; the fresh rerun passed.

## Samples and boundary

- Real e-book samples: `tests/fixtures/books/alice.epub`, `alice.mobi`, `alice.azw3`, and `boundaries.epub` for the latest-session race.
- The persistent-profile continuity sample reopens `alice.epub` root → WXT → root and reads stored progress from each rendered reader.
- The root directory remains the stable entry. PDF, search, and annotation interaction remain legacy-owned and deliberately are not migrated by this task.

## Concerns

- WXT is still not the daily stable entry until the subsequent PDF and search/annotation session migrations reach equivalent real-Edge coverage.
- The full suite emits the existing Node `NO_COLOR`/`FORCE_COLOR` warning; no WXT ebook page errors occurred in the session acceptance scenarios.

## Error-state regression fix — 2026-09-07

- Root cause: when an active WXT ebook session emitted `status: 'error'`, the reader store correctly set `isReading` to `false`, but `ReaderWorkspace` hid both `#reader-view` and `#loading-view`. No Vue component projected `EbookSessionError`, so EPUB/MOBI/AZW3 failures became blank screens.
- `ReaderWorkspace.vue` now treats an active ebook error as a visible workspace state only for the WXT ebook session. It projects `data-state="error"`, a code-based safe title, the error detail, and the existing return/retry action group into the preserved loader DOM. It resets the same view for a later loading state; root and PDF loader ownership stay unchanged.
- Added a Vue-shell regression test which reproduces the `isReading: false` error snapshot and verifies the visible reader, loader state, title, detail, and recovery actions.

| Exact command | Result |
| --- | --- |
| `npx vitest run tests/vue-shell.test.ts --reporter=dot` (before fix) | expected RED: 1 failed / 19 tests; `#reader-view` was hidden |
| `npx vitest run tests/vue-shell.test.ts --reporter=dot` | pass: 19 tests |
| `npm run typecheck:vue` | pass |

## Error recovery action ownership fix — 2026-09-07

- Re-review found that the preserved loader actions still reached WXT's legacy `showLibrary()` listener. That path does not call `ebook.close()`, so an error could leave `record` and `status` active after the apparent return to the library.
- `ReaderWorkspace.vue` now owns the unchanged loader action IDs only while an active WXT ebook is in `error`: capture handlers stop the legacy duplicate listener, close the ebook store, close open panels, reload the library, and open the existing file picker after a retry. Outside that state, the handlers do not intercept the event, preserving legacy root/PDF behavior.
- The Vue-shell regression covers error → return, session/panel reset and library visibility, an actual ebook-store reopen through loading → ready, and error → retry. It additionally installs simulated legacy bubbling listeners and verifies they are not called in the active error state.

| Exact command | Result |
| --- | --- |
| `npx vitest run tests/vue-shell.test.ts --reporter=dot` (before fix) | expected RED: active ebook record remained after `#loading-library-button` click |
| `npx vitest run tests/vue-shell.test.ts --testNamePattern "uses Vue recovery controls" --reporter=verbose` | pass: 1 focused recovery test |
| `npx vitest run tests/vue-shell.test.ts --reporter=dot` | pass: 20 tests |
| `npm run typecheck:vue` | pass |

## Final review recovery and verification — 2026-09-08

- Recovered the interrupted final fix wave and preserved the scoped partial work in `ReaderWorkspace.vue`, `ebook-session-port.ts`, `foliate-ebook-session.ts`, `stores/settings.ts`, `settings-persistence.ts`, and focused tests. The unrelated `src/core-runtime/*.js` working-tree changes remain unstaged and untouched.
- Active WXT ebook sessions now receive all normalized reader settings through `settings.update*()` → `EbookSessionStore.applySettings()` → Foliate adapter. The old `ReaderWorkspace` flow-only watcher was removed, so flow changes and non-flow changes share one settings path rather than looping through a second watcher.
- Foliate/engine exceptions are mapped to safe `format` / `parse` / `restore` / `render` presentation copy. Raw exception text is retained only in the diagnostic field and is not rendered by the loading UI.
- Flow-change failures are contained by the settings boundary with `Promise.allSettled()`: the ebook store projects the adapter error into UI state and no unhandled rejection is emitted by the Vue setting action.
- The dedicated WXT ebook-session E2E no longer accepts `document.body.innerText` as content evidence. It first asserts a real Foliate content document exists, then asserts text from `foliate-view.getContents()` after a Vue TOC jump reaches a text chapter.
- Restored architecture guards for `book-repository`, `storage.js`, and `pdfjs-dist` in the WXT component/store boundary.

### RED / GREEN evidence

| Exact command | Result |
| --- | --- |
| `npx vitest run tests/settings-store.test.ts tests/vue-shell.test.ts --reporter=verbose` | pre-hardening pass: 37 tests, but stderr showed `indexedDB is not defined` from an unmocked `library.load()` after the Vue route test clicked `#home-button` |
| `npx vitest run tests/settings-store.test.ts tests/vue-shell.test.ts --reporter=verbose` | GREEN after test-boundary fix: 37 tests, no hidden repository stderr |
| `npx vitest run tests/foliate-ebook-session.test.ts tests/ebook-session-store.test.ts tests/architecture.test.js --reporter=verbose` | GREEN: 34 tests |
| `npx playwright test tests/e2e/wxt-ebook-session.spec.ts --reporter=line` | RED after replacing body-text content assertion: 2 failed / 4 tests; EPUB and AZW3 cover pages produced an empty Foliate text string, proving the old body-text assertion was too broad |
| `npx playwright test tests/e2e/wxt-ebook-session.spec.ts --reporter=line` | GREEN after asserting Foliate content-document presence at open and Foliate document text after TOC jump: 4 Edge tests |
| `npm run test:e2e:wxt:baseline` | RED: 5 passed / 1 failed; final flow/theme/progress scenario timed out because the TOC sidebar covered `#home-button` |
| `npm run test:e2e:wxt:baseline` | GREEN after closing `#scrim` before the home click: 6 Edge tests |

### Full final matrix

| Exact command | Result |
| --- | --- |
| `npm run check` | pass |
| `npm test` | pass: 38 files, 245 tests |
| `npm run build:wxt:verify` | pass: 223 WXT output files |
| `npm run test:e2e:wxt:baseline` | pass: 6 Edge tests |
| `npm run test:e2e:wxt:continuity` | pass: 2 Edge tests |
| `npx playwright test tests/e2e/wxt-ebook-session.spec.ts --reporter=line` | pass: 4 Edge tests |
| `npm run test:e2e` | pass: 25 root stable-entry Edge tests |
| `npm run release` | pass: 303-file ZIP, SHA-256 `420ca89623a33e2ae627b1aa0a5c8caa10eb7c52909c2c399d956742b70b1214` |

### Remaining boundary

- WXT is still not the daily stable entry until PDF, search, and annotation ownership move out of the legacy reader with equivalent real-Edge coverage.
- Playwright commands still emit the existing Node `NO_COLOR` / `FORCE_COLOR` warning; no WXT ebook page errors were reported by the acceptance scenarios.

## Flow-progress baseline correction — 2026-09-08

- Reproduced the final WXT flow/theme/progress baseline RED at head `9f626fd`: the test saved the first nonzero IndexedDB fraction (`0.0028698201821531436`) immediately after a continuous-mode TOC jump, then saw the correctly flushed/reopened location (`0.936242108192892`).
- Boundary diagnostics showed that the Foliate adapter received every relocate, passed the active book ID, CFI and fraction to `ProgressService.schedule()`, and each schedule succeeded. Continuous smooth scrolling emits relocate events continuously, so the existing 350 ms debounce correctly postpones its write until the scroll becomes idle; `EbookSessionPort.close()` then flushes the latest pending location.
- This was a test-oracle race, not lost position or an adapter/settings propagation defect. The baseline now captures the prior stored value, awaits the normal close/flush, verifies IndexedDB changed, and checks that reopening restores that actually persisted value. No WXT adapter, root, PDF, search or annotation production boundary changed.

| Exact command | Result |
| --- | --- |
| focused `wxt-baseline` flow/theme/progress Edge test | pass: 1 test |
| `npm run check` | pass |
| `npm test` | pass: 38 files, 245 tests |
| `npm run build:wxt:verify` | pass: 223 WXT output files |
| `npm run test:e2e:wxt:baseline` | pass: 6 Edge tests |
| `npm run test:e2e:wxt:continuity` | pass: 2 Edge tests |
| `npx playwright test tests/e2e/wxt-ebook-session.spec.ts` | pass: 4 Edge tests |
| `npm run test:e2e` | pass: 25 root stable-entry Edge tests |
| `npm run release` | pass: 303-file ZIP, SHA-256 `420ca89623a33e2ae627b1aa0a5c8caa10eb7c52909c2c399d956742b70b1214` |
