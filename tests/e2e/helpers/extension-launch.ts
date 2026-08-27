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
  pageErrors: Error[]
}

export interface ExtensionLaunchOptions {
  userDataDir?: string
  waitForSelector?: string | null
  extensionId?: string
}

export async function launchExtension(
  extensionPath: string,
  { userDataDir = '', waitForSelector = '#welcome-view', extensionId: knownExtensionId }: ExtensionLaunchOptions = {},
): Promise<LaunchedExtension> {
  if (!existsSync(extensionPath)) throw new Error(`Extension path does not exist: ${extensionPath}`)
  const configuredEdgePath = process.env.EDGE_EXECUTABLE_PATH
  if (configuredEdgePath && !existsSync(configuredEdgePath)) {
    throw new Error(`EDGE_EXECUTABLE_PATH does not exist: ${configuredEdgePath}`)
  }
  const executablePath = configuredEdgePath || edgeCandidates.find(existsSync)

  const context = await chromium.launchPersistentContext(userDataDir, {
    ...(executablePath ? { executablePath } : { channel: 'msedge' }),
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  })

  try {
    let extensionId = knownExtensionId
    if (!extensionId) {
      let [worker] = context.serviceWorkers()
      worker ||= await context.waitForEvent('serviceworker')
      extensionId = new URL(worker.url()).host
    }
    const page = await context.newPage()
    const pageErrors: Error[] = []
    page.on('pageerror', error => pageErrors.push(error))
    await page.goto(`chrome-extension://${extensionId}/reader.html`)
    if (waitForSelector) await page.locator(waitForSelector).waitFor({ state: 'visible' })
    return { context, page, extensionId, pageErrors }
  } catch (error) {
    await context.close()
    throw error
  }
}
