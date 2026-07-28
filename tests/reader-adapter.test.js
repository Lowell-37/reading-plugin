import { test } from 'vitest'
import assert from 'node:assert/strict'
import { createEbookReaderAdapter, createPdfReaderAdapter } from '../src/reader-adapter.js'

test('ebook adapter presents one navigation contract for Foliate modes', () => {
  const calls = []
  const adapter = createEbookReaderAdapter({
    format: 'epub',
    goTo: target => calls.push(['target', target]),
    goToFraction: fraction => calls.push(['fraction', fraction]),
    goLeft: () => calls.push(['left']),
    goRight: () => calls.push(['right']),
    getLocation: () => ({ kind: 'ebook', fraction: .4 }),
  })
  adapter.navigate(-1)
  adapter.navigate(1)
  adapter.goToFraction(.6)
  assert.deepEqual(calls, [['left'], ['right'], ['fraction', .6]])
  assert.deepEqual(adapter.getLocation(), { kind: 'ebook', fraction: .4 })
})

test('PDF adapter maps fraction and relative navigation to pages', () => {
  const pages = []
  let currentPage = 4
  const adapter = createPdfReaderAdapter({
    goToPage: page => pages.push(page),
    getPage: () => currentPage,
    getPageCount: () => 11,
  })
  adapter.navigate(1)
  adapter.goToFraction(.5)
  assert.deepEqual(pages, [5, 6])
  assert.deepEqual(adapter.getLocation(), { kind: 'pdf', page: 4, fraction: .3 })
  currentPage = 11
  assert.deepEqual(adapter.getLocation(), { kind: 'pdf', page: 11, fraction: 1 })
})
