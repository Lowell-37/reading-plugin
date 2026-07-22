# 静读

一个本地优先的 Edge / Chrome 阅读扩展。目前优先支持：

- PDF：基于 Mozilla PDF.js，按需渲染页面、读取 PDF 书签、保存页码进度。
- EPUB：目录、封面、分页/滚动、主题与排版、CFI 阅读位置。
- MOBI / AZW3：目录、分页、主题与排版、阅读位置；不支持带 DRM 的 Kindle 文件。

书籍原文件、封面和阅读进度保存在浏览器的 IndexedDB 中，不会上传到服务器。

## 本地加载

1. 安装依赖：`npm install`
2. 打开 Edge 的 `edge://extensions` 或 Chrome 的 `chrome://extensions`
3. 开启“开发人员模式”
4. 选择“加载解压缩的扩展”，指向本项目目录
5. 点击工具栏中的“静读”图标

## 开发检查

```bash
npm run check
npm test
```

项目不需要打包构建，浏览器会直接加载原生 ES Modules。依赖必须保留在 `node_modules` 中，因此首次安装后再加载扩展。

## 当前边界

- PDF 暂时是原貌阅读，尚未实现文字重排、选择高亮和批注。
- EPUB/MOBI 尚未实现用户高亮和全文搜索。
- DRM 加密的 EPUB、MOBI、AZW3 无法读取。
