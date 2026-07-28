# 渐进式架构迁移

当前扩展继续保持“加载解压缩目录即可运行”，避免在阅读稳定性尚未完成前一次性重写。新功能必须先通过独立模块与 `reader.js` 解耦，再迁入 WXT/Vue。

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

- AI Provider、提示词与请求流位于独立模块
- 阅读引擎导航通过统一 `ReaderAdapter` 接口接入
- 阅读进度的规范化、节流和落盘由 `ProgressService` 管理
- IndexedDB 图书操作由 `BookRepository` 封装，数据库名称、对象仓库和记录结构保持兼容

### 阶段 2：TypeScript 与 Vitest（已完成）

- `formats`、`annotations`、`ai`、电子书位置恢复已迁入 `src/core/*.ts`
- `src/core/types.ts` 定义图书、位置、目录、批注和 AI 请求共享类型
- TypeScript 严格类型检查与浏览器兼容产物构建已加入 `npm run check`
- 原有 33 项 Node 测试全部由 Vitest 执行，并直接测试 TypeScript 核心源码

### 阶段 3：WXT 外壳（下一阶段）

- 建立 `entrypoints/background.ts` 与 `entrypoints/reader/`
- 由 WXT 生成 Manifest V3 和发布包
- 保留 IndexedDB 名称和对象仓库，确保升级不丢书

### 阶段 4：Vue 3 + Pinia

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
