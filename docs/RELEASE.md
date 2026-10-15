# 根目录稳定版发布、升级与回滚

本项目当前正式发布的是根目录稳定版，而不是 `.output/chrome-mv3`。发布前先在项目根目录运行：

```powershell
npm run check
npm test
npm run test:e2e
npm run release
```

发布前先把 `CHANGELOG.md` 的 `[Unreleased]` 内容整理到与 `package.json` 一致的新版本标题下。`npm run release` 会拒绝缺少当前版本、没有分类变更条目或版本顺序错误的变更日志。

`npm run release` 会创建以下文件（均在 `dist/`）：

- `quiet-reader-<version>.zip`：可分发的扩展包。
- `quiet-reader-<version>.sha256`：ZIP 的 SHA-256 校验和。
- `quiet-reader-<version>.json`：版本、文件清单和校验和。

ZIP 内文件顺序与条目时间戳固定；相同源码、依赖和版本连续执行会生成相同的 SHA-256。

发布包只包含根目录版运行所需的 `manifest.json`、`reader.html`、`styles/`、`src/`、Foliate.js 和 PDF.js 运行时资源；不会包含测试、WXT 输出或整个开发依赖目录。解压后选择包含 `manifest.json` 的目录，在 Edge 的 `edge://extensions` 中使用“加载解压缩的扩展”。

自动化 Edge E2E 会从 ZIP 解压并加载扩展，验证它与项目根目录稳定版使用同一个固定扩展 ID 且能打开书架首页。

## 升级

1. 升级前在书架首页选择“备份书库”，妥善保存 `.quietreader` 文件。
2. 优先保留当前扩展目录，在该目录中替换为新版本文件，然后在 `edge://extensions` 点击该扩展的“重新加载”；不要把“移除扩展”当作普通升级步骤。
3. 确认扩展 ID 与旧版相同，打开一册已读书籍，检查书库、阅读位置和批注。固定 manifest 公钥保持扩展 ID，但不能代替外部备份。
4. 如果必须改用新目录或移除后重装，先确认 `.quietreader` 备份文件可用。移除扩展后的本地数据不保证保留；若重装后书库为空，在书架首页选择“恢复备份”，不要尝试手工复制 IndexedDB 文件。

自动化 Edge 测试已覆盖同一临时用户配置下移动解压目录、版本升级和回滚，以及新配置从备份恢复；命令行加载解压扩展与在 `edge://extensions` 手动“移除”不是同一个操作，后者仍需人工验收。参见 [Edge 本地扩展的重新加载与移除](https://learn.microsoft.com/en-us/microsoft-edge/extensions/getting-started/extension-sideloading)。[Chromium 文档](https://developer.chrome.com/docs/extensions/reference/api/storage/)明确指出其 `storage.local` 在移除扩展时清除；本项目使用的 IndexedDB 卸载行为仍应以实际 Edge 验收为准，不能由该说明直接推断。

## 回滚

1. 保留升级前的已验证 ZIP 和 `.sha256` 文件。
2. 优先在当前扩展目录恢复旧版本文件并点击“重新加载”，避免先“移除”扩展。自动化 Edge E2E 已覆盖同一临时用户配置下升级后重新加载旧发布包，书籍与阅读进度均保留；这不保证手动卸载后数据仍在。
3. 如果新版本的数据库迁移未完成，浏览器会原子保留旧 schema；如果已经升级且旧版本无法打开数据库，请加载新版本，导出书库备份后恢复到兼容版本。
4. 任何恢复操作均优先使用升级前生成的 `.quietreader` 备份，避免手工删除 IndexedDB。
