# 渐进式架构迁移

扩展现由 WXT 构建，阅读界面由 Vue 3 组件组成，运行时界面状态进入 Pinia。Foliate.js、PDF.js、IndexedDB Repository 和阅读进度服务继续保持独立边界。

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

### 阶段 2：TypeScript 与 Vitest（已完成）

- 无 DOM 核心逻辑和共享领域类型已迁入 TypeScript
- 单元测试由 Vitest 执行

### 阶段 3：WXT 外壳（已完成）

- Manifest、后台和阅读页入口由 WXT 生成
- PDF.js 运行时资源随发布包生成
- IndexedDB 名称与对象仓库保持不变

### 阶段 4：Vue 3 + Pinia（已完成）

- 顶部栏、书架、目录、阅读区、设置面板、工具面板和浮层已拆为 Vue 单文件组件
- Pinia 保存标题、章节、进度、阅读状态和当前面板等运行时状态，不持久化图书与批注
- 兼容桥把现有阅读控制层状态同步到 Pinia，后续可逐项移除命令式 DOM 控制
- Vue 组件不导入 Foliate.js、PDF.js 或连续滚动引擎，阅读引擎仍通过 Adapter 边界挂载

### 阶段 5：端到端验证（下一阶段）

- Playwright 加载构建后的 Edge/Chromium 扩展
- 使用真实 EPUB、MOBI、AZW3、PDF 验证目录、翻页、恢复、AI 选区和章节提取

## AI 后续计划

- 整本书语义搜索与带出处问答
- 高亮与批注整理、知识卡片和复习
- 可选本地模型与向量索引
- OCR、朗读、人物关系和思维导图
- 云同步与多设备 AI 数据同步
