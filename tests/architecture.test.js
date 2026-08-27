import { readFile } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('legacy reader state bridge has no DOM reverse-synchronization path', async () => {
  const source = await readFile(new URL('../entrypoints/reader/legacy-bridge.ts', import.meta.url), 'utf8')

  expect(source).not.toMatch(/MutationObserver|querySelector|syncFromDom/)
  expect(source).toMatch(/onState/)
})
