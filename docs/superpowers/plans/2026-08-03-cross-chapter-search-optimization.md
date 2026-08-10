# Cross-Chapter Search Optimization Implementation Plan

> Execute with `superpowers:executing-plans` and TDD. Commit and push each independently verified core/integration increment.

**Goal:** Make EPUB/MOBI/AZW3 whole-book search fast after the first query, immediately cancel stale searches, and show reliable sentence-level context; align PDF result context and cancellation behavior.

**Architecture:** Add a DOM-independent sentence excerpt utility and a session-scoped `EbookSearchIndex`. The index lazily loads each section once, caches raw/normalized text only for the open book, emits stable result batches, and accepts `AbortSignal`. `reader.js` owns one index per open ebook and discards it on close.

**Constraints:** Root extension only (`D:\projects\reading-plugin`), no `.output/chrome-mv3`, no persistent full-text database, no vector search, maximum 300 rendered results, failures in one section do not abort other sections.

### Task 1: Sentence-aware context core

**Files:** create `src/core/search-context.ts`, `src/search-context.js`, generated runtime; test `tests/search-context.test.js`; modify `package.json`.

- [x] Write RED tests for English and Chinese sentence boundaries, whitespace collapse, match at boundaries, and 60-character fallback.
- [x] Implement `createSearchContext(source, start, length, radius?)` returning excerpt plus mapped start/end offsets.
- [x] Run focused tests, `npm run check`, and `npm test`.
- [x] Commit/push `feat: add sentence-aware search context`.

### Task 2: Session-scoped ebook index

**Files:** create `src/core/ebook-search-index.ts`, `src/ebook-search-index.js`, generated runtime; test `tests/ebook-search-index.test.js`; modify `package.json`.

**Interface:** constructor accepts ordered sections `{ index, label, loadText, createLocator }`; `search(query,{signal,batchSize,onBatch})`; `clear()`.

- [x] Write RED tests: each section loads once across queries; cached/current sections return first; batches preserve reading order; a new AbortController prevents any later old-result batches; section load error is reported and scanning continues.
- [x] Cache Promises to deduplicate concurrent section loads; never write cache to IndexedDB.
- [x] Build results with section, original offset/length, sentence context, and lazily generated locator.
- [x] Run focused/full unit gates; commit/push `feat: cache cancellable ebook search`.

### Task 3: Reader integration and PDF parity

**Files:** modify `src/reader.js`; test `tests/e2e/search-index.spec.ts`; extend controlled long-book fixture generator.

- [x] Write RED Edge scenario with repeated searches: first query scans multiple sections, second query reuses cache, rapidly submitted new query cancels old UI updates, result excerpt contains a complete sentence, result click navigates to the correct section.
- [x] Create/destroy one `EbookSearchIndex` with the current ebook; replace `ebookView.search()` loop with batched index results and an AbortController.
- [x] Prioritize current/cached sections without changing final stable reading-order result list.
- [x] Reuse `createSearchContext` and AbortController in PDF search; retain current per-page text cache.
- [x] Keep UI responsive by yielding between uncached sections and cap DOM results at 300.
- [x] Run search E2E plus EPUB/MOBI/AZW3/PDF regression.

### Task 4: Verification and release

- [x] Run `git diff --check`, `npm run check`, `npm test`, `npm run test:e2e`.
- [x] Update README and ROADMAP with exact counts and mark stage 3 complete if acceptance passes.
- [x] Request independent review and address verified Critical/Important findings.
- [x] Commit/push `feat: optimize cross-chapter search` and verify local/remote hashes.
