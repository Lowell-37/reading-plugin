# Task 3 report: Route WXT PDF sessions through Pinia

## Status

Completed and committed.

## Scope

- `LibraryStore` accepts legacy, ebook, and PDF ports. PDF records route only to the PDF store; ebook records route only to the ebook store; switching formats closes the current port before opening the next.
- `main.ts` builds the PDF.js adapter, attaches it to the PDF Pinia store, and exposes that store through the callback/port-only legacy bridge.
- The existing Vue shell derives PDF hosts, toolbar/page state, title, error copy, outline recursion, navigation, page jump, slider, zoom, and close/recovery behavior from PDF snapshots. The existing DOM IDs and legacy search/annotation nodes remain in place.
- PDF-active event handlers stop propagation before legacy click, keyboard, and input listeners can process the same control.

## TDD record

### RED

```powershell
npm test -- tests/library-store.test.ts tests/vue-shell.test.ts
```

The routing assertions initially failed because `LibraryStore.attachPdfPort` did not exist. The PDF workspace assertions then failed because the shell had neither `pdf-session-active` snapshot state nor PDF error recovery ownership.

### GREEN

```powershell
npm test -- tests/library-store.test.ts tests/vue-shell.test.ts
```

Result: 2 files, 40 tests passed.

## Verification

```powershell
npm test -- tests/library-store.test.ts tests/vue-shell.test.ts tests/pdf-session-store.test.ts tests/pdfjs-session.test.ts tests/architecture.test.js
npm run typecheck
npm run typecheck:vue
git diff --check
```

Results:

- Focused Task 2/3 regressions: 5 files, 74 tests passed.
- Core TypeScript typecheck: exit code 0.
- Vue TypeScript typecheck: exit code 0.
- Diff whitespace check: exit code 0.

## Risk

The focused Vitest command needs permission to create Vite's temporary config cache in this external worktree. This is an environment constraint; the approved runs above passed. Task 4's broader legacy PDF/search/annotation ownership deletion remains intentionally out of scope.
