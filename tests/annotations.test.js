import { test } from 'vitest'
import assert from 'node:assert/strict'
import {
  createAnnotation,
  excerpt,
  filterAnnotations,
  findTextMatches,
  normalizeAnnotations,
  updateAnnotation,
} from '../src/core/annotations.ts'

test('creates bounded, persistable annotations', () => {
  const annotation = createAnnotation({ kind: 'ebook', locator: 'epubcfi(/6/2)', text: ' selected text ', note: ' note ' })
  assert.equal(annotation.kind, 'ebook')
  assert.equal(annotation.text, 'selected text')
  assert.equal(annotation.note, 'note')
  assert.match(annotation.id, /^\d+-/)
})

test('normalizes invalid stored annotation data', () => {
  const valid = { id: '1', kind: 'pdf', page: 3 }
  assert.deepEqual(normalizeAnnotations([null, {}, valid]), [valid])
  assert.deepEqual(normalizeAnnotations('bad'), [])
})

test('finds case-insensitive repeated text matches', () => {
  assert.deepEqual(findTextMatches('Book book BOOK', 'book'), [0, 5, 10])
  assert.deepEqual(findTextMatches('text', ''), [])
})

test('builds a compact excerpt around a match', () => {
  const value = excerpt('0123456789 needle abcdefghij', 'needle', 4)
  assert.equal(value, '…789 needle abc…')
})

test('updates one annotation immutably and records edit time', () => {
  const source = [
    { id: 'a', kind: 'ebook', locator: 'cfi-a', text: 'one', note: '', createdAt: 1 },
    { id: 'b', kind: 'pdf', page: 2, text: 'two', note: 'old', createdAt: 2 },
  ]
  const updated = updateAnnotation(source, 'b', { note: '  revised  ' }, 99)
  assert.equal(source[1].note, 'old')
  assert.equal(updated[0], source[0])
  assert.equal(updated[1].note, 'revised')
  assert.equal(updated[1].updatedAt, 99)
})

test('filters annotations by note state, format and keyword', () => {
  const source = [
    { id: 'a', kind: 'ebook', locator: 'cfi-a', text: 'Rabbit hole', note: '', createdAt: 1 },
    { id: 'b', kind: 'pdf', page: 3, text: 'Tea party', note: 'Review this', createdAt: 2 },
  ]
  assert.deepEqual(filterAnnotations(source, { type: 'notes' }).map(item => item.id), ['b'])
  assert.deepEqual(filterAnnotations(source, { type: 'highlights' }).map(item => item.id), ['a'])
  assert.deepEqual(filterAnnotations(source, { type: 'pdf' }).map(item => item.id), ['b'])
  assert.deepEqual(filterAnnotations(source, { query: 'rabbit' }).map(item => item.id), ['a'])
  assert.deepEqual(filterAnnotations(source, { query: '第 3 页' }).map(item => item.id), ['b'])
})