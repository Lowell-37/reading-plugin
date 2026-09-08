# WXT PDF Session Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let WXT Vue/Pinia own PDF open, rendering, outline, navigation, zoom, progress, restore and errors while preserving root behavior and legacy PDF search/annotation ownership.

**Architecture:** A typed `PdfSessionPort` and Pinia projection isolate Vue from PDF.js. A `PdfJsSessionAdapter` owns document/render resources and ProgressService; the library routes PDF records to it, while a narrowed legacy port retains only search and annotation behavior in WXT.

**Tech Stack:** WXT, Vue 3, TypeScript, Pinia, PDF.js, IndexedDB, Vitest, Playwright with Microsoft Edge.

**Spec:** `docs/superpowers/specs/2026-09-08-wxt-pdf-session-design.md`

## Global Constraints

- Keep the root directory entry as the stable reader and preserve every root PDF listener and DOM ID.
- Keep IndexedDB schema v2 and PDF progress `{ kind: 'pdf', page, fraction }` unchanged; only BookRepository and ProgressService persist data.
- PDF search, selection, highlight, annotation editing/import/export and AI remain legacy-owned in WXT.
- PDF.js may be imported only by the PDF adapter/dependency seam, never by Pinia stores or Vue components.
- Session snapshots contain serializable projection data only; PDF.js documents, pages, canvases, observers and abort objects stay inside the adapter.
- Raw engine exceptions never enter user-visible copy; async commands must not create unhandled rejections.
- EPUB/MOBI/AZW3 ownership and all Phase D Edge gates remain unchanged.

---

### Task 1: Define the PDF session port and Pinia projection

**Files:**
- Create: `entrypoints/reader/pdf-session-port.ts`
- Create: `entrypoints/reader/stores/pdf-session.ts`
- Modify: `entrypoints/reader/stores/reader.ts`
- Create: `tests/pdf-session-store.test.ts`
- Modify: `tests/vue-shell.test.ts`

**Interfaces:**
- Produces `PdfSessionPortFactory = (callbacks: PdfSessionCallbacks) => PdfSessionPort`.
- Produces commands `open(record, settings)`, `close()`, `goTo(page)`, `navigate(direction)`, `setZoom(zoom)`, `flushProgress()`, `destroy()`.
- Produces `PdfSessionSnapshot` with `status`, `title`, `outline`, `page`, `pageCount`, `zoom`, `progress`, `error`, and `generation`.

- [ ] **Step 1: Write failing generation and projection tests**

  Add tests that attach fake port factories, open two records, deliver stale callbacks from the first generation and assert only the latest record/snapshot projects into `PdfSessionStore` and `ReaderStore`. Assert outline and navigation targets are cloned serializable values, and `close` resets state after awaiting the port.

- [ ] **Step 2: Verify RED**

  Run `npm test -- tests/pdf-session-store.test.ts tests/vue-shell.test.ts`; require failure because the port/store do not exist.

- [ ] **Step 3: Implement the typed boundary**

  Define `PdfSessionStatus = 'idle' | 'loading' | 'ready' | 'error'`, safe error codes `password | parse | render | restore | cancelled`, and an outline item `{ label: string; page: number; children?: PdfOutlineItem[] }`. Implement epoch plus generation checks matching the ebook store, but keep PDF state separate.

- [ ] **Step 4: Verify GREEN**

  Run `npm test -- tests/pdf-session-store.test.ts tests/vue-shell.test.ts` and `npm run typecheck:vue`.

- [ ] **Step 5: Commit**

  Commit the five scoped files with message `feat: add PDF session port and store`.

---

### Task 2: Implement the PDF.js session adapter

**Files:**
- Create: `entrypoints/reader/pdf-session-dependencies.ts`
- Create: `entrypoints/reader/pdfjs-session.ts`
- Create: `tests/pdfjs-session.test.ts`
- Modify: `tests/architecture.test.js`

