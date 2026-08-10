# PDF Hidden Container Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make rendered PDF pages visible inside the reader stage while preserving EPUB/MOBI/AZW3 layout behavior.

**Architecture:** Keep the existing JavaScript ownership of `hidden` state and correct the CSS contract so inactive reader roots do not participate in layout. Extend the real Edge PDF E2E with layout assertions that fail when the PDF viewport is pushed outside the reader stage.

**Tech Stack:** CSS, JavaScript, Playwright, Microsoft Edge, PDF.js

## Global Constraints

- Load and test the unpacked extension from `D:\projects\reading-plugin`, not `.output/chrome-mv3`.
- Do not change PDF.js parsing, IndexedDB, progress, zoom, text-layer, or ebook continuous-scroll logic.
- Do not add the user-provided PDF to Git; use the existing `tracemonkey.pdf` fixture for the committed regression test.
- The inactive `#ebook-host` or `#pdf-viewport` must not occupy layout space.

---

### Task 1: Keep inactive reader containers out of layout

**Files:**
- Modify: `tests/e2e/extension.spec.ts:36`
- Modify: `styles/reader.css:105`

**Interfaces:**
- Consumes: existing `hidden` attributes set by `openPdf`, `openEbook`, and `closeReader` in `src/reader.js`.
- Produces: CSS behavior where `.ebook-host[hidden]` and `.pdf-viewport[hidden]` compute to `display: none`.

- [ ] **Step 1: Write the failing PDF layout regression test**

Add these assertions immediately after `await openBook(page, 'tracemonkey.pdf')` in the existing PDF E2E:

```ts
await expect(page.locator('#ebook-host')).toBeHidden()
const pdfLayout = await page.evaluate(() => {
  const stage = document.querySelector<HTMLElement>('#reader-stage')!
  const viewport = document.querySelector<HTMLElement>('#pdf-viewport')!
  const firstPage = document.querySelector<HTMLElement>('.pdf-page[data-page="1"]')!
  const stageRect = stage.getBoundingClientRect()
  const viewportRect = viewport.getBoundingClientRect()
  const pageRect = firstPage.getBoundingClientRect()
  return {
    ebookDisplay: getComputedStyle(document.querySelector<HTMLElement>('#ebook-host')!).display,
    viewportStartsInsideStage: viewportRect.top < stageRect.bottom && viewportRect.bottom > stageRect.top,
    pageIntersectsReader: pageRect.top < Math.min(stageRect.bottom, viewportRect.bottom)
      && pageRect.bottom > Math.max(stageRect.top, viewportRect.top),
  }
})
expect(pdfLayout).toEqual({
  ebookDisplay: 'none',
  viewportStartsInsideStage: true,
  pageIntersectsReader: true,
})
```

- [ ] **Step 2: Run the focused E2E and verify RED**

Run:

```powershell
npx playwright test tests/e2e/extension.spec.ts --grep "PDF renders"
```

Expected: FAIL because `#ebook-host` computes to `display: block` and the PDF viewport starts at or below the reader-stage boundary.

- [ ] **Step 3: Add the minimal hidden-container CSS rule**

Immediately after the shared reader-root sizing rule in `styles/reader.css`, add:

```css
.ebook-host[hidden],.pdf-viewport[hidden] { display:none; }
```

Do not add JavaScript state or change the existing open/close functions.

- [ ] **Step 4: Run the focused E2E and verify GREEN**

Run:

```powershell
npx playwright test tests/e2e/extension.spec.ts --grep "PDF renders"
```

Expected: PASS; the hidden ebook root no longer occupies space and the first PDF page intersects both the PDF viewport and reader stage.

- [ ] **Step 5: Reproduce with the user PDF**

Open the provided 220-page PDF in an isolated Edge session loading the repository root. Verify `.pdf-page[data-page="1"]` reaches `data-state="rendered"`, `#pdf-viewport` overlaps `#reader-stage`, and sampled canvas pixels contain non-white content. Do not copy the PDF into the repository.

- [ ] **Step 6: Run complete verification**

Run:

```powershell
npm run check
npm test
npm run test:e2e
git diff --check
```

Expected: static checks pass, all unit tests pass, all Edge E2E tests pass, and Git reports no whitespace errors.

- [ ] **Step 7: Commit the fix**

```powershell
git add tests/e2e/extension.spec.ts styles/reader.css docs/superpowers/plans/2026-08-10-pdf-hidden-container-fix.md
git commit -m "fix: keep PDF pages inside reader viewport"
```

The commit must exclude diagnostic screenshots and the user-provided PDF.
