# 根目录稳定版发布、升级与回滚

本项目当前正式发布的是根目录稳定版，而不是 `.output/chrome-mv3`。发布前先在项目根目录运行：

```powershell
npm run check
npm test
npm run test:e2e
npm run release
```

`npm run release` 会创建以下文件（均在 `dist/`）：

- `quiet-reader-<version>.zip`：可分发的扩展包。
- `quiet-reader-<version>.sha256`：ZIP 的 SHA-256 校验和。
- `quiet-reader-<version>.json`：版本、文件清单和校验和。

ZIP 内文件顺序与条目时间戳固定；相同源码、依赖和版本连续执行会生成相同的 SHA-256。

发布包只包含根目录版运行所需的 `manifest.json`、`reader.html`、`styles/`、`src/`、Foliate.js 和 PDF.js 运行时资源；不会包含测试、WXT 输出或整个开发依赖目录。解压后选择包含 `manifest.json` 的目录，在 Edge 的 `edge://extensions` 中使用“加载解压缩的扩展”。

自动化 Edge E2E 会从 ZIP 解压并加载扩展，验证它与项目根目录稳定版使用同一个固定扩展 ID 且能打开书架首页。

## 升级

1. 升级前在书架首页选择“备份书库”，妥善保存 `.quietreader` 文件。
2. 在同一个 Edge 用户配置中，移除旧的“加载解压缩的扩展”条目，然后加载新版本解压目录。
3. 确认扩展 ID 与旧版相同；固定 manifest 公钥会保持该 ID，因此 IndexedDB 书库、进度和批注会继续可用。
4. 打开一册已读书籍，确认阅读位置和批注恢复；如异常，先不要清除浏览器数据。

## 回滚

1. 保留升级前的已验证 ZIP 和 `.sha256` 文件。
2. 在 `edge://extensions` 移除新加载的目录并加载旧版本解压目录；扩展 ID 保持相同，现有本地书库不会被删除。自动化 Edge E2E 已覆盖发布版升级后及重新加载旧发布包后，书籍与阅读进度均保留。
3. 如果新版本的数据库迁移未完成，浏览器会原子保留旧 schema；如果已经升级且旧版本无法打开数据库，请加载新版本，导出书库备份后恢复到兼容版本。
4. 任何恢复操作均优先使用升级前生成的 `.quietreader` 备份，避免手工删除 IndexedDB。
