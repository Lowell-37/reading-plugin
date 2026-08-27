# WXT 双入口等价基线实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立可重复构建、可验证、可在真实 Edge 中加载的 WXT 版本，并证明它与根目录稳定版拥有相同扩展身份且能打开四种现有格式。

**Architecture:** 本阶段不迁移旧阅读控制器，只建立双入口契约和验收基础。WXT 仍通过 Vue 外壳加载旧 `reader.js`，但构建后的 Manifest、扩展 ID、运行资源和真实文件行为必须被自动验证，为后续数据连续性与逐块接管提供稳定基线。

**Tech Stack:** WXT 0.21、Vue 3、TypeScript、Manifest V3、Vitest、Playwright、Microsoft Edge、Foliate.js、PDF.js

**Spec:** `docs/superpowers/specs/2026-08-27-wxt-vue-migration-design.md`

## Global Constraints

- 根目录 `D:\projects\reading-plugin` 在本阶段继续作为稳定入口，不删除或改写其运行文件。
- WXT 与根目录 Manifest 必须保留完全相同的固定 `key`、名称、版本、权限和 AI 关闭状态。
- IndexedDB schema 保持 v2，本阶段不写迁移、不批量重写书籍记录。
- AI 界面和请求路由保持关闭。
- `.output/chrome-mv3` 是本阶段的测试目标，不替代根目录稳定版。
- 所有新行为先写失败测试并观察预期失败，再实现最小改动。
- 阶段结束必须通过静态检查、全部 Vitest、根目录 E2E、WXT 基线 E2E、发布包校验和独立代码审查。

## File Structure

- `scripts/wxt-build-contract.mjs`：纯函数校验根目录 Manifest 与 WXT 构建 Manifest、资源文件集合的等价契约。
- `scripts/verify-wxt-build.mjs`：读取 `.output/chrome-mv3` 并执行构建契约校验的命令行入口。
- `tests/wxt-build-contract.test.js`：覆盖 Manifest 身份、权限、CSP、图标与 PDF 运行资源缺失场景。
- `tests/e2e/helpers/extension-launch.ts`：以明确路径启动持久或临时 Edge 扩展上下文，并返回扩展 ID 和阅读页。
- `tests/e2e/wxt-baseline.spec.ts`：加载 WXT 构建，验证 EPUB、MOBI、AZW3、PDF 的打开与基础导航。
- `wxt.config.ts`：补齐与根目录 Manifest 一致的图标和构建配置。
- `scripts/sync-public-assets.mjs`：只在实际构建缺失时补充 WXT 所需的 PDF/Foliate 静态资源。
- `package.json`：增加 WXT 构建验证和基线 E2E 命令。
- `docs/MIGRATION.md`、`docs/ROADMAP.md`：记录阶段 A 的真实验收结果，不提前宣称 WXT 已成为稳定入口。

---

### Task 1: WXT 构建契约校验器

**Files:**
- Create: `scripts/wxt-build-contract.mjs`
- Create: `scripts/verify-wxt-build.mjs`
- Create: `tests/wxt-build-contract.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: 根目录 `manifest.json`、WXT 构建后的 `manifest.json` 和相对文件名数组。
- Produces: `verifyWxtBuildContract({ rootManifest, builtManifest, files }): { extensionIdentity: string, fileCount: number }`；不符合契约时抛出包含缺失字段或文件名的 `Error`。

- [ ] **Step 1: 写 Manifest 身份与资源契约的失败测试**

```js
import { describe, expect, test } from 'vitest'
import { verifyWxtBuildContract } from '../scripts/wxt-build-contract.mjs'

const rootManifest = {
  manifest_version: 3,
  key: 'stable-key',
  name: '静读',
  version: '0.2.0',
  permissions: ['storage'],
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  icons: { 16: 'assets/icon-16.png', 32: 'assets/icon-32.png', 48: 'assets/icon-48.png', 128: 'assets/icon-128.png' },
}

