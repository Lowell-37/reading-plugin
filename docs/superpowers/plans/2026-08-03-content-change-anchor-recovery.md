# Content-Change Annotation Recovery Implementation Plan

> **Execution:** Use `superpowers:executing-plans` and test-driven development. Finish, verify, commit, and push this increment before starting search optimization.

**Goal:** Recover imported EPUB/MOBI/AZW3 and PDF annotations when a newer edition has small text or pagination changes, while never drawing an ambiguous or low-confidence match.

**Architecture:** Keep exact same-file resolution unchanged. Add a DOM-independent bounded fuzzy matcher and a format-neutral nearby-location recovery coordinator. The reader import adapter supplies only the original ebook section plus adjacent sections, or the original PDF page plus two pages on either side. Accepted matches rebuild the quote anchor and structural locator; rejected matches preserve the annotation and set `anchorStatus: 'unresolved'`.

**Tech stack:** TypeScript, browser ESM, Foliate.js, PDF.js, IndexedDB, Vitest, Playwright with Microsoft Edge.

## Global constraints

- Stable extension entry is `D:\projects\reading-plugin`; ignore `.output/chrome-mv3`.
- Preserve annotation JSON version 1 and existing IndexedDB records.
- Fuzzy recovery runs only for imported anchored annotations; ordinary book opening keeps the exact resolver.
- Search scope is bounded: ebook section `origin ± 1`; PDF page `origin ± 2`.
- Accept only one candidate with score `>= 0.86` and a lead of `>= 0.08` over second place.
- An unresolved annotation remains editable/exportable and can jump near its old section/page, but produces no highlight overlay.
- Every production behavior starts with a failing test.

---

### Task 1: Bounded fuzzy quote matcher

**Files:**
- Modify: `src/core/text-anchor.ts`
- Generated: `src/core-runtime/text-anchor.js`
- Test: `tests/text-anchor.test.js`

**Interface:**

```ts
export interface FuzzyAnchorOptions {
  minimumConfidence?: number // default 0.86
  minimumLead?: number // default 0.08
  searchRadius?: number // default 4096 around preferred offset
}

export function resolveChangedTextQuoteAnchor(
  source: string,
  anchor: TextQuoteAnchor,
  preferredOffset?: number | null,
  options?: FuzzyAnchorOptions,
): ResolvedTextAnchor | null
```

- [ ] Write failing tests for a one-word insertion, a one-word deletion, a moved nearby quote, a tied duplicate, a score below 0.86, and a winner whose lead is below 0.08.
- [ ] Add a long repeated-source regression proving candidate scoring never slices unbounded chapter context.
- [ ] Run `npx vitest run tests/text-anchor.test.js` and confirm RED for the missing API.
- [ ] Implement exact-first resolution, then fixed-length bounded edit-distance scoring with early cutoff. Weight normalized quote similarity at 80% and bounded prefix/suffix agreement at 20%.
- [ ] Map the accepted normalized window back to source offsets and return `method: 'fuzzy'` with the computed confidence.
- [ ] Run the focused test until GREEN; then run `npm run check` to regenerate the browser runtime and verify the `.js` import graph.

---

### Task 2: Nearby-location recovery coordinator

**Files:**
- Create: `src/core/anchor-recovery.ts`
- Create: `src/anchor-recovery.js`
- Generated: `src/core-runtime/anchor-recovery.js`
- Modify: `src/core/types.ts`
- Modify: `package.json`
- Test: `tests/anchor-recovery.test.js`

**Interface:**

```ts
export interface AnchorRecoveryCandidate<Location> {
  location: Location
  text: string
  preferredOffset: number | null
}

export interface RecoveredAnchor<Location> {
  location: Location
  start: number
  end: number
  confidence: number
  method: 'offset' | 'quote' | 'fuzzy'
  quote: TextQuoteAnchor
}

export function recoverTextAnchor<Location>(
  anchor: TextQuoteAnchor,
  candidates: AnchorRecoveryCandidate<Location>[],
): RecoveredAnchor<Location> | null
```

