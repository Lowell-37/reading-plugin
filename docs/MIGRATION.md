# 渐进式架构迁移

既定的五个架构迁移阶段已经完成。扩展由 WXT 构建，界面使用 Vue 3 + Pinia，核心类型与测试使用 TypeScript + Vitest，真实扩展和书籍验证使用 Playwright。

## 当前技术栈

- WXT：Manifest、入口、开发服务器和 Edge/Chrome 构建
- Vue 3 + TypeScript：组件化阅读界面
- Pinia：阅读器运行时界面状态
- Foliate.js：EPUB、MOBI、AZW3 阅读引擎
- PDF.js：PDF 显示、文本层和页面导航
- IndexedDB：图书、进度与批注
- Vitest：核心模块与 Vue 组件测试
- Playwright：真实 Edge 扩展和真实书籍端到端测试

## 已完成阶段

### 阶段 1：建立模块边界

- AI、ReaderAdapter、ProgressService 和 BookRepository 已解耦

### 阶段 2：TypeScript 与 Vitest

- 无 DOM 核心逻辑和共享领域类型已迁入 TypeScript
- 核心与 UI 单元测试由 Vitest 执行

### 阶段 3：WXT 外壳

- Manifest、后台与阅读页由 WXT 构建
- PDF.js 运行资源进入发布包
- IndexedDB 名称 `quiet-reader` 与对象仓库 `books` 保持兼容

### 阶段 4：Vue 3 + Pinia

- 顶部栏、书架、目录、阅读区、设置、工具和浮层已组件化
- Pinia 只保存运行时 UI 状态，持久化仍由 Repository 负责
- Vue 组件不直接依赖 Foliate.js 或 PDF.js 内部实现

### 阶段 5：真实扩展端到端验证

- Playwright 在 Microsoft Edge 中加载 `.output/chrome-mv3`
- Project Gutenberg 的真实 EPUB、MOBI、AZW3 已验证目录、跳转和进度恢复
- Mozilla PDF.js 的真实 PDF 已验证文本层、缩放、页码跳转和进度恢复
- 真实 EPUB 已验证章节正文可提取、文字选区可传递到 AI 控件
- 测试书籍按需下载到忽略目录，并记录来源、大小与 SHA-256

## 后续产品阶段

- 整本书语义搜索与带出处问答
- 高亮与批注整理、导出、知识卡片和复习
- 可选本地模型与向量索引
- OCR、朗读、人物关系和思维导图
- 云同步与多设备数据同步
