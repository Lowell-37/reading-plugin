# WXT PDF Annotation Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move WXT PDF annotation ownership from the legacy controller to Vue 3 and Pinia without changing stored data or the root extension.

**Architecture:** Keep PDF.js engine resources encapsulated by the existing session adapter. A DOM-only annotation projection service and a Pinia store own PDF annotation state, persistence and stale-session safety; Vue owns selection actions and the PDF annotation list, while the legacy controller retains ebook annotations and root-mode behavior.

**Tech Stack:** WXT, Vue 3, TypeScript, Pinia, PDF.js rendered text layers, existing annotation/anchor modules, IndexedDB, Vitest, Playwright with Microsoft Edge.

**Spec:** `docs/superpowers/specs/2026-09-30-wxt-pdf-annotations-design.md`

## Global Constraints

- Migrate WXT PDF annotations only; ebook annotations and all root-mode behavior remain legacy-owned.
- Do not expose PDF.js documents, pages, text-content objects, render tasks or caches.
- Do not change schema v2, BookRepository records, progress, annotation import/export formats or backups.
- AI remains disabled and the project root remains the stable loading entry.
- Unresolved PDF anchors are retained but never painted.
- Every production change follows RED-GREEN TDD and every task ends in its own commit.

## Review Focus

- A text layer disappearing while anchoring or rendering must defer safely without an unhandled rejection.
- A close, replacement PDF, zoom, or cross-format open must remove stale overlays and reject stale persistence/results.
- The projection layer must never write into `.textLayer` search marks or mutate PDF.js canvas content.
- Existing annotation descendants and imported unresolved anchors must not receive an overlay.
- Vue interception must not suppress ebook/root annotation controls or change their persisted data.

---

### Task 1: DOM-only PDF annotation projection service

**Files:**
- Create: `entrypoints/reader/pdf-annotations.ts`
- Test: `tests/pdf-annotations.test.ts`

**Interfaces:**
- Consumes: `Annotation`, PDF text-anchor helpers and rendered `.pdf-page`/`.textLayer` DOM.
- Produces: `createPdfAnnotationFromRange(options)`, `renderPdfAnnotationOverlays(options)`, and `clearPdfAnnotationOverlays(root)`.

- [ ] **Step 1: Write failing DOM service tests**

Create jsdom pages with text layers and annotation layers. Assert a same-page user `Range` creates a PDF annotation with page, quote, offsets and anchor; resolved annotations draw rectangles only in `.pdf-annotation-layer`; unresolved annotations draw none; rerender clears only prior annotation overlay rectangles; detached text layers are skipped.

- [ ] **Step 2: Run the new test to verify RED**

Run: `npx vitest run tests/pdf-annotations.test.ts`

Expected: FAIL because `entrypoints/reader/pdf-annotations.ts` does not exist.

- [ ] **Step 3: Implement DOM-only projection**

Implement exact public interfaces with `HTMLElement`/`Range` inputs only. Derive normalized quote and stable text offsets from the rendered text-layer span sequence; use `Range.getClientRects()` relative to the page wrapper, recreate overlay rectangles for every render, and never mutate text spans, search classes or canvas elements.

- [ ] **Step 4: Run focused service tests**

Run: `npx vitest run tests/pdf-annotations.test.ts tests/text-anchor.test.ts tests/anchor-recovery.test.ts`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit Task 1**

```bash
git add entrypoints/reader/pdf-annotations.ts tests/pdf-annotations.test.ts
git commit -m "feat: add rendered PDF annotation projection"
```

### Task 2: Typed PDF render lifecycle and Pinia annotation store

**Files:**
- Modify: `entrypoints/reader/pdf-session-port.ts`
- Modify: `entrypoints/reader/pdfjs-session.ts`
- Modify: `entrypoints/reader/stores/pdf-session.ts`
- Create: `entrypoints/reader/stores/pdf-annotations.ts`
- Modify: `tests/pdfjs-session.test.ts`
- Modify: `tests/pdf-session-store.test.ts`
- Create: `tests/pdf-annotations-store.test.ts`

**Interfaces:**
- Consumes: Task 1 DOM-only projection functions and the existing `BookRepository` annotation field.
- Produces: a rendered-page notification surface and `PdfAnnotationStore` actions `createFromSelection`, `update`, `remove`, `removeSelected`, `synchronizeSession`, `renderPage`, `recoverImported` and `clear`.

