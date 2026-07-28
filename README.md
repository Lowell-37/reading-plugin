# 静读

一个本地优先的 Edge / Chrome 阅读扩展。目前优先支持：

- PDF：基于 Mozilla PDF.js，按需渲染页面与可选择文本层，支持缩放、页码跳转、书签、搜索、高亮、批注和页码进度恢复。
- EPUB：目录、封面、分页/滚动、主题与排版、全文搜索、高亮与批注、CFI 阅读位置；滚动模式按需加载相邻章节，章节结尾和下一章开头可以同时显示在同一滚动视口中。
- MOBI / AZW3：目录、分页/滚动、主题与排版、搜索、高亮、批注和阅读位置；滚动模式支持跨章节连续文档流，不支持带 DRM 的 Kindle 文件。

书籍原文件、封面和阅读进度保存在浏览器的 IndexedDB 中，不会上传到服务器。

## 构建并加载

1. 安装依赖：`npm install`
2. 生成 Edge / Chrome 扩展：`npm run build`
3. 打开 Edge 的 `edge://extensions` 或 Chrome 的 `chrome://extensions`
4. 开启“开发人员模式”
5. 选择“加载解压缩的扩展”，指向 `.output/chrome-mv3`
6. 点击工具栏中的“静读”图标

开发时可运行 `npm run dev` 使用 WXT 热更新。旧版直接加载项目根目录的方式暂时保留兼容，但后续发布与测试均以 WXT 生成目录为准。扩展升级继续使用原来的 IndexedDB 数据库与对象仓库，不会主动清除已保存书籍和阅读进度。

The manifest pins a public key so moving the project or rebuilding `.output/chrome-mv3` keeps the same extension ID and browser storage origin. Development builds installed before this key was introduced use a different origin and cannot be read across extension IDs; those books must be imported once more.

## AI 阅读助手（初版）

当前支持：

- 划词 AI：解释、翻译、简化表达、分析术语和补充背景。
- 章节助手：章节摘要、核心观点、人物和事件、时间线、重要概念。
- EPUB、MOBI、AZW3 会读取当前 Foliate section；PDF 当前分析所在页及相邻页。
- 使用 OpenAI 兼容的 `/chat/completions` 接口，支持流式输出和停止生成。

首次使用时，在“搜索、AI与批注”面板中填写接口地址、模型名称和 API 密钥。扩展默认不会发送图书内容；只有点击某个 AI 功能时，才会请求对应接口权限并发送选中文字或当前章节。API 密钥保存在当前浏览器的扩展数据中，不会写入项目文件。公共或多人使用的设备不建议保存个人密钥。

总体产品与工程路线图见 [`docs/ROADMAP.md`](docs/ROADMAP.md)。
架构迁移细节见 [`docs/MIGRATION.md`](docs/MIGRATION.md)。
## 开发检查

```bash
npm run check
npm test
```

WXT 会生成可发布的 Manifest V3 扩展；日常加载与测试均使用 `.output/chrome-mv3`。兼容用的项目根目录入口暂时保留。

真实扩展端到端测试：

```bash
npm run test:e2e
```

该命令会构建扩展，下载 Project Gutenberg 的 EPUB/MOBI/AZW3 与 Mozilla PDF.js 的测试 PDF，然后使用本机 Microsoft Edge 验证目录、导航、进度恢复、PDF 文本层/缩放/跳页，以及 EPUB 文字选区与 AI 控件联动。测试书籍不会提交到 Git。

## 当前边界

- PDF 保持原版页面布局，不提供文字重排；扫描版 PDF 没有原生文本层，需要后续加入 OCR 才能搜索和选择。
- 高亮与批注保存在当前浏览器的本地数据库中，暂未提供跨设备同步或导出。
- DRM 加密的 EPUB、MOBI、AZW3 无法读取。
