# Stable Annotation Anchors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep EPUB/MOBI/AZW3 and PDF highlights attached to the same text after reader restart, ebook typography changes, flow-mode switches, PDF zoom, and PDF rerendering.

**Architecture:** Add a DOM-independent text-quote anchor core and a small DOM range adapter. Existing CFI/page/rect fields remain the fast path and compatibility layer; quote plus text offset is the verified fallback, and successfully repaired locations are persisted lazily.

**Tech Stack:** TypeScript, browser ESM, Foliate.js, PDF.js, IndexedDB repository, Vitest, jsdom, Playwright with Microsoft Edge.

## Global Constraints

- Stable extension entry is `D:\projects\reading-plugin`; do not modify or validate `.output/chrome-mv3`.
- Preserve existing IndexedDB records and version-1 annotation JSON compatibility; all new fields are optional.
- Use test-driven development: every production behavior begins with a failing test that fails for the expected reason.
- Do not silently draw a highlight when the stored quote cannot be uniquely resolved.
- Run the full root-extension Edge suite before marking this increment complete.

---

### Task 1: Text-quote anchor core and backward-compatible model

**Files:**
- Create: `src/core/text-anchor.ts`
- Create: `src/text-anchor.js`
- Generated: `src/core-runtime/text-anchor.js`
- Modify: `src/core/types.ts`
- Modify: `src/core/annotations.ts`
- Modify: `package.json`
- Test: `tests/text-anchor.test.js`
- Test: `tests/annotations.test.js`

**Interfaces:**
- Produces: `normalizeAnchorText(source)`, `createTextQuoteAnchor(source, start, end, contextLength?)`, and `resolveTextQuoteAnchor(source, anchor, preferredOffset?)`.
- Produces: optional `Annotation.anchor` with `TextQuoteAnchor`, `EbookAnnotationAnchor`, and `PdfAnnotationAnchor` types.
- Consumes: no DOM and no reader runtime state.

- [ ] **Step 1: Write failing text-anchor tests**

```js
import { createTextQuoteAnchor, normalizeAnchorText, resolveTextQuoteAnchor } from '../src/core/text-anchor.ts'

test('normalizes whitespace while retaining source offsets', () => {
  const value = normalizeAnchorText('One\n  two\tthree')
  assert.equal(value.text, 'One two three')
  assert.equal('One\n  two\tthree'.slice(value.offsets[4], value.offsets[6] + 1).trim(), 'two')
})

test('uses prefix and suffix to resolve repeated text', () => {
  const source = 'alpha target left. beta target right.'
  const start = source.lastIndexOf('target')
  const anchor = createTextQuoteAnchor(source, start, start + 6)
  assert.deepEqual(resolveTextQuoteAnchor(source, anchor, 0), {
    start,
    end: start + 6,
    confidence: 1,
    method: 'quote',
  })
})

test('does not resolve an ambiguous quote without context', () => {
  const anchor = { exact: 'same', normalizedExact: 'same', prefix: '', suffix: '' }
  assert.equal(resolveTextQuoteAnchor('same and same', anchor, null), null)
})
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run tests/text-anchor.test.js`

Expected: FAIL because `src/core/text-anchor.ts` does not exist.

- [ ] **Step 3: Implement the minimum core**

```ts
export interface NormalizedAnchorText {
  text: string
  offsets: number[]
}

export interface ResolvedTextAnchor {
  start: number
  end: number
  confidence: number
  method: 'offset' | 'quote'
}

export function normalizeAnchorText(source: unknown): NormalizedAnchorText
export function createTextQuoteAnchor(
  source: string,
  start: number,
  end: number,
  contextLength?: number,
): TextQuoteAnchor
export function resolveTextQuoteAnchor(
  source: string,
  anchor: TextQuoteAnchor,
  preferredOffset?: number | null,
): ResolvedTextAnchor | null
```

Normalization collapses Unicode whitespace to one ASCII space and records the original source index for every normalized character. Resolution first verifies the preferred offset, then enumerates exact normalized matches. Prefix and suffix select a candidate only when it is unique; a nearest-offset tie remains unresolved.

- [ ] **Step 4: Extend and normalize annotation types**

```ts
export interface TextQuoteAnchor {
  exact: string
  prefix: string
  suffix: string
  normalizedExact: string
}

export type AnnotationAnchor = EbookAnnotationAnchor | PdfAnnotationAnchor

export interface Annotation {
  // existing fields stay unchanged
  anchor?: AnnotationAnchor
  anchorStatus?: 'resolved' | 'unresolved'
}
```

`normalizeAnnotations()` must preserve valid version-1 anchors, discard malformed anchor objects without discarding the annotation, and continue returning legacy annotations without an anchor.

- [ ] **Step 5: Add browser wrapper and check entry**

`src/text-anchor.js`:

```js
export * from './core-runtime/text-anchor.js'
```

