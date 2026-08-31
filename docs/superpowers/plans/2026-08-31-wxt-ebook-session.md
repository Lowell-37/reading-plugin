# WXT 电子书会话接管 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 WXT 的 Vue/Pinia 接管 EPUB、MOBI、AZW3 阅读会话，而不改变根目录稳定入口或持久化格式。

**Architecture:** 用注入式 `EbookSessionPort` 隔离 Foliate.js 和连续滚动实现；Pinia 保存会话投影并发出命令。WXT library store 按格式选择 ebook port 或遗留 PDF port，旧 `reader.js` 在 WXT ebook 路径不再持有 ebook view、TOC、导航和进度监听。根目录入口继续使用既有控制器。

**Tech Stack:** WXT、Vue 3、TypeScript、Pinia、Foliate.js、现有 ContinuousEbookScroller、IndexedDB、Vitest、Playwright、Microsoft Edge。

**Spec:** `docs/superpowers/specs/2026-08-31-wxt-ebook-session-design.md`

## Global Constraints

- 根目录稳定入口、加载方式和既有 EPUB/MOBI/AZW3/PDF 行为不变。
- `quiet-reader` IndexedDB schema 保持 v2；BookRepository、ProgressService 和 `.quietreader` 备份格式仍是唯一持久化入口。
- 本阶段仅迁移 EPUB、MOBI、AZW3 会话；PDF、搜索、批注编辑/恢复和 AI 路由不迁移，AI 继续关闭。
- WXT Vue 组件不得直接导入 `src/reader.js`、Foliate.js、ContinuousEbookScroller、IndexedDB 或 Repository 实现。
- WXT ebook 会话使用 generation 阻断过期 open、relocate、恢复和错误回调；关闭必须幂等。
- 所有新行为先写失败测试；每个任务独立提交、审查和验证。

---

### Task 1: 定义电子书会话端口与 Pinia 投影

**Files:**
- Create: `entrypoints/reader/ebook-session-port.ts`
- Create: `entrypoints/reader/stores/ebook-session.ts`
- Modify: `entrypoints/reader/stores/reader.ts`
- Create: `tests/ebook-session-store.test.ts`
- Modify: `tests/vue-shell.test.ts`

**Interfaces:**
- Produces `EbookSessionPort`:
  ```ts
  export interface EbookSessionPort {
    open(record: BookRecord, settings: ReaderSettings): Promise<void>
    close(): Promise<void>
    goTo(target: unknown): Promise<void>
    navigate(direction: -1 | 1): Promise<void>
    setFlow(flow: 'paginated' | 'scrolled'): Promise<void>
    applySettings(settings: ReaderSettings): Promise<void>
    flushProgress(): Promise<void>
    destroy(): void
  }
  ```
- Produces `EbookSessionSnapshot` with `status`, `title`, `toc`, `chapter`, `progress`, `flow`, `error`, `generation`.
- Consumed by Task 2 adapter and Task 3 library routing.

- [ ] **Step 1: Write store tests before production code**

  In `tests/ebook-session-store.test.ts`, create a fake port that records calls and can emit snapshots. Test that `open()` resets stale title/chapter/progress, uses normalized settings, and ignores a snapshot whose generation is older than the current generation. Test `navigate(-1)`, `goTo(target)`, `setFlow('scrolled')`, `close()` and `flushProgress()` invoke exactly one corresponding port method.

- [ ] **Step 2: Run the new test and verify RED**

  Run: `npm test -- tests/ebook-session-store.test.ts`

  Expected: FAIL because `ebook-session-port` and `useEbookSessionStore` do not exist.

- [ ] **Step 3: Define the port types and minimal store**

  Add `EbookSessionPort`, callback types and a factory-created Pinia store. Keep `record` only as a session identity/projection; do not include Blob, annotations or Repository handles in store state. Use a monotonically increasing number in `open()` and discard callback snapshots whose `generation` differs.

- [ ] **Step 4: Run focused tests to verify GREEN**

  Run: `npm test -- tests/ebook-session-store.test.ts tests/vue-shell.test.ts`

  Expected: PASS, including pre-existing Vue state tests.

- [ ] **Step 5: Commit**

  ```powershell
  git add entrypoints/reader/ebook-session-port.ts entrypoints/reader/stores/ebook-session.ts entrypoints/reader/stores/reader.ts tests/ebook-session-store.test.ts tests/vue-shell.test.ts
  git commit -m "feat: add ebook session port and store"
  ```

### Task 2: 实现 Foliate 电子书会话适配器

**Files:**
- Create: `entrypoints/reader/foliate-ebook-session.ts`
- Create: `entrypoints/reader/ebook-session-dependencies.ts`
- Create: `tests/foliate-ebook-session.test.ts`
- Modify: `tests/continuous-ebook.test.js`

**Interfaces:**
- Consumes `EbookSessionPort`, `EbookSessionSnapshot`, `ReaderSettings` from Task 1.
- Produces `createFoliateEbookSession(dependencies)` returning an `EbookSessionPort`.
- Dependency seam supplies `createView()`, `createScroller(options)`, `createProgressService()`, `host`, `onSnapshot`, `onError` and `nextGeneration()`.