- [ ] **Step 1: Write failing port and store tests**

Extend PDF port fakes with a callback that reports a rendered page number and generation. Assert that the session store proxies it without engine objects; the annotation store reads and writes only the record annotation array; it rejects stale generation/record completions; it clears on zoom/close/replacement; it filters/sorts/selects annotations; and a persistence failure leaves the in-memory annotation and reports a safe retryable error.

- [ ] **Step 2: Run the new tests to verify RED**

Run: `npx vitest run tests/pdfjs-session.test.ts tests/pdf-session-store.test.ts tests/pdf-annotations-store.test.ts`

Expected: FAIL because render lifecycle callbacks and the annotation store are missing.

- [ ] **Step 3: Implement port lifecycle and store**

Add a typed rendered-page callback to the PDF session surface. Implement `createPdfAnnotationStore()` with record id, generation, zoom, annotation/filter/sort/selection state, monotonically increasing write/render ids and an AbortController for recovery. Persist through the existing repository API and project overlays only after current identity checks.

- [ ] **Step 4: Run focused tests and Vue typecheck**

Run: `npx vitest run tests/pdf-annotations.test.ts tests/pdfjs-session.test.ts tests/pdf-session-store.test.ts tests/pdf-annotations-store.test.ts`

Expected: PASS with zero failures.

Run: `npm run typecheck:vue`

Expected: exit code 0.

- [ ] **Step 5: Commit Task 2**

```bash
git add entrypoints/reader/pdf-session-port.ts entrypoints/reader/pdfjs-session.ts entrypoints/reader/stores/pdf-session.ts entrypoints/reader/stores/pdf-annotations.ts tests/pdfjs-session.test.ts tests/pdf-session-store.test.ts tests/pdf-annotations-store.test.ts
git commit -m "feat: own PDF annotations in Pinia"
```

### Task 3: Vue selection, overlay and annotation-tools ownership

**Files:**
- Modify: `entrypoints/reader/components/ReaderWorkspace.vue`
- Modify: `entrypoints/reader/components/ToolsPanel.vue`
- Modify: `entrypoints/reader/main.ts`
- Modify: `tests/vue-shell.test.ts`
- Create: `tests/pdf-annotation-components.test.ts`

**Interfaces:**
- Consumes: Task 2 `PdfAnnotationStore` and `PdfSessionStore` rendered DOM surface.
- Produces: PDF-only selection actions, Vue annotation list/filter/edit/delete/jump ownership, and overlay lifecycle watchers.

- [ ] **Step 1: Write failing component tests**

Mount the Vue app with a ready PDF store and a real rendered-text selection. Assert highlight/note actions call the PDF annotation store, a note request passes the entered text, list controls render PDF annotations and route edit/delete/selection/jump actions to the store, and a PDF session intercepts events without preventing ebook annotation control events.

- [ ] **Step 2: Run the component tests to verify RED**

Run: `npx vitest run tests/vue-shell.test.ts tests/pdf-annotation-components.test.ts`

Expected: FAIL because Vue does not own PDF annotation actions or list rendering.

- [ ] **Step 3: Implement conditional Vue ownership**

Attach selection handling only to an active ready PDF session; retain legacy ids for ebook compatibility. Render the PDF annotation list through keyed Vue controls, wire filter/sort/bulk actions, and watch generation/status/zoom/record id plus rendered-page events to synchronize the store and redraw overlays.

- [ ] **Step 4: Run focused component tests**

Run: `npx vitest run tests/vue-shell.test.ts tests/pdf-annotation-components.test.ts tests/pdf-annotations-store.test.ts`

Expected: PASS with zero failures.

- [ ] **Step 5: Commit Task 3**

```bash
git add entrypoints/reader/components/ReaderWorkspace.vue entrypoints/reader/components/ToolsPanel.vue entrypoints/reader/main.ts tests/vue-shell.test.ts tests/pdf-annotation-components.test.ts
git commit -m "feat: render PDF annotations from Vue"
```

### Task 4: Remove WXT legacy PDF annotation ownership

