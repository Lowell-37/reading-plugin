# Task 4 report — migrated listener removal and ownership gate

## Status

Complete on `feat/wxt-vue-library-settings` from approved base `babff8a`.

`src/reader.js` now has two explicit listener groups:

- `bindEngineControls()` retains loading recovery, search, annotations, AI-disabled controls, reader navigation, PDF controls, progress, and reading keyboard navigation.
- `bindRootUiControls()` owns the root-only library/open/file/drop, backup/restore, panel, header, settings, scrim, and Escape listeners.

`createLegacyReaderPort()` initializes with `{ rootUi: false }`, while the stable root bootstrap initializes with `{ rootUi: true }`. The public port methods and callbacks are unchanged. `legacy-reader-port.ts` documents that the port is an engine-only boundary in WXT mode.

## TDD evidence

### Baseline

Command:

```text
npm install
npm test
```

Result: exit 0; existing linked worktree confirmed on `feat/wxt-vue-library-settings`; 35 test files and 181 tests passed before Task 4 edits.

### RED

The architecture/UI tests were written before production changes. They enumerate every WXT-prohibited migrated binding, require each root migrated action to have exactly one listener, keep book open/delete listener ownership explicit, strengthen the structured bridge boundary, and reject direct Vue-component imports of the legacy controller, persistence, Foliate.js, PDF.js, or `indexedDB`.

Command:

```text
npm test -- tests/reader-ui.test.js tests/architecture.test.js tests/wxt.test.js
```

Result: exit 1; 2 expected failures and 9 passes. The failures were:

- `bindRootUiControls must exist`
- `bindEngineControls must exist`

This proves the new tests failed on the missing ownership split. The bridge/import boundary test already passed because the Task 1 bridge was structured and DOM-free.

The first implementation run exposed a test-helper error when the helper treated the `{}` default argument in `createLegacyReaderPort(callbacks = {})` as the function body. Only the helper was corrected, then the same suite was rerun.

### GREEN

Commands and results:

```text
npm test -- tests/reader-ui.test.js tests/architecture.test.js tests/wxt.test.js
```

Exit 0; 3 files, 11 tests passed.

```text
npm test -- tests/legacy-reader-port.test.ts tests/vue-shell.test.ts tests/settings-store.test.ts tests/library-store.test.ts tests/reader-ui.test.js tests/architecture.test.js tests/wxt.test.js
node --check src/reader.js
```

Exit 0; 7 files, 44 tests passed; reader syntax check passed.

## Full verification

```text
npm test
```

Exit 0; 35 files, 184 tests passed.

```text
npm run check
```

Exit 0; changelog verification, core/runtime builds, TypeScript, Vue TypeScript, and JavaScript syntax checks passed.

```text
npm run test:e2e:wxt:baseline
```

Exit 0; 6 real Edge tests passed: extension identity, EPUB, MOBI, AZW3, PDF, and EPUB settings/progress restoration.

```text
npm run test:e2e:wxt:continuity
```

Exit 0; 2 real Edge tests passed: root → WXT → root continuity and damaged-schema startup blocking.

```text
npx playwright test tests/e2e/wxt-vue-shell.spec.ts
```

Exit 0; 1 real Edge test passed: Vue library import, reopen, delete, backup, restore, progress, and annotations.

```text
npm run test:e2e
```

Exit 0; all 25 stable root-extension Edge tests passed, including root settings/panels, file/library actions, backup/restore, annotations, search, all reading formats, migration, upgrade, and rollback.

## Files changed

- `src/reader.js`
- `src/reader-listener-registry.js`
- `entrypoints/reader/legacy-reader-port.ts`
- `tests/reader-ui.test.js`
- `tests/architecture.test.js`
- `tests/wxt.test.js`
- `.superpowers/sdd/2026-08-27-wxt-vue-library-settings/task-4-report.md`

`entrypoints/reader/legacy-bridge.ts` required no production edit because it already used only structured callbacks and port attachment; its architecture gate was strengthened.

## Self-review and concerns

