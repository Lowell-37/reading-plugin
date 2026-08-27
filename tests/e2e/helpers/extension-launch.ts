import { chromium, type BrowserContext, type Page } from '@playwright/test'
import { existsSync } from 'node:fs'

const edgeCandidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
]

export interface LaunchedExtension {
  context: BrowserContext
  page: Page
  extensionId: string
}

export async function launchExtension(extensionPath: string): Promise<LaunchedExtension> {
  if (!existsSync(extensionPath)) throw new Error(`Extension path does not exist: ${extensionPath}`)
  const configuredEdgePath = process.env.EDGE_EXECUTABLE_PATH
  if (configuredEdgePath && !existsSync(configuredEdgePath)) {
    throw new Error(`EDGE_EXECUTABLE_PATH does not exist: ${configuredEdgePath}`)
  }
  const executablePath = configuredEdgePath || edgeCandidates.find(existsSync)

  const context = await chromium.launchPersistentContext('', {
    ...(executablePath ? { executablePath } : { channel: 'msedge' }),
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })

  try {
    let [worker] = context.serviceWorkers()
    worker ||= await context.waitForEvent('serviceworker')
    const extensionId = new URL(worker.url()).host
    const page = await context.newPage()
    await page.goto(`chrome-extension://${extensionId}/reader.html`)
    await page.locator('#welcome-view').waitFor({ state: 'visible' })
    return { context, page, extensionId }
  } catch (error) {
    await context.close()
    throw error
  }
}