**Interfaces:**
- Consumes Task 1 `PdfSessionPort`, callbacks and snapshots.
- Produces `createPdfJsSession(dependencies): PdfSessionPort`.
- Injects PDF.js loader, worker/base URLs, host elements, observer/frame scheduling, ProgressService and generation source through `PdfSessionDependencies`.

- [ ] **Step 1: Write failing adapter lifecycle tests**

  Cover successful metadata/outline/page-count projection; lazy page plus text-layer rendering; zoom rerender; page/relative navigation; `{ kind: 'pdf', page, fraction }` schedule/flush; stored-page restore; password/parse/render/restore error mapping; close/destroy cancellation; and overlapping opens where stale load/render/observer callbacks cannot mutate the new session.

- [ ] **Step 2: Verify RED**

  Run `npm test -- tests/pdfjs-session.test.ts tests/architecture.test.js`; require module-not-found or missing behavior failures.

- [ ] **Step 3: Implement adapter-owned resources**

  Keep loading task, document, observer, animation frame, render tasks, page cache and text-layer state private. On each open increment generation, cancel/destroy previous resources, create page wrappers, observe them, render the visible page and neighbors, restore stored page, then emit `ready`. Clamp zoom to `0.6..2.5` in `0.1` steps and rebuild rendered pages/text layers after zoom.

- [ ] **Step 4: Enforce dependency boundaries**

  Extend architecture tests so Vue/stores cannot import PDF.js and the adapter cannot import BookRepository, search, annotation or Vue modules.

- [ ] **Step 5: Verify GREEN and commit**

  Run `npm test -- tests/pdfjs-session.test.ts tests/pdf-session-store.test.ts tests/architecture.test.js`, `npm run typecheck`, and `npm run typecheck:vue`. Commit with `feat: add PDF.js session adapter`.

---

### Task 3: Route PDF records and bind Vue controls

**Files:**
- Modify: `entrypoints/reader/stores/library.ts`
- Modify: `entrypoints/reader/legacy-bridge.ts`
- Modify: `entrypoints/reader/main.ts`
- Modify: `entrypoints/reader/components/ReaderWorkspace.vue`
- Modify: `entrypoints/reader/components/TocSidebar.vue`
- Modify: `entrypoints/reader/components/TopBar.vue`
- Modify: `tests/library-store.test.ts`
- Modify: `tests/vue-shell.test.ts`

**Interfaces:**
- Consumes Task 1/2 PDF factory and store.
- `LibraryStore` attaches three ports and routes PDF only to the PDF port, ebook formats only to ebook, and unsupported formats to neither.
- Vue calls only store actions; bridge attachment remains callback/port-only with no DOM query or observer.

- [ ] **Step 1: Write failing routing and component tests**

  Assert PDF opens the PDF port exactly once and never legacy/ebook; format switches close the active port before opening the next. Assert outline recursion, page input, previous/next, slider, zoom controls, close and safe error recovery invoke PDF store actions and derive classes/text from snapshots.

- [ ] **Step 2: Verify RED**

  Run `npm test -- tests/library-store.test.ts tests/vue-shell.test.ts`; require failures for missing PDF routing/control ownership.

- [ ] **Step 3: Bind the WXT UI**

  Construct the adapter in `main.ts`, attach it through the bridge/library, reuse existing DOM IDs and suppress legacy duplicate click/keyboard/input handlers only while a PDF session is active. Keep legacy search/annotation panels and nodes visible and unchanged.

- [ ] **Step 4: Verify GREEN and commit**

  Run `npm test -- tests/library-store.test.ts tests/vue-shell.test.ts tests/pdf-session-store.test.ts`; run both type checks. Commit with `feat: route WXT PDF sessions through Pinia`.

---

### Task 4: Remove WXT legacy PDF engine ownership without removing tools

**Files:**
- Modify: `src/reader.js`
- Modify: `src/reader-listener-registry.js`
- Modify: `entrypoints/reader/legacy-reader-port.ts`
- Modify: `tests/legacy-reader-port.test.ts`
- Modify: `tests/reader-ui.test.js`
- Modify: `tests/architecture.test.js`

