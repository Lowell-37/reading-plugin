# Changelog

本项目的主要用户可见变更记录在此文件中。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

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
