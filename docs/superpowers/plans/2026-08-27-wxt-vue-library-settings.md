# WXT Vue 书架、面板与设置接管实施计划

> **阶段目标：** Vue 3 / Pinia 接管 WXT 版的书架、打开文件、删除、备份恢复、面板和阅读设置；旧 `reader.js` 只通过显式端口提供尚未迁移的阅读引擎能力。

**架构：** 根目录入口继续走现有自启动控制器。WXT 入口在预检成功后动态导入旧控制器并创建 `LegacyReaderPort`，Pinia stores 通过注入的 Repository 和 Port 执行应用动作。旧控制器用结构化事件上报阅读会话状态，不再由 `MutationObserver` 反向扫描 DOM。持久化仍只有 `BookRepository`、`storage.js` 和现有备份格式三条入口。

**技术栈：** WXT、Vue 3、TypeScript、Pinia、IndexedDB、Vitest、Playwright、Microsoft Edge。

## 不变量

- 根目录版行为和加载方式不变。
- IndexedDB 保持 `quiet-reader` schema v2，书籍记录和 `.quietreader` 备份格式不变。
- Pinia 只持有当前会话投影；刷新后重新读取 Repository，不成为第二事实来源。
- Foliate.js、PDF.js、目录、进度和批注引擎仍由旧控制器负责。
- WXT 组件不得直接导入 IndexedDB、Foliate.js、PDF.js 或 `src/reader.js`。
- AI UI 和请求路由继续关闭。

## 任务 1：用结构化 LegacyReaderPort 替换 DOM 反向同步

**文件：**

- 新建 `entrypoints/reader/legacy-reader-port.ts`
- 修改 `entrypoints/reader/legacy-bridge.ts`
- 修改 `entrypoints/reader/stores/reader.ts`
- 修改 `entrypoints/reader/main.ts`
- 修改 `src/reader.js`
- 修改 `tests/vue-shell.test.ts`
- 修改 `tests/architecture.test.js`

**步骤：**

1. 先写失败测试，要求 `legacy-bridge.ts` 不再包含 `MutationObserver`、`querySelector` 或 `syncFromDom`，并要求 reader store 能消费结构化的 `title`、`chapter`、`progress`、`isReading` 事件。
2. 定义端口接口：

   ```ts
   export interface LegacyReaderPort {
     openRecord(record: BookRecord, options?: { newlySaved?: boolean }): Promise<void>
     closeSession(): Promise<void>
     applySettings(settings: ReaderSettings): Promise<void>
     flushProgress(): Promise<void>
     destroy(): void
   }
   ```

3. `src/reader.js` 导出 `createLegacyReaderPort(callbacks)`；callbacks 包含 `onState`、`onPanelRequest` 和 `onLibraryChanged`。WXT 模式不绑定书架、面板和设置监听器，根目录模式继续执行原绑定逻辑。
4. 旧控制器在显示阅读器、返回书架、设置元数据和更新进度时调用结构化 callbacks；不再依赖 Vue 扫描 DOM。
5. `main.ts` 在动态导入后创建端口、注入 stores，并将 `data-legacy-controller="ready"` 放在端口初始化完成之后。
6. 运行目标单测、类型检查和 WXT 四格式基线。

## 任务 2：Pinia 接管设置与面板

**文件：**

- 新建 `entrypoints/reader/stores/settings.ts`
- 修改 `entrypoints/reader/stores/reader.ts`
- 修改 `entrypoints/reader/components/TopBar.vue`
- 修改 `entrypoints/reader/components/TocSidebar.vue`
- 修改 `entrypoints/reader/components/SettingsPanel.vue`
- 修改 `entrypoints/reader/components/ToolsPanel.vue`
- 修改 `entrypoints/reader/components/OverlayControls.vue`
- 修改 `entrypoints/reader/App.vue`
- 修改 `src/reader.js`
- 新建 `tests/settings-store.test.ts`
- 修改 `tests/vue-shell.test.ts`

**步骤：**

1. 先写失败测试，覆盖读取归一化设置、未知字段保留、主题/字体/字号/行距/栏宽/滚动模式更新、顶部栏收缩和关闭面板。
2. settings store 初始化时调用现有 `loadSettings()`；每次合法更新先写 `saveSettings()`，再调用端口 `applySettings()`。
3. `SettingsPanel.vue` 使用 store refs、`:class`、`:value` 和 Vue 事件，不再依赖旧控制器监听 `[data-flow]`、`[data-theme]` 及输入控件。
4. reader store 直接拥有 `activePanel`；顶部栏、目录、设置、工具、遮罩和 Esc 通过 store actions 开关，不再读写 `.open` / `.show` 作为事实来源。
5. Vue 用 class bindings 渲染面板状态；旧控制器只能通过 `requestPanel()` 请求打开面板。
6. 顶部栏收缩状态由 settings store 持久化，同时继续同步旧阅读引擎所需 body class。
7. 运行 store、组件、架构测试和真实 EPUB 的分页/滚动/主题/进度恢复 E2E。

