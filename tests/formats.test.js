import test from 'node:test'
import assert from 'node:assert/strict'
import { detectFormat, displayValue, formatBytes } from '../src/formats.js'

test('detects supported book extensions case-insensitively', () => {
  assert.equal(detectFormat('book.PDF'), 'pdf')
  assert.equal(detectFormat('book.epub'), 'epub')
  assert.equal(detectFormat('book.mobi'), 'mobi')
  assert.equal(detectFormat('book.AZW3'), 'azw3')
})

test('falls back to known MIME types', () => {
  assert.equal(detectFormat('download', 'application/pdf'), 'pdf')
  assert.equal(detectFormat('download', 'application/epub+zip'), 'epub')
  assert.equal(detectFormat('notes.txt', 'text/plain'), null)
})

test('formats metadata and file sizes for the UI', () => {
  assert.equal(displayValue({ zh: '书名', en: 'Title' }), '书名')
  assert.equal(displayValue([{ name: '甲' }, { name: '乙' }]), '甲、乙')
  assert.equal(formatBytes(1536), '1.5 KB')
})
