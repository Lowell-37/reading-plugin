# 渐进式架构迁移

本文档记录架构迁移的代码实现情况。阶段 1、2、阶段 A–D、PDF 会话、PDF 搜索及 PDF 批注真实 Edge 验收已完成；WXT 构建版已通过真实 Edge 四格式、双向数据、Vue 书架、电子书会话、PDF 会话、搜索与批注验收。根目录仍是日常稳定入口，直到完整迁移完成。

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

### 阶段 4：Vue 3 + Pinia（🟡 阶段 C 已完成，完整接管未完成）

- 顶部栏、书架、目录、阅读区、设置、工具和浮层已组件化
- Pinia 接管 WXT 的书架投影、文件选择/拖放、删除、备份恢复、设置、面板、顶部栏和运行时界面状态
- Pinia 只保存运行时 UI 状态与 Repository 投影；持久化仍由 Repository 负责，IndexedDB schema v2 和既有备份格式未改变
- Vue 组件不直接依赖 Foliate.js 或 PDF.js 内部实现
- Vue 模板已补齐旧控制器依赖的加载、筛选、导入导出节点，四种格式不再因空引用停止初始化
- WXT 已迁移控件不再由旧控制器注册重复监听器；`legacy-bridge.ts` 只通过结构化回调和端口投射运行时状态
- Vue/TypeScript 已负责 EPUB/MOBI/AZW3 会话以及 PDF 搜索和批注；旧 `reader.js` 不再拥有 WXT PDF 批注桥接，电子书批注与根目录行为保持兼容

### 阶段 5：真实扩展端到端验证（✅ 阶段 A、B、C、D 与 PDF 搜索自动化门禁完成）

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

## 阶段 C 验收记录（2026-08-31）

- `npm run check`：通过，包含变更日志、核心构建、TypeScript、Vue TypeScript 和 JavaScript 语法检查。
- `npm test`：36 个测试文件、185 项测试通过。
- `npm run build:wxt:verify`：通过，WXT 构建身份与运行资源契约确认 223 个文件；唯一已知构建提示是既有的压缩后大于 500 kB chunk 警告。
- `npm run test:e2e:wxt:baseline`：6 项真实 Edge 基线通过，覆盖同扩展 ID、EPUB、MOBI、AZW3、PDF 以及 EPUB 设置/进度恢复。
- `npm run test:e2e:wxt:continuity`：2 项真实 Edge 数据连续性与损坏 schema 只读门禁通过。
- `tests/e2e/wxt-vue-shell.spec.ts`：1 项真实 Edge Vue 书架验收通过，覆盖导入、重新打开、删除、备份恢复、进度和批注。
- `npm run test:e2e`：25 项根目录稳定入口 Edge 回归通过，包含发布 ZIP、升级和回滚；旧 CFI 修复与覆盖层创建的竞态已由独立协调器和回归测试固定。
- `npm run release`：通过；`quiet-reader-0.2.0.zip` 含 303 个文件，SHA-256 为 `a4beb7bdb1879d026cf697ed18e10ce112d801a0fcb25261fdde7014ead9dc9e`，包内 Manifest 保留固定扩展身份。
- AI 产品入口和请求路由继续关闭。

## 阶段 D 电子书会话验收记录（2026-09-02）

- `npm run check`：通过。
- `npm test`：38 个测试文件、234 项测试通过。
- `npm run build:wxt:verify`：通过，WXT 构建身份与运行资源契约确认 223 个文件。
- `npm run test:e2e:wxt:baseline`：6 项真实 Edge WXT 基线通过，保留 PDF 的旧会话行为。
- `npm run test:e2e:wxt:continuity`：2 项真实 Edge 根目录→WXT→根目录数据连续性/故障只读门禁通过；WXT 写入的电子书进度由根目录稳定入口读取，反向方向亦已覆盖。
- `tests/e2e/wxt-ebook-session.spec.ts`：4 项真实 Edge EPUB、MOBI、AZW3 和快速连续打开会话验收通过；每种格式覆盖目录、导航、流模式切换、持久进度和重开恢复，且无页面错误。
- `npm run test:e2e`：25 项根目录稳定入口 Edge 回归通过。
- `npm run release`：通过；`quiet-reader-0.2.0.zip` 含 303 个文件，SHA-256 为 `bf865c248b2d782fd48dd234fabc72f53193e0fb93dd1cd10837df446c2ccaa2`。
- Foliate 分页器已防御章节释放后的异步可见范围计算；此前该竞争会在 EPUB 重开时偶发 `createTreeWalker` 页面错误。
- PDF、搜索和批注仍保持根目录/旧控制器所有；WXT 不是稳定入口，直到后续阶段完成这些领域迁移。

