import { createHash } from 'node:crypto'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { renderStorePromo, storePromoFingerprint, storePromos } from './store-promo-assets.mjs'

const icon = await readFile(new URL('../assets/icon.svg', import.meta.url), 'utf8')
const output = new URL('../assets/store/', import.meta.url)

await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true })
const assets = []
try {
  for (const promo of storePromos) {
    const page = await browser.newPage({ viewport: { width: promo.width, height: promo.height } })
    await page.setContent(renderStorePromo(promo.variant, icon))
    const image = await page.screenshot()
    await writeFile(new URL(promo.name, output), image)
    assets.push({
      file: promo.name,
      width: promo.width,
      height: promo.height,
      sha256: createHash('sha256').update(image).digest('hex'),
    })
    await page.close()
  }
} finally {
  await browser.close()
}

const manifest = {
  format: 'quiet-reader-store-promos',
  formatVersion: 1,
  sourceSha256: await storePromoFingerprint(),
  assets,
}
await writeFile(new URL('promo-assets.json', output), `${JSON.stringify(manifest, null, 2)}\n`)
