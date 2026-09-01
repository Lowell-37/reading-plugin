import { readFile, readdir } from 'node:fs/promises'
import { expect, test } from 'vitest'

test('legacy reader state bridge has no DOM reverse-synchronization path', async () => {
  const source = await readFile(new URL('../entrypoints/reader/legacy-bridge.ts', import.meta.url), 'utf8')

  expect(source).not.toMatch(/MutationObserver|ResizeObserver|querySelector|syncFromDom|\bdocument\b|\bwindow\b|addEventListener/)
  expect(source).toMatch(/onState/)
  expect(source).toMatch(/attachPort/)
  expect(source).toMatch(/destroy/)
})

test('WXT components and stores cannot import legacy reader, persistence, or ebook engines', async () => {
  const componentRoot = new URL('../entrypoints/reader/', import.meta.url)
  const componentPaths = (await readdir(componentRoot, { recursive: true }))
    .filter(path => (path.startsWith('components/') || path.startsWith('components\\') || path.startsWith('stores/') || path.startsWith('stores\\'))
      && (path.endsWith('.vue') || path.endsWith('.ts')))

  expect(componentPaths.length).toBeGreaterThan(0)
  for (const path of componentPaths) {
    const source = await readFile(new URL(path, componentRoot), 'utf8')
    expect(source, path).not.toMatch(/from\s+['"][^'"]*(?:src\/reader\.js|foliate-js|continuous-ebook)[^'"]*['"]/)
    expect(source, path).not.toMatch(/\bindexedDB\b/)
  }
})