- [ ] Write failing tests showing origin exact match wins, an adjacent location can win, duplicate high-score candidates are unresolved, and rejected recovery does not mutate inputs.
- [ ] Run `npx vitest run tests/anchor-recovery.test.js` and confirm RED.
- [ ] Implement two passes: exact resolution across bounded candidates first, fuzzy ranking second. Enforce the global score and lead thresholds across locations, not separately per location.
- [ ] Rebuild the returned quote using the matched current-edition text so later ordinary exact rendering works.
- [ ] Add the browser wrapper and syntax check; run focused tests and `npm test`.
- [ ] Commit the core recovery layer with `feat: add bounded annotation recovery` and push it.

---

### Task 3: Import adapter and unresolved-state UI

**Files:**
- Modify: `src/reader.js`
- Modify: `src/continuous-ebook.js`
- Modify: `reader.css`
- Modify: `package.json`
- Create: `scripts/create-versioned-epub.mjs`
- Create: `tests/e2e/annotation-version-recovery.spec.ts`
- Test: `tests/reader-ui.test.js`

**Behavior:**

- [ ] Create a deterministic two-edition EPUB fixture. Edition 2 contains one small, uniquely recoverable text edit and one deliberately ambiguous duplicate. Both editions are uploaded to Edge with the same browser-visible filename but different file signatures.
- [ ] Write a failing Edge test: create/export two annotations in edition 1; open edition 2; import JSON; assert one annotation is rebound and visibly highlighted on changed text, while the other shows `需要重新定位` and has no overlay.
- [ ] Add a failing unit/UI test that unresolved items render a status badge and still jump to the old section/page.
- [ ] Run the new tests and confirm RED because import currently registers stored locators directly.
- [ ] For ebook imports, lazily load only `section ± 1`, pass each document body text to `recoverTextAnchor`, rebuild a DOM Range and CFI for an accepted result, and update `section`, `locator`, `anchor.cfi`, `anchor.textOffset`, `anchor.quote`, and `anchorStatus`.
- [ ] For PDF imports, extract anchor text using the same concatenation semantics as the PDF text layer for only `page ± 2`; update `page`, `locator`, `anchor.page`, `anchor.textOffset`, `anchor.quote`, clear stale `rects`, and set status.
- [ ] Mark rejected anchored imports `unresolved`; do not overwrite text, note, tags, creation time, or local-newer conflict winners.
- [ ] Skip unresolved annotations in paginated EPUB, continuous EPUB, and PDF overlay renderers. Add a visible `需要重新定位` badge to the annotation list; its jump button keeps the old location behavior.
- [ ] Batch persistence once after all imported annotations are processed, then render overlays/list once.
- [ ] Run the new Edge test, annotation import unit tests, and annotation tools regression until GREEN.
- [ ] Run EPUB/MOBI/AZW3/PDF opening tests to ensure import recovery does not affect ordinary reading.

---

### Task 4: Full verification, documentation, and release of increment 2

**Files:**
- Modify: `README.md`
- Modify: `docs/ROADMAP.md`

- [ ] Run `git diff --check`.
- [ ] Run `npm run check`.
- [ ] Run `npm test` and record the exact passing count.
- [ ] Run `npm run test:e2e` against the root extension and record the exact Edge count.
- [ ] Update README with bounded import recovery and the explicit unresolved behavior.
- [ ] Update ROADMAP: mark content-change recovery complete, keep cross-chapter search pending, and update exact test counts.
- [ ] Request code review; fix verified Critical/Important findings and rerun the relevant gates.
- [ ] Commit with `feat: recover imported annotations after content changes`.
- [ ] Push `agent/reader-v0.2.0` and verify local HEAD equals `origin/agent/reader-v0.2.0`.
- [ ] Automatically start the separate cross-chapter search optimization plan.
