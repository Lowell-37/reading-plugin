# 渐进式架构迁移

当前扩展已经由 WXT 生成发布包，旧版项目根目录加载方式仅作为过渡兼容。核心阅读能力继续通过独立模块演进，再逐步迁入 Vue。

## 目标技术栈

- WXT：Manifest、入口、开发服务器和多浏览器构建
- Vue 3 + TypeScript：组件化阅读界面
- Pinia：阅读器、书架、设置和 AI 会话状态
- Foliate.js：EPUB、MOBI、AZW3 阅读引擎
- PDF.js：PDF 显示、文本层和页面导航
- IndexedDB：图书、进度、批注和未来的 AI 索引
- Vitest：纯模块与组件测试
- Playwright：真实浏览器、真实图书和扩展端到端测试

## 迁移阶段

### 阶段 1：建立模块边界（已完成）

- AI、阅读引擎导航、进度和图书持久化均有独立模块边界
- IndexedDB 数据库名称、对象仓库和记录结构保持兼容

### 阶段 2：TypeScript 与 Vitest（已完成）

- 无 DOM 核心逻辑已迁入 TypeScript
- 已建立图书、位置、目录、批注和 AI 请求共享类型
- 现有单元测试均由 Vitest 执行

### 阶段 3：WXT 外壳（已完成）

- `entrypoints/background.ts` 与 `entrypoints/reader/` 已接管扩展入口
- Manifest V3、Edge/Chrome 构建包和压缩包由 WXT 生成
- PDF.js worker、CMap、标准字体与 WASM 资源在构建前同步到发布目录
- 发布包仍使用 `quiet-reader` IndexedDB 与 `books` 对象仓库，升级不迁移、不清空本地书籍

### 阶段 4：Vue 3 + Pinia（下一阶段）

- 按顶部栏、工具面板、设置面板、目录、书架顺序迁移
- 阅读引擎通过 Adapter 接口挂载，不在 Vue 组件中直接操作内部实现
- Pinia 只保存运行时状态，图书与批注仍由 Repository 持久化

### 阶段 5：端到端验证

- Playwright 加载构建后的 Edge/Chromium 扩展
- 使用真实 EPUB、MOBI、AZW3、PDF 验证目录、翻页、恢复、AI 选区和章节提取

## AI 后续计划

- 整本书语义搜索与带出处问答
- 高亮与批注整理、知识卡片和复习
- 可选本地模型与向量索引
- OCR、朗读、人物关系和思维导图
- 云同步与多设备 AI 数据同步
