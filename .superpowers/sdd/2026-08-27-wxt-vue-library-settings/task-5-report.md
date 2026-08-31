# Task 5 report — Phase C acceptance, documentation and integration preparation

## Investigation before remediation

### Acceptance failure

Fresh `npm run test:e2e` on 2026-08-31 executed 25 root Microsoft Edge scenarios. Twenty-four passed; `EPUB highlight survives typography, flow changes, stale CFI and reopen` failed after its intentional stale-CFI mutation. The reopened chapter was visible, but no annotation overlay group appeared within the test's 15-second condition wait.

The focused scenario passed once in isolation, then failed twice in ten identical sequential repetitions (eight passed). The two failures have the same final state: `{ groupCount: 0, selectedHit: false, wrongHit: false }`. Failure traces and screenshots are preserved under `test-results/annotation-anchor-stabilit-*`; the failing screenshot shows the expected chapter rendered without a highlight.

### Boundary trace and root cause

The failure predates Task 5: the production files at the Task 4 head `d2d64f9` are unchanged. The relevant implementation is in the root legacy reader, not the WXT/Vue bridge.

`node_modules/foliate-js/paginator.js` dispatches its document `load` event before it dispatches `create-overlayer`; `node_modules/foliate-js/view.js` attaches the overlay and then emits the public `create-overlay` event. `src/reader.js` currently starts `repairEbookAnnotationAnchors(doc, index)` from `load` without retaining or sequencing its promise. The subsequent `create-overlay` handler immediately re-adds the stale persisted locator. Therefore the repair's `ebookView.addAnnotation()` can run before an overlayer is attached (and draw nothing), while the competing stale add can run after attachment. This makes the final overlay dependent on microtask/event ordering; it explains both the no-group failures and the intermittent passes.

The single hypothesis is: **the root reader must wait for the section's stale-CFI repair to settle before it performs the `create-overlay` rehydration, so its only post-overlay add uses the repaired locator.** This preserves the existing resolver, storage schema, backup format, engine ownership, and disabled AI route.

### TDD status

The first attempted regression used an unresolvable CFI through the real Edge reopen flow. It passed on the pre-fix tree, so it did not deterministically isolate the load/overlay scheduling defect and was removed rather than retained as false assurance. The replacement test targets a small production coordinator that models the actual public event boundary: it must defer section rehydration until the load-started repair promise settles. This is the behavior whose absence permits the race; it will be written before that coordinator exists.

## Remediation

`src/ebook-annotation-rehydration.js` is the small event coordinator. Its `onLoad()` records the section repair promise, and its `onOverlay()` waits for that promise (including a handled repair failure) before it hydrates the current annotations. `src/reader.js` now gives the coordinator the existing `repairEbookAnnotationAnchors` function and the existing filtered `ebookView.addAnnotation` calls. No persistence, schema, backup, public port, engine selection, or AI behavior changed.

### TDD evidence

The deterministic test was written first in `tests/ebook-annotation-rehydration.test.js`. It starts a real unresolved repair promise, fires the overlay boundary, proves hydration has not happened, resolves the repair, then proves hydration occurs exactly after it settles.

```text
npm test -- tests/ebook-annotation-rehydration.test.js
RED: exit 1; cannot find module ../src/ebook-annotation-rehydration.js
```

The failure was the intended missing production boundary. After the minimal coordinator and reader wiring:

```text
npm test -- tests/ebook-annotation-rehydration.test.js
GREEN: 1 file, 1 test passed; exit 0
node --check src/ebook-annotation-rehydration.js
node --check src/reader.js
exit 0
```

The original real Edge regression was then repeated without retries or sleeps in its test logic:

```text
npx playwright test tests/e2e/annotation-anchor-stability.spec.ts --grep "EPUB highlight" --repeat-each=10
10 passed; exit 0
```

## Fresh acceptance matrix

All results below were run after the production fix; documentation-only edits followed the product verification.

