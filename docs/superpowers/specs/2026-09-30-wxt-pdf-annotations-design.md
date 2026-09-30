# WXT PDF 批注迁移设计

## 目标

将 WXT 阅读页中的 PDF 批注从旧 `reader.js` 控制器迁移到 Vue 3 与 Pinia，同时保持根目录稳定入口、IndexedDB schema v2、BookRepository 记录和现有备份格式不变。迁移完成后，WXT 的 PDF 搜索和 PDF 批注都不再由旧控制器拥有；电子书批注继续沿用现有 legacy 路径。

成功标准：用户可以在 WXT 中选择 PDF 文本创建高亮或带备注批注，看到缩放/重渲染后恢复的覆盖层，使用列表筛选、编辑、删除、批量删除与跳转，并能继续使用既有导入导出格式。关闭、换书、跨格式打开和异步页面重渲染不能泄漏旧批注或覆盖层。

## 范围与非目标

本阶段包含：PDF 选择批注、页内覆盖层、批注列表和筛选、编辑、删除/批量删除、跳页、导入后的 PDF 锚点恢复、持久化和 PDF 相关的导出投影。

本阶段不改变：电子书批注渲染及其 CFI 恢复、根目录阅读器行为、数据库 schema、备份/导出文件格式、AI 产品入口或请求路由。AI 保持关闭，项目根目录仍是日常稳定加载入口。

## 方案

### 1. 受限 PDF 批注端口

`PdfSessionPort` 增加仅面向渲染 DOM 的批注能力：读取已渲染 `.textLayer`、获取已渲染 PDF 页容器、跳转页码，以及注册每次页面文本层完成或重渲染时的通知。端口绝不暴露 PDF.js 文档、页面、文本内容对象、渲染任务或缓存。

旧 `LegacyPdfAnnotationTools` 在 WXT 模式下逐步缩小至空适配层，最终移除；根目录模式继续使用原有逻辑。

### 2. Pinia 批注领域状态

新增 `PdfAnnotationStore`，作为 WXT PDF 批注的唯一运行时所有者。它保存当前记录 id、PDF generation、批注数组、筛选/排序、选中 id、加载/保存错误和渲染代次。

store 通过 BookRepository 更新 `annotations` 字段，并使用既有的纯 TypeScript 批注、锚点恢复、导入导出模块。它不保存 Blob 或 PDF.js 引擎对象。所有异步结果都必须以记录 id、generation 和请求代次校验；关闭、缩放、换书、错误态或跨格式切换会清除暂态选择、覆盖层和待处理请求。

### 3. PDF 选择与覆盖层

Vue 的阅读工作区监听 WXT PDF 文本层中的有效用户选区。创建批注时，store 从选择范围生成稳定的 PDF 文本锚点：页码、原始文本、标准化引文、偏移和必要的上下文。覆盖层矩形由当前 `.textLayer` Range 计算，并添加到与页面绑定的 `.pdf-annotation-layer`；缩放与 PDF.js 重渲染只重新计算矩形，绝不复用像素坐标。

低置信度或无法恢复的锚点被标为 `unresolved`，不绘制高亮，仍在列表中显示并保留数据。搜索标记与批注层严格隔离，任一方清理不得改动另一方的 DOM。

### 4. Vue 界面和兼容节点

Vue 接管 PDF 批注列表、计数、筛选、排序、全选、删除、编辑和跳转，并保留现有 DOM id/class 作为根目录和未迁移电子书路径的兼容契约。PDF 会话激活时，Vue 截获这些操作；电子书与根目录模式仍交给原控制器。

导入和导出继续复用现有 JSON/Markdown 格式和纯模块。WXT PDF 导入后由 store 在已渲染文本层中恢复锚点、刷新覆盖层并持久化恢复结果；电子书导入不改变所有权。

## 数据流

```text
PDF.js rendered text layer
  -> PdfSessionPort DOM-only surface
  -> PdfAnnotationStore (identity, anchors, persistence, recovery)
  -> Vue reader workspace (selection + overlay lifecycle)
  -> Vue tools panel (list/filter/edit/jump)
  -> BookRepository annotations field
```

页面重渲染通知沿相反方向触发：port 通知 store，store 基于当前 generation 和记录 id 读取该页文本层并重新投影覆盖层。已过期的通知不产生 DOM 或持久化写入。

## 错误与生命周期

- 选区不在单个已渲染 PDF 文本层内：不创建批注，显示安全提示。
- 文本层在计算期间移除：该页延后到下次渲染通知，不能产生未处理 rejection。
- BookRepository 写入失败：保留内存状态、显示安全错误并允许重试；不清除用户已创建的批注。
- 关闭、换书或跨格式打开：取消待处理恢复、移除当前 PDF 覆盖层、清空 PDF 批注 store 的暂态，不能覆盖新会话数据。
- 导入锚点恢复低置信度：保留为未解析，不绘制错误矩形。

## 测试与验收

遵循 TDD：先写失败的服务/store/组件测试，再实现。

- Vitest：端口只暴露 DOM；选择锚点、覆盖层隔离、重渲染恢复、请求取消、筛选/编辑/批量删除、导入恢复和持久化失败。
- 架构测试：WXT 的旧 reader 不执行 PDF 批注创建、覆盖层投影或列表更新；PDF.js 内部对象不穿过端口。
- Edge：真实 PDF 创建高亮与备注、缩放后覆盖层重建、关闭/重开、快速换书、列表筛选/编辑/删除/跳转、导入导出，以及根目录→WXT→根目录的数据连续性。

验收前必须通过完整 `npm test`、静态检查、WXT 构建契约、WXT 基线/连续性/会话 Edge 测试、根目录回归与发布包校验。
