import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test'
import AdmZip from 'adm-zip'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'

const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const releaseArchive = resolve('dist/quiet-reader-0.2.0.zip')
const rootExtensionPath = resolve('.')

test('release ZIP preserves the stable root extension ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'quiet-reader-release-'))
  const extensionPath = join(directory, 'extension')
  const profilePath = join(directory, 'profile')
  let context: BrowserContext | null = null
  try {
    const root = await launchExtension(rootExtensionPath, join(directory, 'root-profile'))
    const rootExtensionId = new URL(root.page.url()).host
    await root.context.close()

    new AdmZip(releaseArchive).extractAllTo(extensionPath, true)
    expect(existsSync(join(extensionPath, 'manifest.json'))).toBe(true)
    const launched = await launchExtension(extensionPath, profilePath)
    context = launched.context
    expect(new URL(launched.page.url()).host).toBe(rootExtensionId)
    await expect(launched.page.locator('#welcome-view')).toBeVisible()
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
  return { context, page }
}