- [ ] **Step 1: Write adapter behavior tests first**

  In `tests/foliate-ebook-session.test.ts`, use fake view/scroller/progress service. Cover: opening applies paginated attributes/styles before restore; relocate emits normalized chapter/progress and schedules one progress write; flow changes retain current location; `close()` flushes then destroys scroller/view once; stale relocate after a newer open does not emit or write progress.

- [ ] **Step 2: Verify RED**

  Run: `npm test -- tests/foliate-ebook-session.test.ts`

  Expected: FAIL because the adapter factory is absent.

- [ ] **Step 3: Implement the dependency seam and adapter**

  Place all Foliate/continuous-scroll interactions in the adapter. On `open()`, increment generation, close existing resources, create a view in the injected host, open the record Blob, apply settings, restore record progress, emit loading → ready snapshots, and attach one relocate handler guarded by generation. On scroll switch, mount/destroy `ContinuousEbookScroller` while preserving CFI or fraction. Never call Repository directly except through injected progress service.

- [ ] **Step 4: Verify GREEN and lifecycle regression**

  Run: `npm test -- tests/foliate-ebook-session.test.ts tests/continuous-ebook.test.js tests/progress-service.test.js`

  Expected: PASS with no unhandled promise warnings.

- [ ] **Step 5: Commit**

  ```powershell
  git add entrypoints/reader/foliate-ebook-session.ts entrypoints/reader/ebook-session-dependencies.ts tests/foliate-ebook-session.test.ts tests/continuous-ebook.test.js
  git commit -m "feat: add Foliate ebook session adapter"
  ```

### Task 3: 将 WXT library 与阅读组件路由至 ebook session

**Files:**
- Modify: `entrypoints/reader/stores/library.ts`
- Modify: `entrypoints/reader/legacy-bridge.ts`
- Modify: `entrypoints/reader/main.ts`
- Modify: `entrypoints/reader/components/ReaderWorkspace.vue`
- Modify: `entrypoints/reader/components/TocSidebar.vue`
- Modify: `entrypoints/reader/components/OverlayControls.vue`
- Modify: `entrypoints/reader/components/TopBar.vue`
- Modify: `tests/library-store.test.ts`
- Modify: `tests/vue-shell.test.ts`

**Interfaces:**
- Consumes Task 1 store/port and Task 2 adapter.
- `library.openFile/openRecord` selects ebook port only for `epub`, `mobi`, `azw3`; PDF continues to call `LegacyReaderPort.openRecord`.
- `legacy-bridge` attaches both ports and remains callback/port-only with no DOM query or observer.

- [ ] **Step 1: Write routing and component RED tests**

  Extend `tests/library-store.test.ts` with injected ebook and legacy ports. Assert EPUB/MOBI/AZW3 call ebook `open()` exactly once and never legacy `openRecord`; assert PDF calls legacy exactly once and never ebook. Extend `tests/vue-shell.test.ts` so TOC `v-for`, previous/next, close and flow controls call ebook-session store actions, and component classes derive from store state.

- [ ] **Step 2: Verify RED**

  Run: `npm test -- tests/library-store.test.ts tests/vue-shell.test.ts`

  Expected: FAIL because library has only a legacy port and reader workspace controls are imperative-only.

- [ ] **Step 3: Route records and bind Vue controls**

  Add attach methods for ebook and legacy ports. Use shared `detectFormat()` result rather than file-name duplication. Render TOC items through Vue with stable key/index and call `ebookSession.goTo(item.href)`. Bind previous/next/close to store actions. Keep all DOM IDs expected by PDF/search/annotation legacy tools until their migration phases; when ebook session is active, hide legacy ebook navigation handlers and show the Vue-owned state.

- [ ] **Step 4: Verify GREEN**

  Run: `npm test -- tests/library-store.test.ts tests/vue-shell.test.ts tests/ebook-session-store.test.ts`

  Expected: PASS, including PDF routing regression and exactly-one command assertions.

- [ ] **Step 5: Commit**

  ```powershell
  git add entrypoints/reader/stores/library.ts entrypoints/reader/legacy-bridge.ts entrypoints/reader/main.ts entrypoints/reader/components/ReaderWorkspace.vue entrypoints/reader/components/TocSidebar.vue entrypoints/reader/components/OverlayControls.vue entrypoints/reader/components/TopBar.vue tests/library-store.test.ts tests/vue-shell.test.ts
  git commit -m "feat: route WXT ebook sessions through Pinia"
  ```

### Task 4: 收缩 WXT 中旧控制器的电子书所有权

**Files:**
- Modify: `src/reader.js`
- Modify: `entrypoints/reader/legacy-reader-port.ts`
- Modify: `src/reader-listener-registry.js`
- Modify: `tests/legacy-reader-port.test.ts`
- Modify: `tests/reader-ui.test.js`
- Modify: `tests/architecture.test.js`

