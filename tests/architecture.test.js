import { readFile, readdir } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('legacy reader state bridge has no DOM reverse-synchronization path', async () => {
  const source = await readFile(new URL('../entrypoints/reader/legacy-bridge.ts', import.meta.url), 'utf8')

  expect(source).not.toMatch(/MutationObserver|ResizeObserver|querySelector|syncFromDom|\bdocument\b|\bwindow\b|addEventListener/)
  expect(source).toMatch(/onState/)
  expect(source).toMatch(/attachPort/)
  expect(source).toMatch(/destroy/)
})

test('Vue components cannot import legacy reader, persistence, Foliate or PDF.js', async () => {
  const componentRoot = new URL('../entrypoints/reader/', import.meta.url)
  const componentPaths = (await readdir(componentRoot, { recursive: true }))
    .filter(path => path.endsWith('.vue'))

  expect(componentPaths.length).toBeGreaterThan(0)
  for (const path of componentPaths) {
    const source = await readFile(new URL(path, componentRoot), 'utf8')
    expect(source, path).not.toMatch(/from\s+['"][^'"]*(?:src\/reader\.js|book-repository|storage\.js|foliate-js|pdfjs-dist)[^'"]*['"]/)
    expect(source, path).not.toMatch(/\bindexedDB\b/)
  }
})