## 任务 3：Pinia 接管书架、打开文件、删除和备份恢复

**文件：**

- 新建 `entrypoints/reader/stores/library.ts`
- 新建 `entrypoints/reader/library-dependencies.ts`
- 修改 `entrypoints/reader/components/WelcomeLibrary.vue`
- 修改 `entrypoints/reader/components/TopBar.vue`
- 修改 `entrypoints/reader/components/OverlayControls.vue`
- 修改 `entrypoints/reader/main.ts`
- 修改 `src/reader.js`
- 新建 `tests/library-store.test.ts`
- 修改 `tests/vue-shell.test.ts`
- 新建 `tests/e2e/wxt-vue-shell.spec.ts`

**步骤：**

1. 先写失败测试，覆盖 `load`、`openFile`、`openRecord`、`remove`、`backup` 和 `restore`；Repository 使用注入式内存实现，断言每个动作只调用一次持久化入口。
2. library store 使用 `shallowRef<BookRecord[]>` 保存 Repository 快照。`load()` 每次从 Repository 重读并按 `openedAt` 排序。
3. `openFile(file)` 使用共享格式检测；Repository 保存后以 `{ newlySaved: true }` 把 record 交给端口。解析失败时旧引擎按该标记删除刚保存的无效记录，并通过 `onLibraryChanged` 要求 store 重读 Repository。
4. `openRecord(record)` 先更新 `openedAt`，再调用端口；`remove(id)` 只删除指定记录并刷新投影。
5. `WelcomeLibrary.vue` 用 `v-for` 渲染封面、元数据、格式、大小和进度；对象 URL 在组件卸载或列表更新时撤销。
6. 打开按钮、拖放和隐藏文件输入统一调用 library store；旧控制器在 WXT 模式不再绑定这些监听器。
7. `backup()` 先请求端口 flush 当前进度，再使用 `createLibraryBackup()`；下载不包含 API key。
8. `restore(file)` 先完整解析和校验备份，再调用 Repository restore，合并非敏感设置并刷新书架；失败时不写入任何未经验证的记录。
9. 真实 Edge 验证导入 EPUB、书架重开、删除、备份恢复、进度和批注不回退。

## 任务 4：删除已迁移的旧监听器并建立所有权门禁

**文件：**

- 修改 `src/reader.js`
- 修改 `entrypoints/reader/legacy-reader-port.ts`
- 修改 `tests/reader-ui.test.js`
- 修改 `tests/architecture.test.js`
- 修改 `tests/wxt.test.js`

**步骤：**

1. 先写失败架构测试，列出 WXT 模式禁止绑定的 DOM 控件：书架按钮、文件输入、备份恢复、面板按钮、设置控件和遮罩。
2. 将 `bindControls()` 拆为阅读引擎监听器与根目录 UI 监听器；WXT 只启用阅读引擎监听器。
3. 删除 `legacy-bridge.ts` 中所有 DOM 观察逻辑；桥接只注册/注销结构化事件和端口。
4. 增加测试确保 Vue 组件不直接导入 `src/reader.js`、IndexedDB、Foliate.js 或 PDF.js。
5. 检查每个动作只存在一个事件监听器，避免一次点击执行两次保存、删除或恢复。

## 任务 5：完整验收、文档和集成

**文件：**

- 修改 `CHANGELOG.md`
- 修改 `docs/MIGRATION.md`
- 修改 `docs/ROADMAP.md`

**步骤：**

1. 运行 `npm run check`、`npm test`、`npm run build:wxt:verify`。
2. 运行阶段 B 数据连续性、WXT 四格式基线和新增 Vue 书架/设置 E2E。
3. 运行根目录 25 项真实 Edge 回归，确认旧入口行为不变。
4. 运行 `npm run release`，校验发布 ZIP、扩展 ID、升级与回滚。
5. 独立审查状态所有权、重复监听器、Blob 生命周期和数据写入边界；修复 Critical/Important 后复测。
6. 更新总体进度和下一阶段，提交并推送功能分支。
7. 快进合并到 `main`，在合并结果上重跑单测并推送。

## 完成标准

- WXT 书架、文件选择/拖放、删除、备份恢复、设置和面板由 Vue/Pinia 驱动。
- `legacy-bridge.ts` 不包含 `MutationObserver` 或 DOM 查询。
- WXT 的已迁移控件不存在旧控制器重复监听器。
- Repository 和现有备份格式仍是唯一持久化事实来源，schema 保持 v2。
- EPUB/MOBI/AZW3/PDF、进度、高亮、批注和阶段 B 数据连续性全部通过。
- 根目录扩展与发布 ZIP 回归通过，AI 保持关闭。
