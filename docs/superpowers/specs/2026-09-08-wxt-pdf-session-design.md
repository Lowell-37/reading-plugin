# WXT PDF 会话迁移设计

## 目标

在不改变根目录稳定入口、IndexedDB schema v2、书籍备份格式或 PDF 搜索/批注行为的前提下，让 WXT 的 Vue 3 + Pinia 接管 PDF 的打开、关闭、目录、文本层渲染、缩放、页码跳转、进度保存与重开恢复。

## 范围

本阶段仅迁移 WXT PDF 阅读会话。PDF 搜索、选区、高亮、批注编辑、批注导入导出、AI 与根目录阅读器继续由旧 `reader.js` 所有。WXT 的 EPUB、MOBI、AZW3 会话继续由现有 Foliate 端口所有。

## 架构

新增 `PdfSessionPort`，其命令边界与现有 `EbookSessionPort` 对齐：`open`、`close`、`goTo`、相对导航、缩放、刷新进度、应用设置和 `destroy`。其快照仅包含可序列化的投影数据：状态、标题、目录、当前页、总页数、缩放、进度和安全错误；不向 Pinia 或 Vue 暴露 PDF.js 文档、页面、画布、观察器或 AbortController。

`PdfSessionStore` 负责端口生命周期隔离、代次失效、错误状态和向通用 reader store 投影。`PdfJsSessionAdapter` 独占 PDF.js 文档加载、页面/文本层按需渲染、缩放重绘、IntersectionObserver、滚动位置、目录解析、资源释放以及 ProgressService 调用。异步打开、渲染或关闭必须使用 generation/epoch 隔离，快速连续打开后只能保留最新会话。

`LibraryStore` 依据已有的单一 `detectFormat()` 判定，把 PDF 路由至 `PdfSessionPort`，把 EPUB/MOBI/AZW3 保持路由至 `EbookSessionPort`。新旧会话切换时必须先安全关闭另一方，且同一次打开不得命令两个端口。

Vue 阅读区复用已有 PDF DOM ID（包括 `pdf-viewport`、`pdf-pages`、`pdf-page-input`、`pdf-page-total`、缩放控件与通用前后翻页控件），但在 WXT 的活跃 PDF 会话中由 Pinia 状态驱动其可见性与命令。旧控制器在 WXT 中保留 PDF 搜索与批注所需的监听器和 DOM 契约，但不得创建、销毁或控制 PDF.js 文档、页面渲染、缩放、目录、位置或进度。

## 数据与兼容性

- IndexedDB 数据库名、schema v2、`BookRecord.progress` 的 `{ kind: 'pdf', page, fraction }` 形状、BookRepository 和 ProgressService 均不变。
- 根目录入口继续拥有完整旧 PDF 阅读路径，不得移除 root 的任何 PDF 监听器或 DOM 节点。
- WXT 的 PDF 搜索与批注在本阶段继续经受限 legacy port 工作；新 PDF adapter 不导入搜索、批注、Repository 或 Vue 组件。
- PDF.js 只允许出现在 PDF adapter/依赖工厂中，不能直接进入 Pinia store 或 Vue 组件。
- 原始 PDF.js/浏览器异常只能进入诊断字段；用户界面按错误代码显示安全中文文案。

## 交互与错误处理

活跃 PDF 会话应显示标题、页码、页数、缩放和可访问的前后页命令；目录跳转、页码输入、缩放、进度滑块和键盘翻页都调用 session store。加载中、密码、损坏文件、渲染失败、取消和恢复失败应有可见错误态与返回书架/重试路径，且不得产生未处理 Promise 或页面错误。

缩放后必须重建当前页面及文本层；进度以当前页和 fraction 写入 ProgressService，关闭/备份前必须 flush。重开同一本 PDF 时恢复最后持久化的位置，而不是仅恢复初始页。

## 验收

1. 单元和组件测试覆盖端口代次、快速连续打开、PDF 与电子书路由互斥、缩放/跳页/目录/进度/错误投影、资源销毁和旧控制器所有权边界。
2. 真实 Microsoft Edge WXT 测试使用 PDF.js 示例 PDF，验证文本层、目录跳转、缩放、前后页、页码输入、进度保存、关闭重开、连续两本 PDF 打开只保留最新会话以及无页面错误。
3. 真实持久 Edge 配置验证根目录→WXT→根目录和反向方向的 PDF 进度连续性；既有 EPUB/MOBI/AZW3、根目录 25 项回归、PDF 搜索/批注行为不得回退。
4. 最终验证运行 `npm run check`、`npm test`、`npm run build:wxt:verify`、WXT 基线/连续性/PDF 会话 Edge、root E2E 和 `npm run release`，文档只记录最终提交的实际输出。

## 非目标

本阶段不迁移 PDF 搜索、批注、AI、OCR、扫描 PDF、根目录入口停用或商店发布资料。这些将按搜索与批注迁移阶段分别处理。
