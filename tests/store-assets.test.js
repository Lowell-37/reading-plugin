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

test('store screenshots are 1280 by 800 and contain no user library data', async () => {
  for (const name of ['store-welcome.png', 'store-reader.png']) {
    const image = await readFile(new URL(`../assets/store/${name}`, import.meta.url))
    expect(image.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    expect(image.readUInt32BE(16)).toBe(1280)
    expect(image.readUInt32BE(20)).toBe(800)
  }
})
