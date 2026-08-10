import assert from 'node:assert/strict'
import { test } from 'vitest'
import {
  annotationImportMatchesBook,
  mergeAnnotationImports,
  parseAnnotationImport,
} from '../src/core/annotation-import.ts'

const document = annotations => JSON.stringify({
  format: 'quiet-reader-annotations',
  version: 1,
  exportedAt: '2026-07-31T00:00:00.000Z',
  book: { title: 'Alice', author: 'Lewis Carroll', fileName: 'alice.epub', format: 'epub' },
  annotations,
})

const annotation = (id, createdAt, updatedAt) => ({
  id,
  kind: 'ebook',
  locator: `epubcfi(/6/${id})`,
  page: null,
  section: 1,
  text: id,
  note: '',
  color: '#f4c95d',
  rects: [],
  createdAt,
  ...(updatedAt == null ? {} : { updatedAt }),
})

test('parses a versioned annotation document', () => {
  const parsed = parseAnnotationImport(document([annotation('2', 2)]))
  assert.equal(parsed.book.fileName, 'alice.epub')
  assert.equal(parsed.annotations[0].id, '2')
})

test('rejects malformed, foreign and future annotation documents', () => {
  assert.throws(() => parseAnnotationImport('{'), /JSON/)
  assert.throws(() => parseAnnotationImport(JSON.stringify({ format: 'other', version: 1 })), /静读/)
  assert.throws(() => parseAnnotationImport(JSON.stringify({ format: 'quiet-reader-annotations', version: 2, book: {}, annotations: [] })), /版本/)
  assert.throws(() => parseAnnotationImport(document([{ id: 'bad' }])), /无效记录/)
  assert.throws(() => parseAnnotationImport(document(Array.from({ length: 10_001 }, () => annotation('many', 1)))), /记录过多/)
})

test('checks imported book identity using format and filename', () => {
  assert.equal(annotationImportMatchesBook(
    { fileName: 'Alice.EPUB', format: 'EPUB' },
    { fileName: 'alice.epub', format: 'epub' },
  ), true)
  assert.equal(annotationImportMatchesBook(
    { fileName: 'other.epub', format: 'epub' },
    { fileName: 'alice.epub', format: 'epub' },
  ), false)
})

test('merges by id with newer imported records winning conflicts', () => {
  const local = [annotation('same-old', 1, 30), annotation('replace', 2, 20)]
  const imported = [annotation('same-old', 1, 10), { ...annotation('replace', 2, 40), note: 'newer' }, annotation('new', 50)]
  const result = mergeAnnotationImports(local, imported)
  assert.equal(result.added, 1)
  assert.equal(result.updated, 1)
  assert.equal(result.skipped, 1)
  assert.equal(result.annotations.find(item => item.id === 'replace').note, 'newer')
  assert.equal(result.annotations.find(item => item.id === 'same-old').updatedAt, 30)
})
