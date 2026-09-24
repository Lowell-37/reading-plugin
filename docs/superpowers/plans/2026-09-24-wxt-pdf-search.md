# WXT PDF Search Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move WXT PDF search ownership from the legacy JavaScript controller to Vue 3 and Pinia without exposing PDF.js resources or changing the root extension.

**Architecture:** A DOM-only TypeScript search service scans rendered PDF text layers and owns search marks. A Pinia store owns query lifecycle and generation safety, while `ToolsPanel.vue` conditionally intercepts PDF searches and leaves ebook searches on the legacy path.

**Tech Stack:** WXT, Vue 3, TypeScript, Pinia, PDF.js rendered text layers, Vitest, Playwright with Microsoft Edge.

**Spec:** `docs/superpowers/specs/2026-09-24-wxt-pdf-search-design.md`

## Global Constraints

- Migrate PDF search only; PDF annotations and all ebook search remain on the legacy controller.
- Do not expose PDF.js documents, pages, render tasks, caches, or text-content objects.
- Do not change schema v2, BookRepository records, progress, annotations, or backup formats.
- AI remains disabled and WXT remains a migration build, not the stable loading entry.
- Search only rendered text layers, displays at most 300 results, and reports unavailable pages.
- Every production change follows RED-GREEN TDD and every task ends in its own commit.

## Review Focus

- A text layer disappearing during an async scan must count as unavailable or abort safely, never reject unhandled.
- A cancelled old query must not overwrite a newer query even when its promise resolves late.
- Zoom, close, replacement PDF, and cross-format opens must remove stale marks and results.
- PDF Vue interception must not suppress EPUB/MOBI/AZW3 legacy search submissions.
- Search marks must never remove or mutate `.pdf-annotation-layer` content.

---

### Task 1: DOM-only PDF search service

**Files:**
- Create: `entrypoints/reader/pdf-search.ts`
- Test: `tests/pdf-search.test.ts`

**Interfaces:**
- Consumes: `createSearchContext(source, start, length)` and `findSearchMatches(source, query)` from `src/core/search-context.ts`.
- Produces: `searchRenderedPdf(options: PdfSearchOptions): Promise<PdfSearchOutcome>` and `clearPdfSearchMarks(root: ParentNode): void`.

- [ ] **Step 1: Write the failing service tests**

Create jsdom tests that build three `.pdf-page` nodes: two rendered text layers and one unavailable page. Assert the exact public result shape:

```ts
const outcome = await searchRenderedPdf({
  query: 'searchable', pageCount: 3,
  readTextLayer: page => pages.get(page) ?? null,
  signal: new AbortController().signal,
})
expect(outcome.total).toBe(2)
expect(outcome.results.map(item => item.page)).toEqual([1, 2])
expect(outcome.unavailablePages).toBe(1)
expect(document.querySelectorAll('.pdf-search-match')).toHaveLength(2)
```

Add tests for sentence context, case-insensitive matches spanning adjacent spans, total counts above the 300-result display limit, empty queries, cancellation during `yieldControl`, a removed layer, and cleanup preserving `.pdf-annotation-layer`.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/pdf-search.test.ts`
Expected: FAIL because `entrypoints/reader/pdf-search.ts` does not exist.

- [ ] **Step 3: Implement the minimal service**

Define these exact types and functions:

```ts
export interface PdfSearchResult { page: number; start: number; end: number; context: string }
export interface PdfSearchOutcome { query: string; total: number; results: PdfSearchResult[]; unavailablePages: number }
export interface PdfSearchOptions {
  query: string; pageCount: number; readTextLayer(page: number): HTMLElement | null;
  signal: AbortSignal; maxResults?: number; yieldControl?: () => Promise<void>
}
export async function searchRenderedPdf(options: PdfSearchOptions): Promise<PdfSearchOutcome>
export function clearPdfSearchMarks(root: ParentNode): void
```

Flatten span text with stable source offsets, use existing search-context helpers, mark every span overlapping a match with `.pdf-search-match`, check `signal.throwIfAborted()` before and after each yielded page, and default `maxResults` to 300.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run: `npm test -- tests/pdf-search.test.ts tests/search-context.test.js`
Expected: PASS with zero failures.

- [ ] **Step 5: Commit Task 1**

```bash
git add entrypoints/reader/pdf-search.ts tests/pdf-search.test.ts
git commit -m "feat: add rendered PDF search service"
```

### Task 2: Pinia search lifecycle and typed session surface

**Files:**
- Modify: `entrypoints/reader/pdf-session-port.ts`
- Modify: `entrypoints/reader/pdfjs-session.ts`
- Modify: `entrypoints/reader/stores/pdf-session.ts`
- Create: `entrypoints/reader/stores/pdf-search.ts`
- Modify: `tests/pdfjs-session.test.ts`
- Modify: `tests/pdf-session-store.test.ts`
- Create: `tests/pdf-search-store.test.ts`

**Interfaces:**
- Consumes: Task 1 `searchRenderedPdf` and `clearPdfSearchMarks`.
- Produces: `PdfSessionPort.readRenderedTextLayer(page): HTMLElement | null`, `PdfSessionStore.readRenderedTextLayer(page)`, and Pinia actions `run(query)`, `goToResult(result)`, `synchronizeSession(snapshot)`, `clear()`.

- [ ] **Step 1: Write failing port and store tests**

Extend fake PDF ports with:

```ts
readRenderedTextLayer(page) { return renderedLayers.get(page) ?? null }
```

Assert the PDF adapter returns only a rendered `.textLayer`; the PDF session store proxies that read; the search store publishes `searching` then `ready`; `run('')` resets to idle; a second run aborts the first; stale generation results are ignored; `goToResult({ page: 4, ... })` calls `pdf.goTo(4)`; and `synchronizeSession` clears on generation, non-ready status, or zoom change.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npm test -- tests/pdfjs-session.test.ts tests/pdf-session-store.test.ts tests/pdf-search-store.test.ts`
Expected: FAIL because the port method and PDF search store are missing.

