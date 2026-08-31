# WXT 电子书会话接管设计

## 目标

在不改变根目录稳定入口、IndexedDB schema v2、书库备份格式或 AI 暂停状态的前提下，让 WXT 的 Vue 3 / Pinia 接管 EPUB、MOBI、AZW3 阅读会话的状态与命令；Foliate.js 继续作为渲染引擎。

## 范围

本阶段只迁移电子书会话：打开、关闭、目录、章节跳转、上一页/下一页、分页与连续滚动切换、设置应用、进度投影和恢复。PDF 会话、搜索、批注编辑/恢复、AI 和根目录入口不迁移。

## 架构

新增 TypeScript `EbookSessionPort`，由 WXT 通过一个可注入的 `FoliateEbookSessionAdapter` 实现。适配器拥有一个 `foliate-view` 与可选的 `ContinuousEbookScroller`，并通过结构化回调发送会话快照：标题、目录、当前位置、章节标签、进度、流式模式与加载/错误状态。

Pinia `ebookSession` store 是 WXT 会话的唯一 UI 状态来源。它调用端口命令并消费回调，但不保存书籍 Blob、进度或批注；持久化仍经现有 Repository / ProgressService。Vue 组件只读取 store 并发送 store action，不直接导入 Foliate.js、旧 `reader.js`、IndexedDB 或连续滚动实现。

`LegacyReaderPort` 在 WXT 中继续承担 PDF、搜索、批注和未迁移工具。打开 EPUB/MOBI/AZW3 时，library store 调用 `EbookSessionPort`；打开 PDF 时仍调用 legacy port。根目录自启动控制器不引用新会话适配器，保证稳定入口行为不变。

## 会话生命周期

1. library store 保存或读取 `BookRecord`，根据格式选择 ebook session 或 legacy PDF 路径。
2. ebook session 关闭旧会话并 flush 旧进度，创建 `foliate-view`，应用已归一化阅读设置。
3. 引擎打开后适配器发出 metadata/TOC/loading 快照，恢复已保存位置，随后发出 ready 快照。
4. relocate 事件更新章节与进度；进度写入仍使用现有 ProgressService，store 只投影结果。
5. 流式/分页切换保持当前定位，连续滚动销毁时恢复 `foliate-view` 位置。
6. 关闭或打开 PDF 前，ebook session 取消事件、销毁 scroller/view、flush 进度并清空 Pinia 会话状态。

## 错误与并发

- 每次 open 使用递增会话 generation；过期 open、relocate 或恢复回调不得写入当前 store 或进度。
- 适配器将可展示错误分类为格式、解析、定位恢复和渲染错误；原始异常不进入 UI。
- 关闭应幂等；连续滚动挂载失败必须恢复分页视图且不留下事件监听器。
- 迁移会话不得改变 EPUB 批注恢复协调器的所有权；旧控制器在 WXT ebook 模式不绑定其电子书导航与进度监听，避免双写。

## 验收

- WXT 真实 Edge 中 EPUB、MOBI、AZW3 均能打开、显示目录、跳转、上一页/下一页、切换分页/连续模式并恢复进度。
- 同一用户目录中，WXT ebook 进度可由根目录稳定版继续读取；根目录更新的进度也可由 WXT 恢复。
- WXT ebook 会话不依赖 `src/reader.js` 的全局 `ebookView` 或 DOM 查询；组件不直接导入引擎/存储内部实现。
- PDF、搜索、批注、根目录入口、schema v2、备份格式和 AI 禁用回归通过。
- 任何关闭、快速连点打开或格式切换都不会遗留旧会话回调、错误进度或重复监听器。

## 非目标与后续

阶段 E 将迁移 PDF 会话，再迁移搜索与批注；完成体验与数据完全等价后才考虑停用根目录入口和 legacy bridge。