## 阶段 D 最终复核记录（2026-09-08）

- `npm run check`：通过。
- `npm test`：38 个测试文件、245 项测试通过。
- `npm run build:wxt:verify`：通过，WXT 构建身份与运行资源契约确认 223 个文件。
- `npm run test:e2e:wxt:baseline`：通过 6 项真实 Edge WXT 基线；复核中先发现目录面板遮挡 `#home-button` 的测试路径超时，已改为关闭遮罩后再返回书架。
- `npm run test:e2e:wxt:continuity`：通过 2 项真实 Edge 根目录/WXT 数据连续性和损坏 schema 只读门禁。
- `tests/e2e/wxt-ebook-session.spec.ts`：通过 4 项真实 Edge 会话验收；内容断言读取 Foliate 实际渲染文档，避免由标题栏文本误判通过。
- `npm run test:e2e`：通过 25 项根目录稳定入口 Edge 回归。
- `npm run release`：通过；`quiet-reader-0.2.0.zip` 含 303 个文件，SHA-256 为 `420ca89623a33e2ae627b1aa0a5c8caa10eb7c52909c2c399d956742b70b1214`。
- 最终 head 进度复核：真实 Edge 已确认 Foliate 连续滚动的每个 relocate 均成功进入 `ProgressService`；滚动进行时会持续重置其 350 ms 防抖，关闭会话时再由 `flush()` 持久化最后位置。WXT 基线现在在关闭并完成该 flush 后读取 IndexedDB，再与重开位置比较，避免把先前的非零位置误当作最终保存位置。
- 活跃 WXT 电子书会话现在通过设置 store 一次性向 legacy port 和 `EbookSessionStore` / Foliate 适配器传播主题、字体、字号、行距、栏宽和 flow；`ReaderWorkspace` 不再用单独 flow watcher 反向同步，避免重复路径。
- Foliate/引擎原始异常仅保留为诊断字段；用户界面只显示按 `format`、`parse`、`restore`、`render` 代码映射的安全标题和详情。flow 切换失败由设置更新边界吸收 rejected promise，并投射为电子书错误态，不产生未处理 rejection。
- PDF、搜索和批注仍保持根目录/旧控制器所有；WXT 不是稳定入口，直到后续阶段完成这些领域迁移。

## WXT PDF 会话验收记录（最终修复复验：2026-09-23）

- `npm run check`：通过。
- `npm test`：40 个测试文件、313 项测试通过。
- `npm run build:wxt:verify`：通过，WXT 构建身份与运行资源契约确认 223 个文件。
- `npm run test:e2e:wxt:baseline`：通过 6 项真实 Edge WXT 基线。
- `npm run test:e2e:wxt:continuity`：通过 3 项真实 Edge 数据门禁；PDF 在根目录第 4 页打开后由 WXT 更新至第 9 页，回滚根目录版可渲染第 9 页，schema v2、Blob SHA-256、电子书进度和批注保持不变。
- `tests/e2e/wxt-pdf-session.spec.ts`：通过 5 项真实 Edge PDF 会话验收，覆盖 PDF.js 文本层、直接滚动后的页码/进度及关闭重开、页码跳转、目录、前后导航、进度滑块、60%/100%/130%/250% 实际 canvas 缩放、安全的损坏/密码错误以及快速连续打开。
- `tests/e2e/wxt-ebook-session.spec.ts`：通过 4 项真实 Edge 电子书会话验收。
- `npm run test:e2e`：通过 25 项根目录稳定入口 Edge 回归。
- `npm run release`：通过；`quiet-reader-0.2.0.zip` 含 303 个文件，SHA-256 为 `e41ff40296657fef521492168b432c9ad7ebf2a4db992760a35e76f58baa6834`。
- PDF 搜索和批注在该次验收时仍由根目录/旧控制器所有；后续 PDF 搜索验收记录见下节。
- 最终修复代码至 `c6e0257`：PDF adapter 用视口顶部下方最多 100px 的阅读线结算当前页，滚动监听器和帧回调按 generation 隔离；程序跳页不产生反馈回跳。LibraryStore 在持久化等待之前分配请求代次，以加载中端口为所有者，排空关闭队列后再打开最新会话。已空闲 store 的再次清理不覆盖另一格式的共享阅读投影。
- 架构守卫已用 AST 覆盖直接 `indexedDB`、`window.indexedDB` 和 `globalThis.indexedDB`，并验证普通对象属性、字符串及 Vue 模板文本不会误报。schema v2、AI 关闭状态、CSP、根目录和 PDF 搜索/批注所有权均未改变。

## WXT PDF 搜索验收记录（2026-09-24）