- [ ] **Step 3: Add the typed surface and lifecycle store**

Add this port member and proxy without returning engine objects:

```ts
readRenderedTextLayer(page: number): HTMLElement | null
```

Implement `createPdfSearchStore()` with refs for `query`, `status`, `results`, `total`, `unavailablePages`, and `error`; retain one AbortController and one monotonically increasing request id. Capture PDF generation for every run and accept completion only when request id, generation, record id, and ready status still match.

`synchronizeSession` receives `{ generation, status, zoom, recordId }`; any identity/status/zoom change aborts and clears. `clear()` removes only search marks under the PDF pages root supplied through a small `attachRoot(root)` action.

- [ ] **Step 4: Run focused tests and type checks**

Run: `npm test -- tests/pdf-search.test.ts tests/pdfjs-session.test.ts tests/pdf-session-store.test.ts tests/pdf-search-store.test.ts`
Expected: PASS with zero failures.

Run: `npm run typecheck:vue`
Expected: exit code 0.

- [ ] **Step 5: Commit Task 2**

```bash
git add entrypoints/reader/pdf-session-port.ts entrypoints/reader/pdfjs-session.ts entrypoints/reader/stores/pdf-session.ts entrypoints/reader/stores/pdf-search.ts tests/pdfjs-session.test.ts tests/pdf-session-store.test.ts tests/pdf-search-store.test.ts
git commit -m "feat: own PDF search lifecycle in Pinia"
```

### Task 3: Vue ownership and legacy boundary removal

**Files:**
- Modify: `entrypoints/reader/components/ToolsPanel.vue`
- Modify: `entrypoints/reader/legacy-reader-port.ts`
- Modify: `entrypoints/reader/main.ts`
- Modify: `src/reader.js`
- Modify: `src/reader-listener-registry.js`
- Modify: `tests/vue-shell.test.ts`
- Modify: `tests/legacy-reader-port.test.ts`
- Modify: `tests/reader-ui.test.js`
- Modify: `tests/architecture.test.js`
- Modify: `tests/vue-architecture.test.ts`
- Modify: `tests/e2e/wxt-pdf-session.spec.ts`

**Interfaces:**
- Consumes: Task 2 PDF search store and rendered-layer session method.
- Produces: Vue-rendered PDF status/results and a legacy `LegacyPdfAnnotationTools` boundary used only by annotations.

- [ ] **Step 1: Write failing ownership tests**

Mount `App` with Pinia, activate a ready PDF session, submit `#search-form`, and assert the Vue search store renders `.search-result`, status text, and result navigation. Spy on the native event to verify PDF submission calls `preventDefault()` and `stopImmediatePropagation()`.

Activate an ebook session and assert the component does not intercept the event, leaving the legacy listener path intact. Update the legacy integration test so PDF search is absent from the legacy port test while PDF selection, overlay rendering, persistence, and annotation jump still pass.

Add architecture assertions that the legacy WXT annotation tool interface is named `LegacyPdfAnnotationTools`, exposes exactly `pageCount`, `readTextLayer`, and `goTo`, and that `src/reader.js` does not execute `searchPdf` for WXT PDF mode.

