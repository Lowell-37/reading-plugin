# WXT Ebook Annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move WXT EPUB/MOBI/AZW3 annotation creation, rendering, editing, import/export, and persistence to Vue/Pinia and the Foliate session.

**Architecture:** Foliate owns DOM selections and overlays; a separate Pinia store owns annotation state and repository writes. The tools panel routes actions by active format. Root reader behavior stays unchanged.

**Tech Stack:** WXT, Vue 3, TypeScript, Pinia, Foliate.js, IndexedDB, Vitest, Playwright/Microsoft Edge.

**Spec:** `docs/superpowers/specs/2026-10-12-wxt-ebook-annotations-design.md`

## Global Constraints

- Preserve `BookRecord.annotations` and existing extension identity.
- Do not modify root extension behavior or enable AI.
- Verify real EPUB, MOBI, AZW3 and PDF in Edge; commit and push only after tests pass.

## Review Focus

- A selection in an iframe must still be captured after clicking the toolbar button.
- Switching books during a pending save must not apply stale annotations to the new book.
- Scrolled and paginated modes must both draw only the active book's highlights.
- Importing another book's archive requires explicit confirmation.
- Failed saves must remain retryable without silently discarding the draft.

### Task 1: Foliate annotation adapter

**Files:** `entrypoints/reader/ebook-session-port.ts`, `ebook-session-dependencies.ts`, `foliate-ebook-session.ts`, `stores/ebook-session.ts`, `tests/foliate-ebook-session.test.ts`.

**Interfaces:** Add `consumeSelection(): EbookSelectionInput | null` and `setAnnotations(annotations: Annotation[]): Promise<void>` to `EbookSessionPort`; report anchor repairs through a generation-scoped callback. Reuse `src/core/annotations.ts` and `src/text-range.js` for the unchanged record format.

- [x] Write failing tests for iframe selection→CFI/quote and paginated/scrolled overlay updates, including close/reopen.
- [x] Run targeted Vitest and observe expected failures.
- [x] Implement the port and Foliate event hookups.
- [x] Run targeted Vitest until green, then run the full suite.
- [x] Integrate the adapter in the phase commit after Edge verification.

### Task 2: Pinia annotation state and persistence

**Files:** Create `entrypoints/reader/stores/ebook-annotations.ts`; modify `entrypoints/reader/main.ts`; add `tests/ebook-annotations-store.test.ts`.

**Interfaces:** `synchronizeSession({ record, generation })`, `createFromSelection(note)`, `update`, `remove`, `removeSelected`, `importAnnotations`, `retrySave`, and read-only `visible`/`allAnnotations` projections.

- [x] Write failing tests for existing annotation load, creation, edit/delete, stale-save isolation, retry, and import merge.
- [x] Run targeted Vitest and observe expected failures.
- [x] Implement generation-guarded serialized repository writes and draft retention.
- [x] Run targeted and full Vitest until green.
- [x] Integrate the store in the phase commit after Edge verification.

### Task 3: Vue controls and real Edge acceptance

**Files:** `entrypoints/reader/components/ToolsPanel.vue`, `src/reader-listener-registry.js`, `tests/vue-shell.test.ts`, `tests/reader-ui.test.js`, `tests/e2e/wxt-ebook-annotations.spec.ts`, `docs/ROADMAP.md`, `docs/MIGRATION.md`.

**Interfaces:** Vue routes actions to PDF or ebook store; WXT legacy annotation listeners are removed, root listeners retained. JSON/Markdown export uses the existing shared serializer.

- [x] Write component and listener-ownership tests.
- [x] Run targeted Vitest and observe expected failures.
- [x] Implement UI routing and remove only WXT duplicate listeners.
- [x] Run full Vitest, `npm run check`, WXT build verification, and real Edge E2E for ebook formats plus PDF regression.
- [x] Review the full diff and run all verification gates before the phase commit and push.