- Vue/Pinia 负责 WXT PDF 查询状态、取消、结果、结果跳页和会话同步；搜索服务只读取已经渲染的 PDF.js 文本层，不暴露 PDF.js 文档、页面或渲染任务。
- 旧控制器在 WXT PDF 模式下不再执行搜索或刷新搜索标记，只通过 `LegacyPdfAnnotationTools` 保留页数、文本层读取和跳页能力供批注恢复使用；EPUB/MOBI/AZW3 搜索与根目录 PDF 搜索行为保持不变。
- 真实 Edge 场景覆盖句子上下文、跨 span 单词、快速查询取消、结果跳页、130% 缩放清理、关闭重开和换书隔离，且搜索标记不改变 PDF 批注层。
- IndexedDB schema v2、BookRepository、进度、批注和备份格式均未改变；AI 产品入口和请求路由继续关闭，项目根目录继续作为稳定加载入口。
- `npm run check`：通过；`npm test`：42 个测试文件、332 项测试通过；`npm run build:wxt:verify`：通过，WXT 构建身份与运行资源契约确认 223 个文件。
- `npm run test:e2e:wxt:baseline`：同一构建重跑后 6 项真实 Edge WXT 基线通过；`npm run test:e2e:wxt:continuity`：3 项数据连续性与故障只读门禁通过。
- `tests/e2e/wxt-pdf-session.spec.ts` 与 `tests/e2e/wxt-ebook-session.spec.ts`：共 10 项真实 Edge 会话验收通过，其中 6 项 PDF、4 项电子书；`npm run test:e2e`：25 项根目录稳定入口回归通过。
- `npm run release`：通过；`quiet-reader-0.2.0.zip` 含 303 个文件，SHA-256 为 `ede16a54b6c5fd2842651c911dfe1828a60ad370a6c62055800ed84baae68655`。

以上为 2026-09-24 搜索阶段的历史记录；随后 PDF 批注已接管。文件选择标签的显式键盘激活仍是非阻断的后续可访问性工作。在后续阶段完成前，用户仍应加载项目根目录。

## WXT PDF 批注验收记录（2026-09-30）

- Vue/Pinia 接管 WXT PDF 批注状态和持久化；文字层选区生成文本锚点，批注覆盖层从当前渲染页的文字层重新计算，缩放和重渲染不沿用旧像素坐标。JSON/Markdown 导出与 JSON 导入沿用旧格式，导入锚点在已渲染相邻页中恢复；模糊或缺少文本层时保留未解析状态。
- PDF 批注写入串行化且保留混合记录中非 PDF 批注；保存失败显示重试入口，同一运行会话内重新打开书籍会恢复未保存草稿。旧工具监听器在 WXT PDF 控件上被 Vue 截获。
- 旧 WXT PDF 批注桥接已移除；根目录稳定版与电子书批注仍保持原有路径，IndexedDB schema v2 和备份格式不变，AI 路由继续关闭。
- `npm run check`、`npm run build:wxt:verify`、`npm run release` 均通过；`npm test` 为 45 个测试文件、359 项通过、无跳过项。已删除两条依赖已移除 PDF 旧端口的历史断言；其产品行为由当前 PDF 会话、批注 store 和 Vue 工具面板测试覆盖。根目录与 WXT 共享样式对语义按钮、显式可聚焦元素及 Windows 强制高对比度模式均保留键盘焦点指示；PDF 高分屏画布维持 CSS 尺寸与最多两倍 backing scale 的分离。
- 真实 Edge：WXT 四格式基线 6 项、双向数据连续性 3 项、PDF/电子书会话 11 项、根目录稳定版回归 25 项通过；PDF 会话覆盖创建、编辑标签与备注、筛选、批量删除、导出、导入、缩放和重开。数据连续性场景验证根目录 PDF 批注在 WXT 可见、WXT 新批注回滚根目录后仍可见，电子书数据不变。
- Project Gutenberg 水滸傳 EPUB 上游于 2026-09-10 重新生成，测试夹具的 SHA-256 更新为 `17ec3d9f4b06c00ad3dfd31638e3e05e6a9425d10a5f116199d18f958b2e7b27`；书名、作者、语言及公版许可已复核。
- `quiet-reader-0.2.0.zip` 含 303 个文件，SHA-256 为 `b1406bd026629845d22e8bb93103828bd4482d07852e555aa2d38a46adf962b5`。完整迁移前仍请加载项目根目录。

## 后续产品阶段

- 整本书语义搜索与带出处问答
- 高亮与批注整理、导出、知识卡片和复习
- 可选本地模型与向量索引
- OCR、朗读、人物关系和思维导图
- 云同步与多设备数据同步