test('rejects a WXT manifest with a different extension key', () => {
  expect(() => verifyWxtBuildContract({
    rootManifest,
    builtManifest: { ...rootManifest, key: 'different-key' },
    files: [],
  })).toThrow(/key/i)
})

test('requires WXT PDF runtime assets and every declared icon', () => {
  expect(() => verifyWxtBuildContract({
    rootManifest,
    builtManifest: rootManifest,
    files: ['reader.html'],
  })).toThrow(/pdf\.worker|min\.mjs|icon/i)
})
```

- [ ] **Step 2: 运行测试并确认 RED**

Run: `npm test -- tests/wxt-build-contract.test.js`

Expected: FAIL because `scripts/wxt-build-contract.mjs` does not exist.

- [ ] **Step 3: 实现最小纯契约校验器**

```js
const IDENTITY_FIELDS = ['key', 'name', 'version']
const REQUIRED_RUNTIME_FILES = [
  'reader.html',
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
]

export function verifyWxtBuildContract({ rootManifest, builtManifest, files }) {
  for (const field of IDENTITY_FIELDS) {
    if (builtManifest[field] !== rootManifest[field])
      throw new Error(`WXT manifest ${field} differs from root manifest`)
  }
  if (JSON.stringify(builtManifest.permissions ?? []) !== JSON.stringify(rootManifest.permissions ?? []))
    throw new Error('WXT manifest permissions differ from root manifest')
  for (const path of [...REQUIRED_RUNTIME_FILES, ...Object.values(rootManifest.icons ?? {})]) {
    if (!files.includes(path)) throw new Error(`WXT build is missing ${path}`)
  }
  return { extensionIdentity: builtManifest.key, fileCount: files.length }
}
```

- [ ] **Step 4: 补齐可选主机权限、CSP 和图标路径测试**

测试必须分别证明以下错误会失败：

```js
expect(() => verifyWxtBuildContract({
  rootManifest,
  builtManifest: { ...rootManifest, optional_host_permissions: [] },
  files: completeFiles,
})).toThrow(/optional_host_permissions/)

