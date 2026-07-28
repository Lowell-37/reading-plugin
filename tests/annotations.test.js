import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createAnnotation, excerpt, findTextMatches, normalizeAnnotations } from '../src/core/annotations.ts'

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