Add a WXT Edge scenario that opens `tracemonkey.pdf`, waits for pages 1 and 2 text layers, searches `TraceMonkey supports`, asserts sentence context and page label, clicks the result, and verifies the PDF page. Then search `Dynamic languages` immediately followed by `TraceMonkey supports`, verify only the second result remains, zoom to 130%, verify stale marks/results clear, search again, close and reopen, and assert no page errors or stale marks.

- [ ] **Step 2: Run the ownership tests and verify RED**

Run: `npm test -- tests/vue-shell.test.ts tests/legacy-reader-port.test.ts tests/reader-ui.test.js tests/architecture.test.js tests/vue-architecture.test.ts`
Expected: FAIL because Vue does not yet own PDF search.

Run: `npm run build && npx playwright test tests/e2e/wxt-pdf-session.spec.ts --grep "Vue PDF search"`
Expected: FAIL because the Vue PDF search path is not implemented.

- [ ] **Step 3: Implement conditional Vue ownership**

In `ToolsPanel.vue`, bind the form with an event handler that intercepts only when the PDF session is active. Render PDF results with keyed buttons and call `goToResult`. Watch `{ generation, status, zoom, recordId }` and forward it to `synchronizeSession`; attach the `#pdf-pages` root after mount.

Keep legacy DOM ids so ebook search and annotation code remain compatible. Rename `LegacyPdfTools` to `LegacyPdfAnnotationTools`; remove WXT PDF search calls and marker refresh from `attachPdfTools`, while preserving page-count, text-layer and navigation access needed for annotation recovery and overlays. Root-mode `searchPdf`, `markPdfSearchMatches`, and root listener behavior remain unchanged.

- [ ] **Step 4: Run ownership tests and checks**

Run: `npm test -- tests/vue-shell.test.ts tests/legacy-reader-port.test.ts tests/reader-ui.test.js tests/architecture.test.js tests/vue-architecture.test.ts tests/pdf-search-store.test.ts`
Expected: PASS with zero failures.

Run: `npm run check`
Expected: exit code 0.

Run: `npm run build && npx playwright test tests/e2e/wxt-pdf-session.spec.ts --grep "Vue PDF search"`
Expected: PASS with no page errors.

- [ ] **Step 5: Commit Task 3**

```bash
git add entrypoints/reader/components/ToolsPanel.vue entrypoints/reader/legacy-reader-port.ts entrypoints/reader/main.ts src/reader.js src/reader-listener-registry.js tests/vue-shell.test.ts tests/legacy-reader-port.test.ts tests/reader-ui.test.js tests/architecture.test.js tests/vue-architecture.test.ts tests/e2e/wxt-pdf-session.spec.ts
git commit -m "refactor: move WXT PDF search into Vue"
```

### Task 4: Full acceptance and project evidence

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/MIGRATION.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: completed Vue PDF search flow from Tasks 1-3.
- Produces: verified real Edge regression coverage and updated migration evidence.

- [ ] **Step 1: Run the real Edge acceptance scenario**

Run: `npm run build && npx playwright test tests/e2e/wxt-pdf-session.spec.ts --grep "Vue PDF search"`
Expected: PASS with no page errors.

- [ ] **Step 2: Make only acceptance fixes, then update evidence**

Apply only fixes required by the failing scenario using a new failing unit/component test first. Update ROADMAP, MIGRATION, and CHANGELOG to state that PDF search is Vue/Pinia-owned, PDF annotations remain legacy-owned, AI remains paused, and root remains the stable entry.

- [ ] **Step 3: Run the complete verification matrix**

Run: `npm run check`
Expected: exit code 0.

Run: `npm test`
Expected: all Vitest files pass with zero failures.

Run: `npm run build:wxt:verify`
Expected: verified WXT MV3 build.

Run: `npm run test:e2e:wxt:baseline`
Expected: all WXT baseline tests pass.

Run: `npm run test:e2e:wxt:continuity`
Expected: all data-continuity tests pass.

Run: `npm run build && npx playwright test tests/e2e/wxt-pdf-session.spec.ts tests/e2e/wxt-ebook-session.spec.ts`
Expected: all PDF and ebook WXT session tests pass.

Run: `npm run test:e2e`
Expected: all root stable-entry tests pass.

Run: `npm run release`
Expected: release archive and checksum verification pass.

- [ ] **Step 4: Commit Task 4**

```bash
git add docs/ROADMAP.md docs/MIGRATION.md CHANGELOG.md
git commit -m "test: verify WXT PDF search migration"
```