expect(() => verifyWxtBuildContract({
  rootManifest: { ...rootManifest, content_security_policy: { extension_pages: "worker-src 'self'" } },
  builtManifest: { ...rootManifest, content_security_policy: { extension_pages: "worker-src 'self' blob:" } },
  files: completeFiles,
})).toThrow(/content_security_policy/)
```

- [ ] **Step 5: 实现构建目录命令行验证**

`scripts/verify-wxt-build.mjs` 必须递归读取 `.output/chrome-mv3`，调用纯校验器，并输出：

```text
Verified WXT build identity and runtime assets (<N> files)
```

`package.json` 增加：

```json
"build:wxt:verify": "npm run build && node scripts/verify-wxt-build.mjs"
```

- [ ] **Step 6: 运行聚焦测试并提交**

Run: `npm test -- tests/wxt-build-contract.test.js`

Expected: PASS.

```powershell
git add scripts/wxt-build-contract.mjs scripts/verify-wxt-build.mjs tests/wxt-build-contract.test.js package.json
git commit -m "test: define WXT build contract"
git push origin main
```

---

### Task 2: 让实际 WXT 构建满足根目录契约

**Files:**
- Modify: `wxt.config.ts`
- Modify: `scripts/sync-public-assets.mjs`
- Modify: `tests/wxt.test.js`
- Test: `tests/wxt-build-contract.test.js`

**Interfaces:**
- Consumes: Task 1 的 `verifyWxtBuildContract` 和 `npm run build:wxt:verify`。
- Produces: `.output/chrome-mv3` 中可被契约校验器接受的 Manifest V3 构建。

- [ ] **Step 1: 构建当前 WXT 并记录真实失败**

Run: `npm run build:wxt:verify`

Expected: FAIL with the first real identity, icon, CSP, background, reader entry, PDF worker or static resource mismatch. Preserve the exact error as the regression target.

- [ ] **Step 2: 为真实失败增加最小测试**

若缺失图标，测试必须断言构建 Manifest 声明并输出四个图标：

```js
expect(builtManifest.icons).toEqual(rootManifest.icons)
for (const path of Object.values(rootManifest.icons)) expect(files).toContain(path)
```

若缺失 PDF 或 Foliate 静态文件，测试必须使用构建目录文件集合断言缺失的精确路径，不能只搜索配置源码。

- [ ] **Step 3: 最小修改 WXT Manifest 和资源同步**

`wxt.config.ts` 从根目录约定补齐：

```ts
icons: {
  16: 'assets/icon-16.png',
  32: 'assets/icon-32.png',
  48: 'assets/icon-48.png',
  128: 'assets/icon-128.png',
},
```

只有契约测试证明构建缺失运行资源时，才扩展 `scripts/sync-public-assets.mjs`。同步目标必须位于 `public/node_modules/<package>/`，不得复制完整 `node_modules`。

- [ ] **Step 4: 反复运行真实构建契约直到 GREEN**

Run: `npm run build:wxt:verify`

Expected: PASS and print the verified file count.

- [ ] **Step 5: 验证根目录入口没有变化并提交**

Run: `npm run check && npm test -- tests/wxt.test.js tests/wxt-build-contract.test.js tests/manifest.test.js`

Expected: PASS.

```powershell
git add wxt.config.ts scripts/sync-public-assets.mjs tests/wxt.test.js tests/wxt-build-contract.test.js
git commit -m "build: align WXT runtime assets"
git push origin main
```

---

### Task 3: WXT 真实 Edge 基线

**Files:**
- Create: `tests/e2e/helpers/extension-launch.ts`
- Create: `tests/e2e/wxt-baseline.spec.ts`
- Modify: `package.json`
- Modify: `playwright.config.ts`

**Interfaces:**
- Consumes: Task 2 的 `.output/chrome-mv3` 和现有 `tests/fixtures/books/*`。
- Produces: `launchExtension(extensionPath, options?)`，返回 `{ context, page, extensionId }`；`npm run test:e2e:wxt:baseline` 在真实 Edge 加载 WXT 构建。

- [ ] **Step 1: 写扩展身份和欢迎页的失败 E2E**

```ts
test('WXT build keeps the root extension identity and opens the reader shell', async () => {
  const root = await launchExtension(resolve('.'))
  const wxt = await launchExtension(resolve('.output/chrome-mv3'))
  try {
    expect(wxt.extensionId).toBe(root.extensionId)
    await expect(wxt.page.locator('#welcome-view')).toBeVisible()
    await expect(wxt.page.locator('#file-input')).toHaveAttribute('accept', /epub/)
  } finally {
    await root.context.close()
    await wxt.context.close()
  }
})
```

- [ ] **Step 2: 运行并确认 RED**

Run: `npm run build && npx playwright test tests/e2e/wxt-baseline.spec.ts`

Expected: FAIL because the shared launcher or WXT baseline does not exist, or because the current WXT build cannot reach the welcome page.

- [ ] **Step 3: 实现共享启动器**

```ts
export async function launchExtension(extensionPath: string) {
  const context = await chromium.launchPersistentContext('', {
    executablePath: existsSync(edgePath) ? edgePath : undefined,
    channel: existsSync(edgePath) ? undefined : 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  let [worker] = context.serviceWorkers()
  worker ||= await context.waitForEvent('serviceworker')
  const extensionId = new URL(worker.url()).host
  const page = await context.newPage()
  await page.goto(`chrome-extension://${extensionId}/reader.html`)
  return { context, page, extensionId }
}
```

- [ ] **Step 4: 增加四格式真实文件基线**

EPUB、MOBI、AZW3 使用表驱动用例，至少断言加载完成、标题、目录数量和进度变化。PDF 单独断言文本层、页码跳转和缩放控件：

```ts
for (const format of ['epub', 'mobi', 'azw3']) {
  test(`WXT opens ${format} with TOC and progress`, async () => {
    const { context, page } = await launchExtension(resolve('.output/chrome-mv3'))
    try {
      await page.locator('#file-input').setInputFiles(resolve(`tests/fixtures/books/alice.${format}`))
      await expect(page.locator('#loading-view')).toBeHidden({ timeout: 45_000 })
      await expect(page.locator('#toc button')).not.toHaveCount(0)
      await page.locator('#toc button').last().click()
      await expect.poll(async () => Number(await page.locator('#progress-slider').inputValue())).toBeGreaterThan(0)
    } finally {
      await context.close()
    }
  })
}
```

实际文件名必须复用 `scripts/fetch-test-books.mjs` 已固定 SHA-256 的文件，不新建未授权样本。

- [ ] **Step 5: 增加独立准备和执行命令**

`package.json` 增加：

```json
"e2e:wxt:prepare": "npm run build && npm run fetch:test-books",
"test:e2e:wxt:baseline": "npm run e2e:wxt:prepare && playwright test tests/e2e/wxt-baseline.spec.ts"
```

- [ ] **Step 6: 运行 WXT 基线并提交**

Run: `npm run test:e2e:wxt:baseline`

Expected: WXT identity, welcome page, EPUB, MOBI, AZW3 and PDF tests PASS in Edge.

```powershell
git add tests/e2e/helpers/extension-launch.ts tests/e2e/wxt-baseline.spec.ts package.json playwright.config.ts
git commit -m "test: add WXT Edge baseline"
git push origin main
```

---

### Task 4: 阶段 A 完整验收与路线图更新

**Files:**
- Modify: `docs/MIGRATION.md`
- Modify: `docs/ROADMAP.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: Tasks 1–3 的构建契约和 WXT Edge 基线。
- Produces: 阶段 A 的可审计验收记录；不改变稳定入口声明。

- [ ] **Step 1: 执行完整静态与单元验证**

Run: `npm run check && npm test && npm run build:wxt:verify`

Expected: all commands exit 0; Vitest count is recorded from fresh output.

- [ ] **Step 2: 执行根目录和 WXT Edge 验收**

Run: `npm run test:e2e`

Expected: all existing root-extension E2E tests PASS.

Run: `npm run test:e2e:wxt:baseline`

Expected: all WXT identity and four-format baseline tests PASS.

- [ ] **Step 3: 执行发布包验证**

Run: `npm run release`

Expected: root stable ZIP is created and verified; store-only assets remain excluded.

- [ ] **Step 4: 更新文档但不提前切换稳定入口**

`docs/MIGRATION.md` 记录阶段 A 的构建文件数、WXT 基线测试数和实际 Edge 结果。`docs/ROADMAP.md` 只提高工程迁移阶段的实际完成度，并继续声明根目录版是稳定入口。`CHANGELOG.md` 在 `[Unreleased]` 的 `Added` 下记录 WXT 双入口基线。

- [ ] **Step 5: 进行独立代码审查**

审查必须覆盖：Manifest 身份、CSP、运行资源、WXT 真实 Edge 非空白页、四格式测试非空断言、根目录无回退和 `.output` 未进入 Git。

- [ ] **Step 6: 修复审查问题并重新验证受影响范围**

Critical 和 Important 问题必须修复；每个修复先增加失败测试。重新运行该问题影响的聚焦测试以及 Task 4 Steps 1–3 中所有相关完整命令。

- [ ] **Step 7: 提交并推送阶段 A**

```powershell
git add docs/MIGRATION.md docs/ROADMAP.md CHANGELOG.md
git diff --cached --check
git commit -m "docs: record WXT parity baseline"
git push origin main
```

阶段 A 完成后，开始独立的阶段 B“同 ID 数据连续性门禁”实施计划。
