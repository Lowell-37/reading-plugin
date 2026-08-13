import { access, readFile } from 'node:fs/promises'
import { test, expect } from 'vitest'

test('store-ready manifest declares every required icon size', async () => {
  const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'))
  expect(manifest.icons).toEqual({
    16: 'assets/icon-16.png',
    32: 'assets/icon-32.png',
    48: 'assets/icon-48.png',
    128: 'assets/icon-128.png',
  })
  await Promise.all(Object.values(manifest.icons).map(path => access(new URL(`../${path}`, import.meta.url))))
})
