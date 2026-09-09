# Task 2 report: PDF.js session adapter

## Status

Completed.

## Files

- `entrypoints/reader/pdf-session-dependencies.ts` — PDF.js runtime/dependency boundary and browser resource interfaces.
- `entrypoints/reader/pdfjs-session.ts` — generation-aware PDF loading, rendering, navigation, progress, cancellation, and safe error mapping.
- `tests/pdfjs-session.test.ts` — lifecycle, projection, rendering, navigation, progress, restore, error, cancellation, and stale-callback coverage.
- `tests/architecture.test.js` — adapter dependency-boundary assertion.

## RED

Command:

```powershell
npm test -- tests/pdfjs-session.test.ts tests/architecture.test.js
```

The initial focused run had two failures:

- navigation expected its explicit flush to be the first flush, but observed two flushes;
- the overlapping-open test timed out because it waited for one microtask instead of the condition that the old `getDocument()` request had actually been created.

The lifecycle regression was then made explicit: the first `open()` must not flush progress, while replacing and closing an active session must flush. It failed against the existing adapter with one flush after the first open. The original navigation assertion independently failed for the same root cause.

## Root cause and fix

`open()` always called `releaseResources()`, and `releaseResources()` always flushed, even when no session resources or record existed. `takeResources()` now records whether a session was active, and `releaseResources()` flushes only when that flag is true.

The overlap failure was a test race, not an adapter behavior failure: queuing the replacement after `await tick()` did not establish that the old open had claimed its loading task. The test now waits for `loaderRequests.length === 1` before starting the replacement. Its fake rendering task is genuinely deferred and cancellable; the observer factory retains a disconnected callback so the test proves a stale render completion and stale observer entry cannot change the replacement session.

## GREEN

```powershell
npm test -- tests/pdfjs-session.test.ts tests/pdf-session-store.test.ts tests/architecture.test.js
npm run typecheck
npm run typecheck:vue
git diff --check
```

Results:

- Focused Vitest: 3 test files, 20 tests passed.
- Core TypeScript typecheck: exit code 0.
- Vue TypeScript typecheck: exit code 0.
- Diff whitespace check: exit code 0.

The Vue check initially identified PDF.js 6's undeclared ESM runtime entrypoint and incomplete test fake interface types. The adapter retains its own typed interface and explicitly documents the upstream declaration gap; the fake now structurally implements that interface.

## Scope and self-review

- The adapter owns loading tasks, documents, observers, frames, render tasks, cache, and text layers; no resources cross the store/Vue boundary.
- Snapshots and outline data are serializable; errors are mapped to safe user copy with diagnostics kept separate.
- First-open progress is not flushed; replacement and close flush active-session progress.
- Stale loader, render, and disconnected-observer work is generation/resource-identity guarded.
- No repository, search, annotation, Vue, legacy reader, routing, or AI files were changed.

## Concern

The workspace sandbox cannot write Vite's temporary config cache in this external worktree. Focused Vitest was rerun with the approved local-cache permission and passed; this is an environment restriction, not an adapter failure.

## Review fix round 1

### 1. In-flight zoom cancellation

**RED:** A deferred render task that rejects from `cancel()` during `setZoom()` emitted stale `render` errors (two page renders failed the new regression).

**Fix:** `renderPage()` now retains its render-task identity. Its success and catch paths require the current generation, render epoch, document, wrapper, and task-map identity before deleting a task, changing wrapper state, or reporting an error.

**GREEN:** The zoom regression confirms the first canceled task emits no error and cannot stop the replacement rendition; a subsequent zoom still cancels the replacement task, proving the stale catch did not delete it.

### 2. Restore failure lifecycle

**RED:** A stored-page `scrollTo()` failure called `onError({ code: 'restore' })` but `open()` continued and published `ready`.

**Fix:** `goToPage()` returns a completion boolean. `open()` requires successful restore before it publishes `ready`; ordinary navigation retains its safe `render`-error mapping.

**GREEN:** The stored-page failure regression has no ready snapshot and retains the loading snapshot for the store's restore error projection. The ordinary-navigation regression reports a render error without republishing ready.

### 3. AST dependency boundaries

**RED:** The first collector test failed against a deliberate empty collector: static imports, re-exports, dynamic imports, and `require()` specifiers were all missing.

**Fix:** Architecture tests now parse TypeScript AST module specifiers and extract Vue SFC script/script-setup blocks with `@vue/compiler-sfc`. They inspect every reader `.vue` file and store `.ts` file, plus both PDF adapter files. Prohibited boundaries are tested only against collected specifiers, not prose or regular-expression source scans.

**GREEN:** Collector tests cover static, re-exported, dynamic, CommonJS, and Vue-script specifiers. The full reader boundary checks pass.

### 4. Close and destroy cancellation

Added parameterized coverage for both `close()` and `destroy()`:

- a deferred loading task is canceled, then resolves late; its task and late document are destroyed with no callback or DOM mutation;
- a deferred render rejects from cancellation; its render task and document are destroyed with no stale snapshot, error, or DOM mutation.

`destroy()` remains intentionally fire-and-forget, and the tests condition-wait for document destruction before asserting outcomes, so asynchronous teardown is observably settled. Existing ownership/generation guards satisfied this coverage; no additional production change was required for this item.

### Verification

```powershell
npm test -- tests/pdfjs-session.test.ts tests/pdf-session-store.test.ts tests/architecture.test.js
npm run typecheck
npm run typecheck:vue
git diff --check
```

Results:

- Focused Vitest: 3 test files, 29 tests passed.
- Core TypeScript typecheck: exit code 0.
- Vue TypeScript typecheck: exit code 0.
