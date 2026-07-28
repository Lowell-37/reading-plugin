import { readFile, readdir } from 'node:fs/promises'
import { test, expect } from 'vitest'

test('Vue components depend on UI state, not Foliate or PDF.js internals', async () => {
  const directory = new URL('../entrypoints/reader/components/', import.meta.url)
  const components = (await readdir(directory)).filter(name => name.endsWith('.vue'))
  const source = (await Promise.all(components.map(name => readFile(new URL(name, directory), 'utf8')))).join('\n')
  expect(source).not.toMatch(/foliate-js|pdfjs-dist|ContinuousEbookScroller/)

  const main = await readFile(new URL('../entrypoints/reader/main.ts', import.meta.url), 'utf8')
  expect(main).toMatch(/createPinia/)
  expect(main).toMatch(/await import\('\.\.\/\.\.\/src\/reader\.js'\)/)
})
