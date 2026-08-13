import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import AdmZip from 'adm-zip'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const archivePath = resolve('dist/quiet-reader-0.2.0.zip')
const bookPath = resolve('tests/fixtures/books/alice.epub')

test('an unpacked release upgrade preserves the extension ID, library, and reading progress', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quiet-reader-upgrade-'))
  const extensionPath = join(directory, 'extension')
  const profilePath = join(directory, 'profile')
  let context: BrowserContext | null = null
  try {
    new AdmZip(archivePath).extractAllTo(extensionPath, true)
    const initial = await launchExtension(extensionPath, profilePath)
    context = initial.context
    const extensionId = new URL(initial.page.url()).host
    await initial.page.locator('#file-input').setInputFiles(bookPath)
    await expect(initial.page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await initial.page.locator('#next-button').evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => progress(initial.page)).toBeGreaterThan(0)
    const savedProgress = await progress(initial.page)
    await context.close()
    context = null

    const manifestPath = join(extensionPath, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.version = '0.2.1'
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

    const upgraded = await launchExtension(extensionPath, profilePath)
    context = upgraded.context
    expect(new URL(upgraded.page.url()).host).toBe(extensionId)
    await expect(upgraded.page.locator('.library-card')).toContainText('Alice')
    await upgraded.page.locator('.library-card').filter({ hasText: 'Alice' }).click()
    await expect(upgraded.page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await expect.poll(() => progress(upgraded.page)).toBeGreaterThanOrEqual(savedProgress * 0.8)
  } finally {
    await context?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

test('rolling back an unpacked release preserves the extension library', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quiet-reader-rollback-'))
  const extensionPath = join(directory, 'extension')
  const profilePath = join(directory, 'profile')
  let context: BrowserContext | null = null
  try {
    new AdmZip(archivePath).extractAllTo(extensionPath, true)
    const current = await launchExtension(extensionPath, profilePath)
    context = current.context
    await current.page.locator('#file-input').setInputFiles(bookPath)
    await expect(current.page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await current.page.locator('#next-button').evaluate((button: HTMLElement) => button.click())
    await expect.poll(() => progress(current.page)).toBeGreaterThan(0)
    const savedProgress = await progress(current.page)
    await context.close()
    context = null

    new AdmZip(archivePath).extractAllTo(extensionPath, true)
    const rolledBack = await launchExtension(extensionPath, profilePath)
    context = rolledBack.context
    await expect(rolledBack.page.locator('.library-card')).toContainText('Alice')
    await rolledBack.page.locator('.library-card').filter({ hasText: 'Alice' }).click()
    await expect(rolledBack.page.locator('#loading-view')).toBeHidden({ timeout: 30_000 })
    await expect.poll(() => progress(rolledBack.page)).toBeGreaterThanOrEqual(savedProgress * 0.8)
  } finally {
    await context?.close()
    await rm(directory, { recursive: true, force: true })
  }
})

async function launchExtension(extensionPath: string, profilePath: string): Promise<{ context: BrowserContext, page: Page }> {
  const context = await chromium.launchPersistentContext(profilePath, {
    executablePath: existsSync(edgePath) ? edgePath : undefined,
    channel: existsSync(edgePath) ? undefined : 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  let [worker] = context.serviceWorkers()
  worker ||= await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/reader.html`)
  await expect(page.locator('#welcome-view')).toBeVisible()
  return { context, page }
}

async function progress(page: Page) {
  return Number(await page.locator('#progress-slider').inputValue())
}
