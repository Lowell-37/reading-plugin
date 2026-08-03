import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createAnnotation,
  excerpt,
  filterAnnotations,
  findTextMatches,
  normalizeAnnotations,
  normalizeAnnotationTags,
  sortAnnotations,
  updateAnnotation,
} from '../src/core/annotations.ts'

test('creates bounded, persistable annotations', () => {
  const annotation = createAnnotation({ kind: 'ebook', locator: 'epubcfi(/6/2)', text: ' selected text ', note: ' note ', tags: 'classic, fiction' })
  assert.equal(annotation.kind, 'ebook')
  assert.equal(annotation.text, 'selected text')
  assert.equal(annotation.note, 'note')
  assert.deepEqual(annotation.tags, ['classic', 'fiction'])
  assert.match(annotation.id, /^\d+-/)
})

test('normalizes invalid stored annotation data and legacy records', () => {
  const valid = { id: '1', kind: 'pdf', page: 3 }
  const [normalized] = normalizeAnnotations([null, {}, valid])
  assert.equal(normalized.id, '1')
  assert.equal(normalized.page, 3)
  assert.deepEqual(normalized.tags, [])
  assert.deepEqual(normalizeAnnotations('bad'), [])
})

test('normalizes, deduplicates and bounds annotation tags', () => {
  assert.deepEqual(normalizeAnnotationTags(' alpha, beta，alpha,  '), ['alpha', 'beta'])
  assert.equal(normalizeAnnotationTags(Array.from({ length: 15 }, (_, index) => `tag-${index}`)).length, 10)
  assert.equal(normalizeAnnotationTags(['x'.repeat(50)])[0].length, 30)
})

test('finds case-insensitive repeated text matches', () => {
  assert.deepEqual(findTextMatches('Book book BOOK', 'book'), [0, 5, 10])
  assert.deepEqual(findTextMatches('text', ''), [])
})

test('builds a compact excerpt around a match', () => {
  const value = excerpt('0123456789 needle abcdefghij', 'needle', 4)
  assert.equal(value, '…789 needle abc…')
})

test('updates note and tags immutably and records edit time', () => {
  const source = [
    { id: 'a', kind: 'ebook', locator: 'cfi-a', text: 'one', note: '', createdAt: 1 },
    { id: 'b', kind: 'pdf', page: 2, text: 'two', note: 'old', createdAt: 2 },
  ]
  const updated = updateAnnotation(source, 'b', { note: '  revised  ', tags: 'review, key, review' }, 99)
  assert.equal(source[1].note, 'old')
  assert.equal(updated[0], source[0])
  assert.equal(updated[1].note, 'revised')
  assert.deepEqual(updated[1].tags, ['review', 'key'])
  assert.equal(updated[1].updatedAt, 99)
})

test('filters annotations by note state, format, keyword and tag', () => {
  const source = [
    { id: 'a', kind: 'ebook', locator: 'cfi-a', text: 'Rabbit hole', note: '', tags: ['classic'], createdAt: 1 },
    { id: 'b', kind: 'pdf', page: 3, text: 'Tea party', note: 'Review this', tags: ['important'], createdAt: 2 },
  ]
  assert.deepEqual(filterAnnotations(source, { type: 'notes' }).map(item => item.id), ['b'])
  assert.deepEqual(filterAnnotations(source, { type: 'highlights' }).map(item => item.id), ['a'])
  assert.deepEqual(filterAnnotations(source, { type: 'pdf' }).map(item => item.id), ['b'])
  assert.deepEqual(filterAnnotations(source, { query: 'rabbit' }).map(item => item.id), ['a'])
  assert.deepEqual(filterAnnotations(source, { query: 'important' }).map(item => item.id), ['b'])
  assert.deepEqual(filterAnnotations(source, { query: '第 3 页' }).map(item => item.id), ['b'])
})

test('sorts annotations without mutating the source', () => {
  const source = [
    { id: 'late', kind: 'pdf', page: 8, createdAt: 30 },
    { id: 'edited', kind: 'pdf', page: 4, createdAt: 10, updatedAt: 40 },
    { id: 'early', kind: 'pdf', page: 2, createdAt: 20 },
  ]
  assert.deepEqual(sortAnnotations(source, 'newest').map(item => item.id), ['edited', 'late', 'early'])
  assert.deepEqual(sortAnnotations(source, 'oldest').map(item => item.id), ['early', 'late', 'edited'])
  assert.deepEqual(sortAnnotations(source, 'location').map(item => item.id), ['early', 'edited', 'late'])
  assert.equal(source[0].id, 'late')
})

test('preserves valid text anchors while normalizing stored annotations', () => {
  const anchor = {
    version: 1,
    kind: 'ebook',
    section: 2,
    cfi: 'epubcfi(/6/4)',
    textOffset: 42,
    quote: { exact: 'Rabbit', normalizedExact: 'Rabbit', prefix: 'the ', suffix: ' hole' },
  }
  const [annotation] = normalizeAnnotations([{
    id: 'anchored',
    kind: 'ebook',
    locator: 'epubcfi(/6/4)',
    text: 'Rabbit',
    createdAt: 1,
    anchor,
    anchorStatus: 'resolved',
  }])
  assert.deepEqual(annotation.anchor, anchor)
  assert.equal(annotation.anchorStatus, 'resolved')
})

test('drops a malformed anchor without dropping the legacy annotation', () => {
  const [annotation] = normalizeAnnotations([{
    id: 'legacy',
    kind: 'pdf',
    page: 1,
    text: 'Text',
    createdAt: 1,
    anchor: { version: 2, kind: 'pdf' },
    anchorStatus: 'broken',
  }])
  assert.equal(annotation.id, 'legacy')
  assert.equal(annotation.anchor, undefined)
  assert.equal(annotation.anchorStatus, undefined)
})