**Files:**
- Modify: `entrypoints/reader/legacy-reader-port.ts`
- Modify: `entrypoints/reader/main.ts`
- Modify: `src/reader.js`
- Modify: `tests/legacy-reader-port.test.ts`
- Modify: `tests/architecture.test.js`
- Modify: `tests/vue-architecture.test.ts`
- Modify: `tests/e2e/wxt-pdf-session.spec.ts`

**Interfaces:**
- Consumes: Vue/Pinia PDF annotation state from Tasks 1-3.
- Produces: no WXT `LegacyPdfAnnotationTools` ownership; root reader and ebook annotation compatibility remain intact.

- [ ] **Step 1: Write failing boundary and Edge tests**

Update architecture tests to assert the WXT legacy port has no PDF annotation attachment method and `reader.js` does not execute WXT PDF annotation creation/list/overlay code. Extend the real PDF Edge scenario to create a highlight and note, assert an overlay, edit/filter/jump/delete, zoom and reopen, then rapid replacement PDF isolation and no page errors. Keep root-mode PDF annotation coverage unchanged.

- [ ] **Step 2: Run tests to verify RED**

Run: `npx vitest run tests/legacy-reader-port.test.ts tests/architecture.test.js tests/vue-architecture.test.ts`

Expected: FAIL because WXT still attaches legacy PDF annotation tools.

Run: `npm run e2e:wxt:prepare && npx playwright test tests/e2e/wxt-pdf-session.spec.ts --grep "Vue PDF annotations"`

Expected: FAIL because WXT annotation ownership is not fully migrated.

- [ ] **Step 3: Remove only WXT annotation bridge behavior**

Delete the WXT legacy PDF annotation attachment/update/render path while preserving root-mode functions and ebook handlers. Ensure closing or replacement invokes Vue store cleanup before legacy DOM teardown.

- [ ] **Step 4: Run boundary, Edge and complete checks**

Run: `npx vitest run tests/legacy-reader-port.test.ts tests/architecture.test.js tests/vue-architecture.test.ts tests/pdf-annotation-components.test.ts`

Expected: PASS with zero failures.

Run: `npm run check && npm test`

Expected: exit code 0 and all tests pass.

Run: `npm run build && npx playwright test tests/e2e/wxt-pdf-session.spec.ts --grep "Vue PDF annotations"`

Expected: PASS with no page errors.

- [ ] **Step 5: Commit Task 4**

```bash
git add entrypoints/reader/legacy-reader-port.ts entrypoints/reader/main.ts src/reader.js tests/legacy-reader-port.test.ts tests/architecture.test.js tests/vue-architecture.test.ts tests/e2e/wxt-pdf-session.spec.ts
git commit -m "refactor: remove WXT legacy PDF annotation bridge"
```

### Task 5: Full acceptance and migration evidence

**Files:**
- Modify: `docs/ROADMAP.md`
- Modify: `docs/MIGRATION.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: completed WXT PDF annotation flow from Tasks 1-4.
- Produces: verified Edge evidence that PDF search and annotations are Vue/Pinia-owned while root remains stable.

- [ ] **Step 1: Run the real Edge acceptance scenario**

Run: `npm run build && npx playwright test tests/e2e/wxt-pdf-session.spec.ts --grep "Vue PDF annotations"`

Expected: PASS with no page errors.

- [ ] **Step 2: Make only acceptance fixes, then update evidence**

Apply only failures from Step 1 with a new failing unit/component test first. Update documents to state that WXT PDF search and annotations are Vue/Pinia-owned, ebook annotations remain legacy-owned, AI remains paused, and the project root remains stable.

- [ ] **Step 3: Run the complete verification matrix**

Run: `npm run check`

Run: `npm test`

Run: `npm run build:wxt:verify`

Run: `npm run test:e2e:wxt:baseline`

Run: `npm run test:e2e:wxt:continuity`

Run: `npm run build && npx playwright test tests/e2e/wxt-pdf-session.spec.ts tests/e2e/wxt-ebook-session.spec.ts`

Run: `npm run test:e2e`

Run: `npm run release`

Expected: every command passes; release archive and checksum verification pass.

- [ ] **Step 4: Commit Task 5**

```bash
git add docs/ROADMAP.md docs/MIGRATION.md CHANGELOG.md
git commit -m "test: verify WXT PDF annotation migration"
```
