# WXT Parsed Metadata Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist parsed EPUB/PDF title and author metadata, plus EPUB cover artwork, so the WXT reader and bookshelf retain them across navigation and reloads.

**Architecture:** Format adapters report cleaned metadata through an optional callback. The Pinia library store writes the partial record update to the existing repository and updates its in-memory projection without changing the IndexedDB schema. Reader UI derives author and cover from that canonical library record.

**Tech Stack:** WXT, Vue 3, TypeScript, Pinia, Foliate.js, PDF.js, IndexedDB, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-27-wxt-vue-migration-design.md`

## Task 1: Lock the regression down

- [x] Add store tests for metadata/cover persistence and in-memory refresh.
- [x] Add Foliate and PDF adapter tests for parsed metadata callbacks.
- [x] Extend the real accessible EPUB Edge test to verify bookshelf metadata and reload persistence.
- [x] Run the focused tests and confirm the new assertions fail for the expected missing behavior.

## Task 2: Implement repository writeback

- [x] Add a typed optional parsed-metadata callback to the format adapter dependencies.
- [x] Parse EPUB/PDF title and author safely; extract EPUB cover without clearing an existing cover on extraction failure.
- [x] Add the library store writeback action and wire it from the reader composition root.
- [x] Reject stale async adapter results after session replacement.

## Task 3: Complete reader UI parity

- [x] Render the active record author and cover in the table-of-contents sidebar.
- [x] Add component coverage for metadata-derived sidebar output and object-URL cleanup.
- [x] Update migration status and changelog/test counts.

## Task 4: Verify and deliver

- [x] Run type checks, all unit tests, fixture verification, WXT build verification, and focused real Edge suites.
- [x] Request an independent data-safety/code review and resolve all Important/Critical findings.
- [x] Commit, push `main`, and verify the remote commit.
