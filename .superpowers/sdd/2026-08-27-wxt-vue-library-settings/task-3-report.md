# Task 3 report — Pinia 接管书架、打开文件、删除和备份恢复

## Status

Complete. Task 3 was recovered from an interrupted, uncommitted TDD worktree and completed on `feat/wxt-vue-library-settings` from approved Task 2 head `f0cabe0`.

## Recovery inspection

Before changing files, the full tracked diff and all four untracked Task 3 files were read. The preserved tree contained the library store/dependency seam, Vue library UI and shell handlers, bridge/settings integration, WXT-only legacy listener gates, focused tests, and the new Edge E2E. No commit or earlier Task 3 report existed.

Three edits outside the brief's nominal file list were examined as scope-sensitive:

- `entrypoints/reader/legacy-bridge.ts` is required to attach the injected library store to the Task 1 port and refresh it through `onLibraryChanged`.
- `entrypoints/reader/stores/settings.ts` is required to merge validated non-sensitive restored settings while retaining the local API key and unknown fields.
- `scripts/patch-foliate.mjs` was added during recovery only after the required Edge E2E exposed a WXT port-open lifecycle race; it extends the repository's existing idempotent iframe lifecycle patch.

The recovery audit found no suspicious partial production rewrite. It did find incomplete TypeScript hygiene in `tests/library-store.test.ts`: the JavaScript backup module lacked the same compatibility suppression used by production, and two single-element array reads were not narrowed.

## Preserved TDD RED evidence

The ledger records the valid RED run made before the prior implementer was interrupted:

```text
Focused suite: 18 tests collected
10 new Task 3 behavior tests failed for the intended missing implementation
8 existing Vue shell tests passed
```

This evidence was retained under the recovery ruling because the tests demonstrably preceded the production implementation.

## Recovery baseline before new edits

Immediately after inspecting the complete preserved diff and untracked files:

```text
npm test -- tests/library-store.test.ts tests/vue-shell.test.ts
Test Files  2 passed (2)
Tests       19 passed (19)
Duration    22.44s
exit 0
```

The count increased from the ledger's 18 because the preserved tree also contained an asynchronous port-attachment regression test. The implementation, rather than relaxed assertions, accounted for GREEN.

The first broader diagnostic was intentionally run before recovery edits:

```text
npm run check
tests/library-store.test.ts(4,57): TS7016 missing declaration for library-backup.js
tests/library-store.test.ts(132,12): TS2532 possibly undefined
tests/library-store.test.ts(133,45): TS2532 possibly undefined
exit 1
```

After the minimal test typing fix, `npm run typecheck:vue` exited 0.

## Scope implemented

- Added an injected `LibraryDependencies`/`LibraryRepository` seam backed by the existing repository and backup modules.
- Added a Pinia library store whose `shallowRef<BookRecord[]>` is only a sorted repository projection.
- `load`, `openFile`, `openRecord`, `remove`, `backup`, and `restore` use one repository persistence entry per action as asserted by the memory repository.
- New files use shared format detection; saved records cross the Task 1 port with `{ newlySaved: true }`. The legacy parser deletes invalid new records and awaits `onLibraryChanged` for a repository reload.
- Backup flushes progress before its single repository read and delegates API-key exclusion to the versioned backup implementation.
- Restore fully parses and checksums the archive before `repository.restore`, merges non-sensitive settings, preserves local secrets/unknown settings, and reloads the projection. Invalid archives perform no restore, list, or settings write.
- Vue renders covers, metadata, format, size, and progress; cover Blob URLs are revoked on projection changes and unmount. Download Blob URLs retain their existing delayed revocation.
- Vue owns open buttons, the hidden input, drag/drop, home, delete, backup, and restore in WXT mode. Root-mode listeners/rendering remain active behind `vueOwnsMigratedControls`.
- Real Edge covers import, progress, annotation, return to library, reload/reopen, delete, backup, restore, second reopen, and persisted progress/annotation checks.
- The Edge RED run also found Foliate's background renderer calling `getComputedStyle` with an unloading iframe document element. The compatibility patch now verifies the element belongs to the current iframe window before styling; the E2E retains its zero-page-error assertion.

## Edge E2E diagnosis

The first two runs timed out because the new test attempted real pointer clicks through closed/open panels: first a TOC item in the closed sidebar, then Home through the active tools scrim. Trace evidence showed the exact Playwright actionability failures. The test now follows the real Vue user path by opening the sidebar and closing tools via the scrim; behavioral assertions were not weakened.

The third run completed all Task 3 behavior but failed `pageErrors === []` with:

```text
TypeError: Failed to execute 'getComputedStyle' on 'Window': parameter 1 is not of type 'Element'.
at Paginator.#replaceBackground
```

The idempotent Foliate patch added the missing background-render lifecycle guard. After rebuilding, the same test passed with no page errors.

## Final verification

All commands below were run fresh against the final candidate:

```text
git diff --check
exit 0 (only configured LF→CRLF checkout warnings)
```

```text
npm test -- tests/library-store.test.ts tests/vue-shell.test.ts
Test Files  2 passed (2)
Tests       19 passed (19)
exit 0
```

```text
npm test
Test Files  35 passed (35)
Tests       180 passed (180)
exit 0
```

```text
npm run check
changelog verification, core build, TypeScript, Vue TypeScript, and all JavaScript syntax checks passed
exit 0
```

```text
npm run test:e2e:wxt:baseline
6 passed (13.3s)
exit 0
```

```text
npm run test:e2e:wxt:continuity
2 passed (11.5s)
exit 0
```

```text
npx playwright test tests/e2e/wxt-vue-shell.spec.ts
1 passed (4.0s; scenario 3.5s)
exit 0
```

## Files changed

- `entrypoints/reader/library-dependencies.ts` (new)
- `entrypoints/reader/stores/library.ts` (new)
- `entrypoints/reader/stores/settings.ts`
- `entrypoints/reader/legacy-bridge.ts`
- `entrypoints/reader/main.ts`
- `entrypoints/reader/components/WelcomeLibrary.vue`
- `entrypoints/reader/components/TopBar.vue`
- `entrypoints/reader/components/OverlayControls.vue`
- `src/reader.js`
- `scripts/patch-foliate.mjs`
- `tests/library-store.test.ts` (new)
- `tests/vue-shell.test.ts`
- `tests/e2e/wxt-vue-shell.spec.ts` (new)
- `.superpowers/sdd/2026-08-27-wxt-vue-library-settings/task-3-report.md` (this report)

## Self-review and concerns

- Repository snapshots remain projections; IndexedDB schema v2 and `.quietreader` format version 1 are unchanged.
- Vue components do not directly import IndexedDB, Foliate.js, PDF.js, or `src/reader.js`.
- Engine, TOC, progress, and annotation ownership remains in the legacy controller; AI remains disabled.
- Root → WXT → root continuity, unknown settings, local API key, progress, annotations, and damaged-schema blocking all passed.
- The Foliate lifecycle change is deliberately limited to the existing dependency patch and is regenerated by normal setup/build workflows.
- Known non-blocking warning: WXT reports an existing minified chunk over 500 kB. No dependency was added and all builds passed.
- No unresolved Task 3 correctness concern was found.
