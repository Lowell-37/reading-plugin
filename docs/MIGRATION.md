# 渐进式架构迁移

本文档记录架构迁移的代码实现情况。阶段 1、2、阶段 A“双入口等价基线”和阶段 B“同 ID 数据连续性门禁”已完成；WXT 构建版已通过自动化真实 Edge 四格式与双向数据验收，但在 Vue 接管主要领域前仍不作为日常稳定入口。

当前稳定版本仍是在 Edge 中直接加载项目根目录的原生 JavaScript 阅读器。总体进度、产品阶段与最终验收标准统一以 [ROADMAP.md](ROADMAP.md) 为准。

## 当前技术栈

- WXT：Manifest、入口、开发服务器和 Edge/Chrome 构建
- Vue 3 + TypeScript：组件化阅读界面
- Pinia：阅读器运行时界面状态
- Foliate.js：EPUB、MOBI、AZW3 阅读引擎
- PDF.js：PDF 显示、文本层和页面导航
- IndexedDB：图书、进度与批注
- Vitest：核心模块与 Vue 组件测试
- Playwright：真实 Edge 扩展和真实书籍端到端测试

## 阶段实现状态

### 阶段 1：建立模块边界（✅ 已完成）

- AI、ReaderAdapter、ProgressService 和 BookRepository 已解耦

### 阶段 2：TypeScript 与 Vitest（✅ 已完成）

- 无 DOM 核心逻辑和共享领域类型已迁入 TypeScript
- 核心与 UI 单元测试由 Vitest 执行

### 阶段 3：WXT 外壳（✅ 双入口基线已完成）

- Manifest、后台与阅读页由 WXT 构建
- PDF.js 运行资源进入发布包
- IndexedDB 名称 `quiet-reader` 与对象仓库 `books` 保持兼容
- 构建契约自动校验固定扩展密钥、名称、版本、权限、CSP、图标和 PDF 运行资源
- 当前 WXT Chrome MV3 构建通过契约校验，共包含 223 个文件

### 阶段 4：Vue 3 + Pinia（🟡 外壳基线通过，完整接管未完成）

- 顶部栏、书架、目录、阅读区、设置、工具和浮层已组件化
- Pinia 只保存运行时 UI 状态，持久化仍由 Repository 负责
- Vue 组件不直接依赖 Foliate.js 或 PDF.js 内部实现
- Vue 模板已补齐旧控制器依赖的加载、筛选、导入导出节点，四种格式不再因空引用停止初始化
- 旧 `reader.js` 仍负责阅读会话，后续阶段将按领域逐块由 Vue/TypeScript 接管

### 阶段 5：真实扩展端到端验证（✅ 阶段 A、B 自动化门禁完成）

- Playwright 在 Microsoft Edge 中加载 `.output/chrome-mv3`
- 根目录与 WXT 构建已验证产生相同扩展 ID
- Project Gutenberg 的真实 EPUB、MOBI、AZW3 已验证标题、目录、跳转和进度变化
- Mozilla PDF.js 的真实 PDF 已验证文本层、缩放和页码跳转
- AI 实现继续保留，但 WXT 基线确认产品入口保持隐藏
- 测试书籍按需下载到忽略目录，并记录来源、大小与 SHA-256
- WXT 启动前只读检查数据库版本、`books` / `meta`、schema 元数据、书籍 Blob、进度、批注与设置，不执行升级或批量写回
- 同一持久 Edge 用户目录已依次加载根目录发布内容、WXT 构建内容和回滚后的根目录内容
- 数据链路明确校验相同扩展 ID、书籍 Blob SHA-256、schema v2、设置、阅读进度、高亮与批注
- 预检失败会阻止旧控制器启动并显示诊断、备份恢复说明和重新检查入口；损坏 schema 与原书籍记录保持原样

## 阶段 A 验收记录（2026-08-27）

- `npm run check`：通过
- `npm test`：29 个测试文件、136 项测试通过
- `npm run build:wxt:verify`：通过，223 个构建文件
- `npm run test:e2e`：25 项根目录稳定版 Microsoft Edge 测试通过
- `npm run test:e2e:wxt:baseline`：5 项 WXT Microsoft Edge 测试通过
- `npm run release`：通过，稳定发布 ZIP 包含 299 个文件

## 阶段 B 验收记录（2026-08-27）

- `npm run check`：通过
- `npm test`：31 个测试文件、150 项测试通过
- `npm run test:e2e:wxt:continuity`：2 项真实 Edge 数据连续性与故障只读门禁通过
- `npm run test:e2e`：25 项根目录稳定版 Microsoft Edge 测试通过
- `npm run release`：通过，稳定发布 ZIP 包含 301 个文件
- 根目录→WXT→根目录的 Blob、设置、进度、批注和 schema v2 均保持兼容
- WXT 对进度、主题和批注的修改可由回滚后的根目录版继续读取
- 预检损坏 schema 后确认数据库版本、schema 记录和书籍记录没有被自动改写

下一阶段是阶段 C“Vue 接管书架、面板与设置”。在阶段 C、D、E 完成前，用户仍应加载项目根目录。

## 后续产品阶段

- 整本书语义搜索与带出处问答
- 高亮与批注整理、导出、知识卡片和复习
- 可选本地模型与向量索引
- OCR、朗读、人物关系和思维导图
- 云同步与多设备数据同步