Add `node --check src/text-anchor.js` to `npm run check`.

- [ ] **Step 6: Run focused and full unit tests**

Run: `npx vitest run tests/text-anchor.test.js tests/annotations.test.js`

Expected: PASS.

Run: `npm test`

Expected: all existing and new unit tests PASS.

- [ ] **Step 7: Commit core anchor support**

```bash
git add src/core/text-anchor.ts src/text-anchor.js src/core-runtime/text-anchor.js src/core/types.ts src/core/annotations.ts package.json tests/text-anchor.test.js tests/annotations.test.js
git commit -m "feat: add stable text quote anchors"
```

---

### Task 2: DOM text offsets and range reconstruction

**Files:**
- Create: `src/text-range.js`
- Modify: `package.json`
- Test: `tests/text-range.test.js`

**Interfaces:**
- Consumes: `resolveTextQuoteAnchor()` from Task 1.
- Produces: `rangeTextOffsets(root, range)`, `rangeFromTextOffsets(root, start, end)`, `createRangeAnchor(root, range)`, and `resolveRangeAnchor(root, anchor, preferredOffset)`.

- [ ] **Step 1: Write failing jsdom tests**

```js
import { JSDOM } from 'jsdom'
import { createRangeAnchor, rangeFromTextOffsets, rangeTextOffsets, resolveRangeAnchor } from '../src/text-range.js'

test('maps a range across inline elements to document text offsets', () => {
  const dom = new JSDOM('<body>one <em>two</em> three</body>')
  const root = dom.window.document.body
  const range = dom.window.document.createRange()
  range.setStart(root.firstChild, 2)
  range.setEnd(root.querySelector('em').firstChild, 2)
  assert.deepEqual(rangeTextOffsets(root, range), { start: 2, end: 6 })
  assert.equal(rangeFromTextOffsets(root, 2, 6).toString(), 'e tw')
})

test('rebuilds the selected range after inline markup changes', () => {
  const first = new JSDOM('<body>before <b>selected words</b> after</body>').window.document.body
  const sourceRange = first.ownerDocument.createRange()
  sourceRange.selectNodeContents(first.querySelector('b'))
  const saved = createRangeAnchor(first, sourceRange)
  const second = new JSDOM('<body><span>before</span> selected <i>words</i> after</body>').window.document.body
  assert.equal(resolveRangeAnchor(second, saved.anchor, saved.textOffset).range.toString(), 'selected words')
})
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npx vitest run tests/text-range.test.js`

Expected: FAIL because `src/text-range.js` does not exist.

- [ ] **Step 3: Implement DOM tree-walker mapping**

Walk `NodeFilter.SHOW_TEXT` nodes in document order. Convert range endpoints to cumulative UTF-16 offsets. Reconstruct endpoints by locating the text node containing each offset. `resolveRangeAnchor()` delegates quote selection to Task 1, returns `{ range, textOffset, method }`, and returns `null` for an unresolved or collapsed range.

- [ ] **Step 4: Add syntax check and run tests**

Add `node --check src/text-range.js` to `npm run check`.

Run: `npx vitest run tests/text-range.test.js tests/text-anchor.test.js`

Expected: PASS.

- [ ] **Step 5: Commit DOM range support**

```bash
git add src/text-range.js package.json tests/text-range.test.js
git commit -m "feat: map annotation anchors to DOM ranges"
```

---

### Task 3: EPUB/MOBI/AZW3 anchor capture and repair

**Files:**
- Modify: `src/reader.js`
- Modify: `src/continuous-ebook.js`
- Test: `tests/reader-ui.test.js`
- Test: `tests/e2e/annotation-anchor-stability.spec.ts`

**Interfaces:**
- Consumes: `createRangeAnchor()` and `resolveRangeAnchor()` from Task 2.
- Produces: ebook annotations with `anchor.kind === 'ebook'`; repaired CFI is written back through existing `saveAnnotations()`.

- [ ] **Step 1: Write the failing EPUB Edge behavior test**

Create the EPUB case in `tests/e2e/annotation-anchor-stability.spec.ts`. It must create a highlight on a distinctive sentence, change font size, line height and page width, switch between paginated and continuous flow, reopen the stored book, and assert that the visible highlight and annotation list still refer to the same selected text.

- [ ] **Step 2: Run the EPUB scenario and verify RED**

Run: `npx playwright test tests/e2e/annotation-anchor-stability.spec.ts --grep EPUB`

Expected: FAIL because saved annotations do not contain a text quote anchor and the test cannot verify a reconstructed highlight after all layout transitions.

- [ ] **Step 3: Capture the ebook anchor**

Store `doc` in `pendingSelection` in `captureEbookSelection()`. In `annotateSelection()` call `createRangeAnchor(doc.body, range)` and pass:

