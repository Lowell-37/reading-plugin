import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  annotationExportFileName,
  createAnnotationExport,
  serializeAnnotationsJson,
  serializeAnnotationsMarkdown,
} from '../src/core/annotation-export.ts'

const annotations = [
  {
    id: 'ebook-note',
    kind: 'ebook',
    locator: 'epubcfi(/6/2)',
    section: 1,
    page: null,
    text: 'Selected\ntext',
    note: 'Remember this',
    color: '#f4c95d',
    rects: [],
    createdAt: Date.parse('2026-07-29T01:00:00.000Z'),
  },
  {
    id: 'pdf-highlight',
    kind: 'pdf',
    locator: 'page:3',
    section: null,
    page: 3,
    text: 'PDF selection',
    note: '',
    color: '#f4c95d',
    rects: [],
    createdAt: Date.parse('2026-07-29T02:00:00.000Z'),
    updatedAt: Date.parse('2026-07-29T03:00:00.000Z'),
  },
]

test('creates a versioned annotation export with book metadata', () => {
  const document = createAnnotationExport({
    name: 'alice.epub',
    format: 'epub',
    metadata: { title: 'Alice / Wonderland', author: 'Lewis Carroll' },
  }, annotations, '2026-07-29T04:00:00.000Z')
  assert.equal(document.format, 'quiet-reader-annotations')
  assert.equal(document.version, 1)
  assert.equal(document.book.title, 'Alice / Wonderland')
  assert.equal(document.annotations.length, 2)
  assert.equal(JSON.parse(serializeAnnotationsJson(document)).annotations[0].note, 'Remember this')
})

test('serializes readable Markdown with locations, quotes and notes', () => {
  const document = createAnnotationExport({
    title: 'Example',
    author: 'Reader',
    fileName: 'example.pdf',
    format: 'pdf',
  }, annotations, '2026-07-29T04:00:00.000Z')
  const markdown = serializeAnnotationsMarkdown(document)
  assert.match(markdown, /^# Example · 高亮与批注/m)
  assert.match(markdown, /> Selected\n> text/)
  assert.match(markdown, /\*\*批注：\*\* Remember this/)
  assert.match(markdown, /第 3 页/)
  assert.equal(annotationExportFileName(document, 'md'), 'Example-annotations.md')
})

test('sanitizes annotation export filenames', () => {
  const document = createAnnotationExport({ title: 'A/B: C?', format: 'epub' }, [])
  assert.equal(annotationExportFileName(document, 'json'), 'A-B- C--annotations.json')
})
