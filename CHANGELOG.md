# Changelog

本项目的主要用户可见变更记录在此文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

### Added

- 增加可重复生成并自动校验的 Edge Add-ons / Chrome Web Store 小宣传图和大宣传图。
- 增加 WXT 构建身份、权限、CSP、图标与 PDF 运行资源契约，以及独立的 Microsoft Edge 四格式基线。
- 增加 WXT 启动前只读数据预检、结构化恢复界面，以及根目录版→WXT→根目录版的真实 Edge 数据连续性门禁。
- WXT 阅读页现由 Vue 3 + Pinia 接管书架、文件选择与拖放、删除、备份恢复、设置、面板和运行时界面状态；BookRepository、schema v2 与既有备份格式仍是唯一持久化事实来源。
- WXT 的 EPUB、MOBI、AZW3 阅读会话现由 Vue/Pinia 和 Foliate 会话端口接管；真实 Edge 验收覆盖目录跳转、前后导航、分页/滚动切换、进度保存与恢复及快速连续打开。
- 增加 WXT PDF 会话的真实 Edge 验收：PDF.js 文本层、页码/目录/前后导航、60%–250% 实际 canvas 缩放、进度恢复、安全错误和快速连续打开均纳入门禁；根目录→WXT→根目录继续验证 PDF 页码与既有电子书数据不变。

### Fixed

- 补齐 WXT Vue 外壳中旧阅读控制器依赖的加载与批注工具节点，修复 EPUB、MOBI、AZW3 和 PDF 初始化空引用。
- 统一商店宣传图源码指纹的文本换行符，避免新 Windows 工作区出现校验误报。
- 非法阅读设置现在只在内存中回退默认值，并继续保留未知设置字段，不会在架构迁移期间改写原数据。
- 修复根目录 EPUB 在旧 CFI 修复与 Foliate 覆盖层创建竞争时偶发丢失高亮的问题。
- 修复 Foliate 分页器在已释放章节文档上继续计算可见范围时偶发的 Edge `createTreeWalker` 页面错误。
- 修复 WXT 电子书会话错误态：加载页只显示按错误代码映射的安全文案，不再把 Foliate/引擎原始异常展示给用户，并由 Vue 接管返回书架与重新选择文件动作。
- 修复 WXT 活跃电子书会话的阅读设置同步，主题、字体、字号、行距、栏宽和分页/滚动会一次性传递到 `EbookSessionStore` 与 Foliate 适配器，避免旧的单独 flow watcher 造成重复路径。
- 加强 WXT 电子书真实 Edge 验收，内容断言现在读取 Foliate 实际渲染文档，而不是读取包含标题栏的整页文本。
- 加强 WXT PDF 会话回归：缩放验收读取实际 PDF canvas 尺寸，避免仅由标签文本误判通过。
- 修复 WXT PDF 直接滚动时页码和进度不更新的问题；关闭、备份和继续翻页前会结算最新可见页，重开恢复滚动后的页码。
- 修复 PDF 与电子书在加载中交替打开、关闭或替换时的会话竞争，旧请求不能覆盖新会话；补齐全局 IndexedDB 属性访问的架构守卫。

## [0.2.0] - 2026-08-26

### Added

- 支持本地 PDF、EPUB、MOBI 和 AZW3 文件的书架管理、目录导航与阅读进度恢复。
- 支持 EPUB、MOBI、AZW3 的分页及跨章节连续滚动，以及 PDF 文本层、缩放和页码跳转。
- 支持全文搜索、高亮、批注编辑、标签筛选，以及 Markdown、版本化 JSON 导入导出。
- 支持包含书籍、阅读进度、高亮、批注和非敏感设置的版本化书库备份与恢复。

### Changed

- 根目录 Manifest V3 扩展作为当前稳定入口；WXT/Vue 迁移代码保留，但暂不作为日常使用版本。
- AI 阅读助手代码继续保留，当前产品界面及请求路由默认关闭。

### Fixed

- 修复 EPUB 正文空白、异常语言标签及 Foliate 分页器空节点错误。
- 修复滚动模式在章节末尾突兀翻页、空白区域滚轮失效和长书章节窗口滞留问题。
- 修复 PDF 隐藏容器初始化导致页面无法加载的问题。
- 提升批注在排版变化、缩放和内容小幅更新后的定位稳定性；低置信度恢复不再绘制错误高亮。

### Security

- 书籍、批注和阅读进度默认仅保存在浏览器本地；备份恢复会校验格式版本、数据库 schema 和文件 SHA-256。

[Unreleased]: https://github.com/Lowell-37/reading-plugin/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Lowell-37/reading-plugin/releases/tag/v0.2.0
