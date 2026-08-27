# WXT 数据连续性门禁实施计划

> **阶段目标：** 在不改变 IndexedDB schema v2 和备份格式的前提下，证明根目录稳定版、WXT 构建版与回滚后的根目录稳定版共享同一份书库数据。

**架构：** 新增一个无 UI 依赖的只读迁移预检模块，由 WXT 入口在旧控制器启动前调用。预检只观察数据库、书籍记录和设置，输出稳定的结构化结果；成功后才启动现有阅读控制器，失败时由 Vue 显示持久恢复界面。自动化使用同一个 Edge 用户目录依次加载两个扩展目录，固定扩展 ID 是唯一的数据继承机制。

**技术栈：** WXT、Vue 3、TypeScript、IndexedDB、Vitest、Playwright、Microsoft Edge。

## 不变量

- `quiet-reader` 数据库继续使用 schema v2；本阶段禁止新增迁移或对象仓库。
- `books`、`meta`、书籍 Blob、进度、批注和 `.quietreader` 格式保持不变。
- 根目录仍是日常稳定入口；阶段 B 只增加门禁，不切换发布入口。
- 预检不得删除、清空、批量写回或自动修复数据库。
- 设置只在内存中归一化：非法已知字段回退默认值，未知字段保留。
- AI 路由和界面继续关闭。

## 任务 1：定义只读预检契约

**文件：**

- 新建 `src/core/migration-preflight.ts`
- 新建 `tests/migration-preflight.test.ts`

**步骤：**

1. 先写失败测试，覆盖空白配置、合法 schema v2、缺失对象仓库、未来数据库版本、缺失 schema 元数据、损坏书籍字段和不可读 Blob。
2. 定义可序列化的成功结果：数据库是否存在、版本、书籍数、Blob 总字节、含进度/批注的记录数、设置归一化结果和警告。
3. 定义稳定错误码和可导出的诊断对象，不把 Blob、API Key 或书籍正文写入诊断。
4. 实现依赖注入式核心检查，保证单测不依赖真实浏览器数据库。
5. 运行目标测试和全量 Vitest。

## 任务 2：接入浏览器只读探针和 WXT 启动门禁

**文件：**

- 新建 `entrypoints/reader/migration-preflight.ts`
- 修改 `entrypoints/reader/main.ts`
- 修改 `entrypoints/reader/App.vue`
- 新建 `entrypoints/reader/components/MigrationErrorView.vue`
- 修改 `src/storage.js`
- 修改相关 Vue / storage 测试

**步骤：**

1. 先写失败测试，约束 WXT 必须在导入 `src/reader.js` 前完成预检。
2. 使用 `indexedDB.databases()` 判断旧库是否存在；新安装不创建数据库，已有库使用无版本号的只读连接。
3. 在一个只读事务中读取 schema、计数并逐条检查关键字段和 Blob 可读性，不调用 `put`、`delete` 或 `clear`。
4. 通过 Vue 状态展示阻断界面，提供“导出诊断”“恢复备份”“返回书架”入口；恢复入口只打开现有备份 UI，不自动覆盖数据。
5. 为合法预检设置可测试的页面状态；只有成功时加载旧控制器。
6. 将设置归一化抽成纯函数，保持未知字段但让非法已知字段回退默认值。

## 任务 3：建立同一 Edge 用户目录的双向数据门禁

**文件：**

- 修改 `tests/e2e/helpers/extension-launch.ts`
- 新建 `tests/e2e/wxt-data-continuity.spec.ts`
- 修改 `package.json`

**步骤：**

1. 扩展启动助手支持显式持久用户目录，不删除调用方持有的数据。
2. 根目录版导入真实 EPUB，并写入可辨识的设置、阅读进度、高亮、批注及 schema 元数据。
3. 关闭 Edge，以同一用户目录加载 WXT 构建版；断言扩展 ID、书籍 Blob 摘要、设置、进度、批注和 schema 全部一致。
4. 在 WXT 中继续修改设置、进度和批注，再关闭 Edge。
5. 回滚加载根目录版，断言 WXT 修改可读，Blob 摘要未变，schema 仍为 v2。
6. 增加损坏 schema 的 WXT 预检 E2E，确认页面进入持久错误状态且原始数据不被修改。

## 任务 4：验收、文档、提交与合并

**文件：**

- 修改 `docs/MIGRATION.md`
- 修改 `docs/ROADMAP.md`
- 修改 `CHANGELOG.md`

**步骤：**

1. 运行 `npm run check`、`npm test`、`npm run build:wxt:verify`。
2. 运行 WXT 四格式基线、新数据连续性门禁和根目录 25 项真实 Edge 回归。
3. 运行 `npm run release`，确认根目录发布 ZIP 不变质。
4. 独立审查读写边界、敏感诊断信息和 E2E 是否可能假通过。
5. 更新阶段进度，提交并推送功能分支。
6. 在验证通过后快进合并到 `main`，在合并结果上复测并推送。

## 完成标准

- 根目录→WXT→根目录在同一真实 Edge 用户目录中通过。
- 书籍 Blob 字节摘要、设置、进度、高亮、批注和 schema v2 均被明确断言。
- 预检失败不会启动旧控制器，也不会修改数据库。
- WXT 构建与根目录扩展 ID 一致，AI 保持关闭。
- 所有单测、根目录 E2E、WXT E2E 和发布校验通过。
