import { readFile, readdir } from 'node:fs/promises'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { expect, test } from 'vitest'

test('legacy reader state bridge has no DOM reverse-synchronization path', async () => {
  const source = await readFile(new URL('../entrypoints/reader/legacy-bridge.ts', import.meta.url), 'utf8')

  expect(source).not.toMatch(/MutationObserver|ResizeObserver|querySelector|syncFromDom|\bdocument\b|\bwindow\b|addEventListener/)
  expect(source).toMatch(/onState/)
  expect(source).toMatch(/attachPort/)
  expect(source).toMatch(/destroy/)
})

test('collects static, re-exported, dynamic, and CommonJS module specifiers', () => {
  expect(collectModuleSpecifiers(`
    import 'static-module'
    export { value } from 're-export-module'
    export * from 'star-export-module'
    void import('dynamic-module')
    require('commonjs-module')
  `, 'fixture.ts')).toEqual([
    'static-module',
    're-export-module',
    'star-export-module',
    'dynamic-module',
    'commonjs-module',
  ])
})

test('collects module specifiers from Vue script blocks rather than template text', () => {
  expect(collectModuleSpecifiers(`
    <template><p>import('template-text')</p></template>
    <script setup lang="ts">
    import { value } from 'vue-script-module'
    </script>
  `, 'fixture.vue')).toEqual(['vue-script-module'])
})

test('selects Vue files and TypeScript files under reader components and stores', () => {
  expect([
    'App.vue',
    'components/ReaderWorkspace.vue',
    'components/pdf-controls.ts',
    'stores/pdf-session.ts',
    'helpers/reader.ts',
  ].filter(isViewBoundaryPath)).toEqual([
    'App.vue',
    'components/ReaderWorkspace.vue',
    'components/pdf-controls.ts',
    'stores/pdf-session.ts',
  ])
})

test('detects direct indexedDB usage only in reader scripts', () => {
  expect(usesDirectIndexedDb(`const database = indexedDB.open('reader')`, 'fixture.ts')).toBe(true)
  expect(usesDirectIndexedDb(`
    <template><p>indexedDB</p></template>
    <script setup lang="ts">const label = 'indexedDB'</script>
  `, 'fixture.vue')).toBe(false)
})

test('WXT Vue components and stores cannot import legacy, persistence, PDF, or ebook engines', async () => {
  const componentRoot = new URL('../entrypoints/reader/', import.meta.url)
  const componentPaths = (await readdir(componentRoot, { recursive: true }))
    .filter(isViewBoundaryPath)

  expect(componentPaths.length).toBeGreaterThan(0)
  for (const path of componentPaths) {
    const source = await readFile(new URL(path, componentRoot), 'utf8')
    expect(collectModuleSpecifiers(source, path).some(isViewBoundaryViolation), path).toBe(false)
    expect(usesDirectIndexedDb(source, path), path).toBe(false)
  }
})

test('PDF.js adapter files own no persistence, search, annotation, or Vue dependencies', async () => {
  const adapterRoot = new URL('../entrypoints/reader/', import.meta.url)
  const adapterPaths = ['pdfjs-session.ts', 'pdf-session-dependencies.ts']

  for (const path of adapterPaths) {
    const source = await readFile(new URL(path, adapterRoot), 'utf8')
    expect(collectModuleSpecifiers(source, path).some(isAdapterBoundaryViolation), path).toBe(false)
  }
})

test('legacy PDF tools expose only rendered DOM reads and typed numeric navigation, never engine resources', async () => {
  const source = await readFile(new URL('../entrypoints/reader/legacy-reader-port.ts', import.meta.url), 'utf8')
  const script = createScriptSourceFile(source, 'legacy-reader-port.ts')
  const tools = script.statements.find(node => ts.isInterfaceDeclaration(node) && node.name.text === 'LegacyPdfTools')
  expect(tools).toBeDefined()
  expect(tools.members.map(member => member.name.getText(script))).toEqual(['pageCount', 'readTextLayer', 'goTo'])
  expect(collectModuleSpecifiers(source, 'legacy-reader-port.ts').some(specifier =>
    /pdfjs|pdf-session-dependencies|reader\.js|promise-cache/.test(specifier))).toBe(false)
  expect(tools.members.map(member => member.type.getText(script))).toEqual(['number', 'HTMLElement | null', 'Promise<void>'])
})

function collectModuleSpecifiers(source, filename) {
  const sourceFile = createScriptSourceFile(source, filename)
  const specifiers = []

  const visit = node => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && isModuleLoad(node) && node.arguments.length === 1 && ts.isStringLiteral(node.arguments[0])) {
      specifiers.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return specifiers
}

function createScriptSourceFile(source, filename) {
  const descriptor = filename.endsWith('.vue') ? parse(source, { filename }).descriptor : null
  const script = descriptor
    ? [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean).join('\n')
    : source
  return ts.createSourceFile(filename, script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function isModuleLoad(node) {
  return node.expression.kind === ts.SyntaxKind.ImportKeyword
    || (ts.isIdentifier(node.expression) && node.expression.text === 'require')
}

function isViewBoundaryPath(path) {
  const isComponentOrStore = path.startsWith('components/') || path.startsWith('components\\') || path.startsWith('stores/') || path.startsWith('stores\\')
  return path.endsWith('.vue') || (isComponentOrStore && path.endsWith('.ts'))
}

function usesDirectIndexedDb(source, filename) {
  let found = false
  const visit = node => {
    if (ts.isIdentifier(node) && node.text === 'indexedDB' && !isIndexedDbDeclarationOrPropertyName(node)) found = true
    ts.forEachChild(node, visit)
  }
  visit(createScriptSourceFile(source, filename))
  return found
}

function isIndexedDbDeclarationOrPropertyName(node) {
  return (ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)
    || (ts.isVariableDeclaration(node.parent) && node.parent.name === node)
    || ts.isImportSpecifier(node.parent)
}

function isViewBoundaryViolation(specifier) {
  return /(?:src\/reader\.js|book-repository|storage\.js|foliate-js|continuous-ebook|pdfjs-dist)/.test(specifier)
}

function isAdapterBoundaryViolation(specifier) {
  return /(?:book-repository|storage\.js|search|annotation|vue)/.test(specifier)
}