```js
anchor: {
  version: 1,
  kind: 'ebook',
  section: pendingSelection.index,
  cfi: locator,
  textOffset,
  quote,
}
```

`createAnnotation()` must accept the optional anchor and preserve it.

- [ ] **Step 4: Repair paginated and continuous highlights**

Add a reader helper that, when a section document loads, resolves anchored annotations in that section. If the stored CFI does not reproduce the saved quote, rebuild the range, derive a replacement CFI using `ebookView.getCFI(index, range)`, update both `locator` and `anchor.cfi`, then persist once after processing the section.

Pass `resolveRangeAnchor` into `ContinuousEbookScroller`; in `#drawAnnotations()` use CFI first and verify `range.toString()`. If verification fails, resolve the quote in `item.doc.body`. Use a stable annotation ID as the overlayer key so repairing a locator does not leave duplicate marks.

- [ ] **Step 5: Complete EPUB behavior with the test kept red-green**

Run the focused EPUB scenario after each minimal integration change. Do not weaken its assertions: the test must still prove the stored quote, rendered mark and reopened annotation all name the same text.

- [ ] **Step 6: Finish integration and verify EPUB-family regression**

Run: `npm run check`

Run: `npx playwright test tests/e2e/annotation-anchor-stability.spec.ts tests/e2e/extension.spec.ts`

Expected: EPUB anchor test plus EPUB/MOBI/AZW3 open/navigation/restore tests PASS.

- [ ] **Step 7: Commit ebook anchor stability**

```bash
git add src/reader.js src/continuous-ebook.js src/core/annotations.ts src/core-runtime/annotations.js tests/reader-ui.test.js tests/e2e/annotation-anchor-stability.spec.ts
git commit -m "feat: stabilize ebook annotation anchors"
```

---

### Task 4: PDF text anchor and zoom-safe rectangles

**Files:**
- Modify: `src/reader.js`
- Modify: `tests/e2e/annotation-anchor-stability.spec.ts`
- Test: `tests/reader-ui.test.js`

**Interfaces:**
- Consumes: Task 2 DOM range APIs.
- Produces: PDF annotations with `anchor.kind === 'pdf'`; every rendered PDF page derives overlay rectangles from the current text layer.

- [ ] **Step 1: Add the failing PDF Edge behavior test**

Extend `tests/e2e/annotation-anchor-stability.spec.ts` to select text on page 1, create a highlight, zoom to 130%, force rerender, and assert that the overlay title and rectangle correspond to the same text-layer range. Reopen the stored PDF and repeat the assertions.

- [ ] **Step 2: Run the PDF scenario and verify RED**

Run: `npx playwright test tests/e2e/annotation-anchor-stability.spec.ts --grep PDF`

Expected: FAIL because the annotation has no text anchor and PDF overlays only reuse the previously stored rectangle.

- [ ] **Step 3: Capture PDF quote and offset**

In `capturePdfSelection()`, locate `.textLayer`, call `createRangeAnchor(textLayer, range)`, and retain it in `pendingSelection`. Create the annotation with:

```js
anchor: {
  version: 1,
  kind: 'pdf',
  page: pendingSelection.page,
  textOffset,
  quote,
}
```

- [ ] **Step 4: Rebuild rectangles on every page render**

Implement `resolvePdfAnnotationRects(wrapper, annotation)`. It resolves a range in the current `.textLayer`, converts its client rectangles to wrapper-relative ratios, and returns `null` when the quote is unresolved. `renderPdfAnnotationOverlays()` uses the fresh rectangles for anchored annotations and legacy `rects` only for annotations without anchors. When fresh rectangles differ, update `annotation.rects` in memory and persist after the render cycle without recursively invalidating pages.

- [ ] **Step 5: Complete PDF behavior with the test kept red-green**

Run the focused PDF scenario after each minimal integration change. Keep the text identity and geometric alignment assertions intact so the test catches stale-coordinate rendering.

- [ ] **Step 6: Verify PDF and full regression**

Run: `npm run check`

Run: `npm test`

Run: `npm run test:e2e`

Expected: all commands exit 0; every unit and all root Edge E2E tests PASS.

- [ ] **Step 7: Update product documentation**

In `README.md`, state that same-file highlights survive typography, flow-mode, PDF zoom, rerender and restart. In `docs/ROADMAP.md`, mark the same-file anchor acceptance item complete but keep content-version fuzzy recovery and search optimization pending. Update exact test counts from fresh command output.

- [ ] **Step 8: Commit and push the completed first increment**

```bash
git add README.md docs/ROADMAP.md src/reader.js tests/reader-ui.test.js tests/e2e/annotation-anchor-stability.spec.ts
git commit -m "feat: keep PDF highlights aligned across zoom"
git push origin agent/reader-v0.2.0
```

Confirm `git rev-parse HEAD` equals `git rev-parse origin/agent/reader-v0.2.0` before starting the content-change recovery plan.