**Interfaces:**
- Consumes Task 3 route ownership.
- Root mode retains `openPdf`, render/navigation/zoom/progress listeners.
- WXT legacy port retains search/selection/annotation commands but cannot create/destroy/navigate a PDF.js document.

- [ ] **Step 1: Write failing ownership tests**

  In root mode assert all existing PDF engine listeners remain. In WXT, open through the library/PDF store and assert the legacy controller never calls PDF.js load/render/navigation/zoom/progress; then exercise PDF search and annotation paths against the session-rendered text layer and require them to remain functional.

- [ ] **Step 2: Verify RED**

  Run `npm test -- tests/legacy-reader-port.test.ts tests/reader-ui.test.js tests/architecture.test.js`; require failure because WXT legacy mode still owns PDF engine state.

- [ ] **Step 3: Add the minimal mode boundary**

  Separate root-only PDF engine bindings from WXT shared search/annotation bindings. Provide only the narrow read/navigation hooks required by legacy search and annotation; do not duplicate PDF documents or caches and do not move search/annotation implementation in this task.

- [ ] **Step 4: Verify GREEN and root regression**

  Run the focused tests plus `npm run test:e2e`; require all 25 root Edge scenarios to pass.

- [ ] **Step 5: Commit**

  Commit with `refactor: isolate WXT PDF session ownership`.

---

### Task 5: Real Edge PDF acceptance, continuity and documentation

**Files:**
- Create: `tests/e2e/wxt-pdf-session.spec.ts`
- Modify: `tests/e2e/wxt-data-continuity.spec.ts`
- Modify: `tests/e2e/wxt-baseline.spec.ts`
- Modify: `CHANGELOG.md`
- Modify: `docs/MIGRATION.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes completed Task 1–4 behavior and produces no product API.

- [ ] **Step 1: Write real Edge acceptance first**

  Using the existing real `tracemonkey.pdf` fixture, assert actual text-layer content, outline/page jump, previous/next, progress slider, 60%/100%/130%/250% zoom bounds as applicable, close/reopen persisted page, safe malformed/password error, and zero page errors. Rapidly open two PDF records and assert only the second title/pages/progress survive.

- [ ] **Step 2: Extend bidirectional continuity**

  Persist a noninitial PDF page in root, read/render it in WXT, update it in WXT, then read/render the new page after root rollback using the same Edge profile. Confirm schema v2, Blob hash, ebook progress and annotations remain unchanged.

- [ ] **Step 3: Run final verification matrix**

  Run `npm run check`, `npm test`, `npm run build:wxt:verify`, `npm run test:e2e:wxt:baseline`, `npm run test:e2e:wxt:continuity`, `npx playwright test tests/e2e/wxt-pdf-session.spec.ts`, `npx playwright test tests/e2e/wxt-ebook-session.spec.ts`, `npm run test:e2e`, and `npm run release`. Every command must pass at final head.

- [ ] **Step 4: Update verified documentation**

  Record only fresh final-head counts, Edge results and release SHA. State explicitly that PDF search/annotation remain legacy-owned and WXT is not stable until those domains migrate.

- [ ] **Step 5: Commit**

  Commit scoped tests/docs with `test: verify WXT PDF session migration`.

## Plan Self-Review

- Spec coverage: Tasks 1–4 cover the typed boundary, adapter, routing/UI and legacy ownership split; Task 5 covers real Edge, bidirectional continuity and release evidence.
- Scope: Search, annotation, AI, OCR, root retirement and store work remain excluded.
- Type consistency: Task 1 defines every Task 2–4 port, snapshot and outline name; Task 2 supplies the factory; Task 3 routes it; Task 4 removes duplicate ownership.
- Test integrity: Every implementation task starts with an expected failing test and ends with a focused commit; final documentation follows final-head verification only.