**Interfaces:**
- Consumes the Task 3 WXT route decision.
- Root bootstrap remains `initializeLegacyReaderController({ mode: 'root' })` and retains ebook listeners.
- WXT legacy port exposes PDF/search/annotation behavior only; it must not initialize or mutate an ebook view.

- [ ] **Step 1: Write ownership RED tests**

  In `tests/legacy-reader-port.test.ts`, open an EPUB through WXT routing and assert no legacy `openEbook`/legacy ebook relocate or navigation binding is invoked; open PDF and assert legacy PDF path still initializes. In `tests/reader-ui.test.js`, assert WXT listener startup excludes legacy ebook prev/next/progress/TOC bindings while root registry retains them. In `tests/architecture.test.js`, assert WXT components/stores do not import `src/reader.js`, Foliate.js or `ContinuousEbookScroller`.

- [ ] **Step 2: Verify RED**

  Run: `npm test -- tests/legacy-reader-port.test.ts tests/reader-ui.test.js tests/architecture.test.js`

  Expected: FAIL because current WXT legacy port owns ebook open/navigation.

- [ ] **Step 3: Split the legacy controller boundary minimally**

  Add a WXT mode guard around ebook-only setup/open/navigation/progress ownership, without moving PDF/search/annotation behavior. Update the listener registry to distinguish root ebook listeners from shared engine listeners. Preserve root format handling and avoid deleting any DOM node expected by un-migrated tools.

- [ ] **Step 4: Verify GREEN and root regression**

  Run: `npm test -- tests/legacy-reader-port.test.ts tests/reader-ui.test.js tests/architecture.test.js tests/wxt.test.js`

  Expected: PASS; then run `npm run test:e2e` and require all 25 root Edge scenarios to pass.

- [ ] **Step 5: Commit**

  ```powershell
  git add src/reader.js entrypoints/reader/legacy-reader-port.ts src/reader-listener-registry.js tests/legacy-reader-port.test.ts tests/reader-ui.test.js tests/architecture.test.js
  git commit -m "refactor: isolate WXT ebook session ownership"
  ```

### Task 5: 真实 Edge 验收、数据连续性和文档

**Files:**
- Create: `tests/e2e/wxt-ebook-session.spec.ts`
- Modify: `tests/e2e/wxt-data-continuity.spec.ts`
- Modify: `CHANGELOG.md`
- Modify: `docs/MIGRATION.md`
- Modify: `docs/ROADMAP.md`

**Interfaces:**
- Consumes completed Task 1–4 session behavior.
- Validates WXT ebook session and root compatibility; no product API is produced.

- [ ] **Step 1: Write real Edge acceptance scenario first**

  Add `tests/e2e/wxt-ebook-session.spec.ts` using existing WXT fixture setup and real EPUB/MOBI/AZW3. For each format assert title, rendered content, Vue TOC jump, previous/next navigation, paginated→scrolled→paginated switch, nonzero persisted progress, close/reopen restoration, and no page errors. Add fast sequential opening of two EPUB records and assert only the newest title/progress remains.

- [ ] **Step 2: Verify RED**

  Run: `npx playwright test tests/e2e/wxt-ebook-session.spec.ts`

  Expected: FAIL before Tasks 1–4 because WXT does not expose Vue-owned ebook session controls/state.

- [ ] **Step 3: Extend continuity evidence**

  Extend `wxt-data-continuity.spec.ts` to write a WXT ebook progress position, reopen the same profile through root stable entry, and assert the stored position differs from initial and is read by root. Reverse the write/read direction in a second assertion.

- [ ] **Step 4: Run full verification matrix**

  Run:
  ```powershell
  npm run check
  npm test
  npm run build:wxt:verify
  npm run test:e2e:wxt:baseline
  npm run test:e2e:wxt:continuity
  npx playwright test tests/e2e/wxt-ebook-session.spec.ts
  npm run test:e2e
  npm run release
  ```

  Expected: all commands pass; WXT covers EPUB/MOBI/AZW3 session behavior, root 25-case suite remains green, and release identity/schema/upgrade/rollback remain compatible.

- [ ] **Step 5: Update verified documentation and commit**

  Update docs only with fresh command counts and actual Edge results; record that PDF/search/annotation remain legacy-owned and WXT is not the stable entry until later phases.

  ```powershell
  git add tests/e2e/wxt-ebook-session.spec.ts tests/e2e/wxt-data-continuity.spec.ts CHANGELOG.md docs/MIGRATION.md docs/ROADMAP.md
  git commit -m "test: verify WXT ebook session migration"
  ```

## Plan Self-Review

- Spec coverage: Tasks 1–4 implement the explicit session port, adapter, Vue routing and legacy ownership boundary; Task 5 covers every stated real Edge and data-continuity acceptance condition.
- Type consistency: Task 1 defines every Task 2–4 port/state name; Task 2 supplies the adapter; Task 3 routes it; Task 4 removes duplicate legacy ownership.
- Scope: PDF/search/annotation/AI/root migration are explicitly excluded from all implementation tasks.
- Placeholder scan: no incomplete markers or unspecified validation steps remain.