- `git diff babff8a` contains only the scoped listener split, port-boundary documentation, ownership tests, and this report.
- The listener ownership tests execute the same deterministic registries, binder, and mode-startup runner consumed by `src/reader.js`; static checks remain only for dependency boundaries.
- The port callback/method contract, IndexedDB `quiet-reader` schema v2, backup format, root loading path, engine ownership, persisted source of truth, and disabled AI route are unchanged.
- Vue components have no direct imports of `src/reader.js`, persistence modules, Foliate.js, PDF.js, or IndexedDB.
- The deferred keyboard-label accessibility Minor was not implemented.
- No unresolved Task 4 correctness concern was found. The build retains the existing minified-chunk size warning; no dependency or bundle-splitting change was made.

## Review fix — exhaustive production listener registries

The first Task 4 review found two Important gaps: the WXT inventory omitted most engine listeners and root/library ownership details, and the source-slice counting tests could not prove the actual registration/startup path. Both were fixed without changing the public port, schema, backup, AI, or engine ownership contracts.

`src/reader-listener-registry.js` is now the production source of truth for 28 engine listeners, 25 root UI listeners, 3 root library-card listeners, and the exact startup paths (`wxt → engine`; `root → engine, rootUi, rootLibrary`). `reader.js` consumes the exported binder and startup runner. Root dragenter, dragover, dragleave, drop, and Escape each have one registry entry; the previous two root `drop` listeners were consolidated into one handler that preserves both effects.

### Review fix RED 1 — deterministic inventory and startup path missing

```text
npm test -- tests/reader-ui.test.js tests/wxt.test.js
```

Exit 1; 2 expected failures and 7 passes. Both failures reported: `reader listener ownership must be represented by an importable production registry`.

### Review fix GREEN 1 — complete registries consumed by reader startup

```text
node --check src/reader-listener-registry.js
node --check src/reader.js
npm test -- tests/reader-ui.test.js tests/wxt.test.js tests/legacy-reader-port.test.ts tests/vue-shell.test.ts
```

Exit 0; both syntax checks passed; 4 files and 24 tests passed.

### Review fix RED 2 — registry metadata did not yet own actual registration

```text
npm test -- tests/reader-ui.test.js tests/wxt.test.js
```

Exit 1; 1 expected failure and 8 passes. The root ownership test expected an exported production binder but received `undefined`.

### Review fix GREEN 2 — one-to-one binder execution

```text
node --check src/reader-listener-registry.js
node --check src/reader.js
npm test -- tests/reader-ui.test.js tests/wxt.test.js tests/architecture.test.js tests/legacy-reader-port.test.ts tests/vue-shell.test.ts tests/settings-store.test.ts tests/library-store.test.ts
```

Exit 0; both syntax checks passed; 7 files and 44 tests passed. The test executes the production binder against recording targets and confirms one registration per exhaustive engine/root/library entry.

### Review fix full verification

```text
npm test
npm run check
```

Exit 0; 35 files and 184 tests passed; changelog, core/runtime build, TypeScript, Vue TypeScript, and JavaScript syntax checks passed.

```text
npm run test:e2e:wxt:baseline
npm run test:e2e:wxt:continuity
npx playwright test tests/e2e/wxt-vue-shell.spec.ts
npm run test:e2e
```

All commands exited 0: WXT baseline 6/6, continuity 2/2, Vue library 1/1, and stable root extension 25/25 passed in real Edge. The existing WXT minified-chunk warning remains the only non-blocking build note.

## Recovery verification — 2026-08-31

After the previous fix-round agent was interrupted by an external usage quota, the preserved uncommitted registry changes were inspected rather than replaced. `reader.js` imports and invokes the registry's production binder for engine, root UI, and per-card library listeners; its startup runner selects `wxt → engine` and `root → engine, rootUi, rootLibrary`. The public legacy-port callback and method contract remains unchanged.

Fresh recovery evidence:

```text
npm test -- tests/reader-ui.test.js tests/wxt.test.js
```

Exit 0; 2 files and 9 ownership tests passed.

```text
npm test
npm run check
```

Exit 0; all 35 test files / 184 tests passed, and changelog verification, runtime build, TypeScript, Vue TypeScript, and JavaScript syntax checks passed.

```text
npm run test:e2e:wxt:baseline
npm run test:e2e:wxt:continuity
npm run test:e2e
```

Exit 0; real Edge suites passed: WXT baseline 6/6, WXT continuity 2/2, and stable root extension 25/25. The pre-existing WXT minified-chunk-size warning remains non-blocking.
