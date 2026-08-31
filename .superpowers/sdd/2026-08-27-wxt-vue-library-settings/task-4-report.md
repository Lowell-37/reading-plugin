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
- `entrypoints/reader/legacy-reader-port.ts`
- `tests/reader-ui.test.js`
- `tests/architecture.test.js`
- `tests/wxt.test.js`
- `.superpowers/sdd/2026-08-27-wxt-vue-library-settings/task-4-report.md`

`entrypoints/reader/legacy-bridge.ts` required no production edit because it already used only structured callbacks and port attachment; its architecture gate was strengthened.

## Self-review and concerns

- `git diff babff8a` contains only the scoped listener split, port-boundary documentation, ownership tests, and this report.
- Static ownership tests are appropriate here: they enforce the dependency/listener boundary, while existing Vue/store tests and the real Edge suites verify behavior.
- The port callback/method contract, IndexedDB `quiet-reader` schema v2, backup format, root loading path, engine ownership, persisted source of truth, and disabled AI route are unchanged.
- Vue components have no direct imports of `src/reader.js`, persistence modules, Foliate.js, PDF.js, or IndexedDB.
- The deferred keyboard-label accessibility Minor was not implemented.
- No unresolved Task 4 correctness concern was found. The build retains the existing minified-chunk size warning; no dependency or bundle-splitting change was made.
