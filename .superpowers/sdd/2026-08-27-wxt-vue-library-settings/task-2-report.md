# Task 2 report — Pinia 接管设置与面板

## Status

Complete. Task 2 is implemented on `feat/wxt-vue-library-settings` from approved Task 1 head `3ba381e`.

## Scope implemented

- Added a Pinia settings store that initializes from the existing `loadSettings()` normalization path.
- Kept the complete normalized settings snapshot, including unknown persisted fields.
- Added validated theme, flow, font, font-size, line-height, page-width, and header-collapse actions.
- Every accepted action calls `saveSettings()` exactly once before applying the same snapshot through `LegacyReaderPort.applySettings()`.
- Attached/detached the settings store to the Task 1 port through the legacy bridge.
- Made `reader.activePanel` the WXT source of truth, with toggle/close/request actions.
- Bound TOC, Settings, Tools, scrim, close buttons, and Escape rendering/behavior to Pinia.
- Bound the settings panel's active classes, values, outputs, and input/change/click events to Pinia.
- Persisted header collapse through the settings store and synchronized the legacy engine body class through the port.
- Split only the migrated settings/panel/header/Escape listener group in `src/reader.js`; root mode retains its legacy bindings.
- Kept engine-originated `openPanel()`/`closePanels()` behavior as structured `onPanelRequest` requests in WXT mode.
- Added WXT app-root height ownership needed for the continuous EPUB reader to receive a real viewport under Vue's `#app` wrapper.
- Extended the real-book WXT baseline with pagination, continuous scroll, theme persistence, and EPUB progress restoration.

## Exact TDD RED evidence

### RED 1 — requested store did not exist

Command:

```text
npm test -- tests/settings-store.test.ts tests/vue-shell.test.ts
```

Result: exit 1; 2 failed suites, 0 tests collected.

Exact failure:

```text
Failed to resolve import "../entrypoints/reader/stores/settings"
Test Files  2 failed (2)
Tests       no tests
```

This failed at the missing production boundary requested by the brief.

### RED 2 — Vue still did not own panels/settings/header

After adding the minimal settings store, command:

```text
npm test -- tests/vue-shell.test.ts
```

Result: exit 1; 3 failed, 5 passed.

Exact behavior failures:

```text
expected null to be 'toc'
expected [ 'sepia' ] to include 'active'
expected false to be true
```

These respectively caught missing Pinia panel actions/classes, missing persisted settings rendering, and missing Pinia header-collapse handling.

### RED 3 — WXT still had duplicate legacy listeners and no header body sync

Command:

```text
npm test -- tests/legacy-reader-port.test.ts
```

Result: exit 1; 2 failed, 2 passed.

Exact behavior failures:

```text
expected [ null, 'settings' ] to deeply equal []
expected false to be true
```

These caught the duplicate legacy settings-button request and missing `header-collapsed` body class after `port.applySettings()`.

## GREEN evidence while iterating

Settings store:

```text
npm test -- tests/settings-store.test.ts
Test Files  1 passed (1)
Tests       9 passed (9)
```

Focused store, component, and port suite:

```text
npm test -- tests/settings-store.test.ts tests/vue-shell.test.ts tests/legacy-reader-port.test.ts
Test Files  3 passed (3)
Tests       21 passed (21)
```

## Real EPUB E2E discovery and fix

The first extended baseline run produced 5 passes and 1 failure. After selecting Scroll, the continuous reader existed but Playwright reported it hidden. Instrumented layout evidence showed:

```text
.continuous-ebook rect height: 0
#ebook-host rect height: 0
.reader-stage rect height: 0
```

Root cause: the root reader's `.reader-view` is a child of the 100%-high body, but the WXT reader is nested under Vue's auto-height `#app`. The percentage-height reading stage therefore collapsed under WXT. `App.vue` now gives `#app` 100% height. The exact targeted scenario then passed:

```text
npx playwright test tests/e2e/wxt-baseline.spec.ts --grep "switches and restores"
1 passed (3.8s)
```

A subsequent timeout was traced to the test attempting to click the TOC button through the active settings scrim. The scenario now uses the real Vue close-settings control before opening TOC; no production change was made for that test interaction.

## Final verification

All commands below were run fresh against the final diff.

```text
npm test
Test Files  34 passed (34)
Tests       169 passed (169)
exit 0
```

```text
npm run check
changelog verification, core build, TypeScript, Vue TypeScript, and JavaScript syntax checks passed
exit 0
```

```text
npm run test:e2e:wxt:baseline
6 passed (13.9s)
exit 0
```

This includes real EPUB/MOBI/AZW3/PDF checks and the new real EPUB pagination → scroll → pagination, Dark theme, persisted scroll mode, and progress restoration scenario.

```text
npm run test:e2e:wxt:continuity
2 passed (11.2s)
exit 0
```

This independently verifies root → WXT → root book/progress/settings continuity, unknown setting preservation, theme updates, schema v2, and damaged-schema blocking.

## Files changed

- `entrypoints/reader/stores/settings.ts` (new)
- `entrypoints/reader/stores/reader.ts`
- `entrypoints/reader/legacy-bridge.ts`
- `entrypoints/reader/components/TopBar.vue`
- `entrypoints/reader/components/TocSidebar.vue`
- `entrypoints/reader/components/SettingsPanel.vue`
- `entrypoints/reader/components/ToolsPanel.vue`
- `entrypoints/reader/components/OverlayControls.vue`
- `entrypoints/reader/App.vue`
- `src/reader.js`
- `tests/settings-store.test.ts` (new)
- `tests/vue-shell.test.ts`
- `tests/legacy-reader-port.test.ts`
- `tests/e2e/wxt-baseline.spec.ts`

## Self-review and concerns

- No library/file/backup ownership was moved; those WXT legacy listeners remain for Task 3.
- No schema, backup format, Foliate/PDF/annotation/progress engine ownership, or AI enablement changed.
- WXT Vue components do not import IndexedDB, Foliate.js, PDF.js, `ContinuousEbookScroller`, or `src/reader.js`.
- Root-mode settings and panel listeners remain active behind the WXT ownership gate; the continuity suite exercised root theme/tools/progress behavior successfully.
- Known non-blocking build warning: WXT reports an existing chunk larger than 500 kB. No new dependency was added and the build completes successfully.
- No unresolved Task 2 correctness concern found in the final diff.
