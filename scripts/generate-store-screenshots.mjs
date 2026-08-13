import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const extensionPath = resolve('.')
const edgePath = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
const bookPath = resolve('tests/fixtures/books/boundaries.epub')
const output = new URL('../assets/store/', import.meta.url)
await mkdir(output, { recursive: true })

const context = await chromium.launchPersistentContext('', {
  executablePath: existsSync(edgePath) ? edgePath : undefined,
  channel: existsSync(edgePath) ? undefined : 'chromium',
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
})
try {
  let [worker] = context.serviceWorkers()
  worker ||= await context.waitForEvent('serviceworker')
  const page = await context.newPage()
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/reader.html`)
  await page.screenshot({ path: fileURLToPath(new URL('store-welcome.png', output)) })

  await page.locator('#file-input').setInputFiles(bookPath)
  await page.locator('#loading-view').waitFor({ state: 'hidden', timeout: 30_000 })
  await page.screenshot({ path: fileURLToPath(new URL('store-reader.png', output)) })
} finally {
  await context.close()
}