| Command | Result | Evidence |
| --- | --- | --- |
| `npm test` | pass | 36 files, 185 tests |
| `npm run check` | pass | changelog, core build, TypeScript, Vue TypeScript and JavaScript syntax |
| `npm run build:wxt:verify` | pass | WXT identity/runtime-assets contract verified 223 files |
| `npm run test:e2e:wxt:baseline` | pass | 6 real Edge tests: identity; EPUB/MOBI/AZW3; PDF; EPUB settings/progress restoration |
| `npm run test:e2e:wxt:continuity` | pass | 2 real Edge tests: root→WXT→root continuity and damaged-schema read-only block |
| `npx playwright test tests/e2e/wxt-vue-shell.spec.ts` | pass | 1 real Edge Vue library import/reopen/delete/backup/restore/progress/annotation scenario |
| `npm run test:e2e` | pass | 25 real root Edge tests, including release ZIP identity, upgrade and rollback |
| `npm run release` | pass | `quiet-reader-0.2.0.zip`: 303 files; SHA-256 `a4beb7bdb1879d026cf697ed18e10ce112d801a0fcb25261fdde7014ead9dc9e` |
| focused ownership suite | pass | `architecture`, `reader-ui`, `wxt`, `legacy-reader-port`, Vue shell/library/settings: 7 files, 44 tests |
| `git diff --check` | pass | no whitespace errors (only configured Windows LF→CRLF warnings) |

The release verifier confirmed version `0.2.0`, extension name `静读 · 本地电子书阅读器`, the matching ZIP Manifest version/name, and a present fixed Manifest key. The root suite's release scenarios explicitly verified stable extension identity plus both upgrade and rollback state preservation.

## Independent boundary review

- WXT Vue/Pinia continues to own library projection, file/drop/delete/backup/restore, settings, panels, header and runtime UI. It remains a projection over BookRepository; IndexedDB schema v2 and the versioned backup format remain unchanged.
- The structured bridge contains none of `MutationObserver`, `querySelector`, or `syncFromDom`; the focused 44-test ownership suite covers the live listener registries and dependency boundaries.
- `AI_FEATURE_ENABLED` remains `false`, and both root/WXT AI sections remain `hidden`; no AI route was enabled.
- The repair coordinator touches only root EPUB annotation rehydration ordering. It does not alter Blob object-URL lifecycle, data-write ownership, or the legacy port contract.
- The WXT build still emits the pre-existing minified chunk-size warning (>500 kB); the build and all contracts pass.

## Documentation changes

- `CHANGELOG.md` now lists the verified Phase C Vue/Pinia ownership and the root EPUB rehydration fix.
- `docs/MIGRATION.md` records Phase C acceptance, explicit WXT/Pinia versus legacy-engine ownership, all current command counts, release artifact evidence, AI pause, and the next migration phases.
- `docs/ROADMAP.md` advances architecture progress to 78%, records the 185/25/6/2/1 verification matrix, keeps WXT non-stable until engine migration reaches parity, and lists the remaining work.

## Deferred-minor assessment

1. **File-picker keyboard activation — non-blocking.** The Vue labels expose button semantics but do not provide explicit Enter/Space activation. Pointer/native-picker behavior and the full acceptance matrix pass; the gap is limited to accessibility ergonomics and has no data or listener-ownership consequence. Route it to the next accessibility pass before declaring interaction parity complete.
2. **`functionSource()` brace-counting parser — non-blocking.** It can be confused by braces in strings, comments, regexes, or templates. It backs test inspection only; the same production listener registry/binder is behaviorally executed by the 44-test ownership suite. Replace it with AST parsing in the next architecture-test hardening pass.
3. **Static prohibited-import guard coverage — non-blocking.** It currently targets static `from` imports and does not exhaust dynamic/side-effect/alternative loading. Runtime ownership tests and current source boundaries pass; strengthen the guard for future migration work, but it does not invalidate the demonstrated Phase C behavior.

None of these deferred items is merge-blocking for this branch. The prior root EPUB rehydration failure was blocking; the deterministic gate plus repeated and full Edge evidence address it.

## Concerns

- WXT remains a migration build rather than the stable user entry: EPUB/PDF sessions, search and annotations are still powered by the legacy engine behind the structured port.
- This task does not push, merge into `main`, or alter the branch's integration state. The controller owns final review and integration.
