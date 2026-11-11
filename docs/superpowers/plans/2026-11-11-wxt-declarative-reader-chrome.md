# WXT Declarative Reader Chrome Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WXT reader chrome DOM projection and cross-component PDF toolbar listeners with direct Vue bindings backed by existing Pinia stores.

**Architecture:** `ReaderWorkspace.vue` derives loading, host visibility, footer, page and progress attributes as computed values rendered by its template. `OverlayControls.vue` owns PDF toolbar visibility, zoom text and click actions because it owns that markup. Engine host lookup, body classes and file-input boundaries remain explicit exceptions.

**Tech Stack:** WXT, Vue 3, TypeScript, Pinia, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-11-wxt-declarative-reader-chrome-design.md`

## Global Constraints

- Preserve every existing DOM ID and accessible name used by the stable test contract.
- Do not change the root extension entry, IndexedDB schema v2, backup format, AI disabled state or visual design.
- Keep Foliate/PDF.js imports outside Vue components and keep engine host lookup in `main.ts`.
- Keep the current PDF session API; zoom bounds stay in the adapter.

## Review Focus

- EPUB→PDF and PDF→EPUB replacement must never leave both hosts visible; covered by the existing cross-format component and Edge session tests.
- Error recovery must preserve assertive error semantics and return/retry actions; covered by the existing ebook/PDF error component tests.
- Closing the last session must remove stale progress `aria-valuetext`; covered by the existing footer cleanup test.
- PDF total-page live status must not emit duplicate mutations for unrelated page/zoom changes; covered by the existing MutationObserver component test.
- Vue toolbar handlers must continue suppressing legacy/native duplicate listeners; covered by the existing PDF control routing component test.

---

### Task 1: Lock the declarative ownership boundary

**Files:**
- Modify: `tests/vue-shell.test.ts`
- Test: `tests/vue-shell.test.ts`

**Interfaces:**
- Consumes: the real mounted `App.vue` with `ReaderWorkspace.vue` and `OverlayControls.vue`.
- Produces: a behavior gate that forbids runtime ID lookup for workspace-owned projection nodes while exercising their real Store→DOM output.

- [x] Add a test named `reader chrome is projected without querying its owned DOM nodes` that makes `document.getElementById` throw for loading, host, footer and PDF projection IDs, mounts the real app, drives PDF Store values, and asserts the rendered page/progress/zoom output.
- [x] Run that focused test and confirm failure on the current imperative projection.

### Task 2: Render workspace state declaratively

**Files:**
- Modify: `entrypoints/reader/components/ReaderWorkspace.vue`
- Modify: `entrypoints/reader/components/WelcomeLibrary.vue`
- Test: `tests/vue-shell.test.ts`

**Interfaces:**
- Consumes: `ReaderStore`, `EbookSessionStore`, `PdfSessionStore` refs already used by the components.
- Produces: computed template values for workspace/loading visibility, safe error copy, host visibility, chapter, progress, page input/total and ARIA text.

- [x] Run the focused Vue shell tests for ebook routing, PDF routing, loading/error state, total-page mutation and footer cleanup to establish the behavior baseline.
- [x] Replace `syncLoadingView`, `syncSessionHosts`, `syncEbookFooter` and `syncPdfControls` with computed values and direct template attributes/text.
- [x] Move welcome-view visibility to a direct Vue binding while preserving error-session hiding.
- [x] Run `npx vitest run tests/vue-shell.test.ts`; expect all tests to pass.

### Task 3: Give the PDF toolbar to its component

**Files:**
- Modify: `entrypoints/reader/components/OverlayControls.vue`
- Modify: `entrypoints/reader/components/ReaderWorkspace.vue`
- Modify: `CHANGELOG.md`
- Modify: `docs/MIGRATION.md`
- Modify: `docs/ROADMAP.md`
- Test: `tests/vue-shell.test.ts`

**Interfaces:**
- Consumes: `usePdfSessionStore()` with `record`, `zoom`, and `setZoom(zoom: number)`.
- Produces: Vue click handlers `changePdfZoom(delta: number)` and `fitPdfWidth()` scoped to the toolbar owner.

- [x] Add/retain assertions that inactive toolbar controls are hidden, active zoom text is reactive, three controls call `setZoom` exactly once, and external click listeners are suppressed.
- [x] Remove `pdfToolbarListeners` and toolbar registration/cleanup from `ReaderWorkspace.vue`; bind toolbar visibility/text/actions in `OverlayControls.vue` with capture handlers that stop immediate propagation.
- [x] Update changelog, migration notes, roadmap progress and the Vitest count after the final suite.
- [x] Run `npm run check`, `npm test`, `npm run build:wxt:verify`, and the WXT ebook/PDF session Playwright specs; expect all gates green.
- [x] Request one independent whole-diff review and resolve all Critical/Important findings.

Delivery: commit this completed slice, push `main`, and verify the remote SHA against the local commit.
