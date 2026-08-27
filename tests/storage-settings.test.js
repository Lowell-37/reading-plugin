// @vitest-environment jsdom
import { afterEach, expect, test } from 'vitest'
import { loadSettings } from '../src/storage.js'

afterEach(() => localStorage.clear())

test('loads settings with invalid known fields normalized and unknown fields preserved', () => {
  localStorage.setItem('quiet-reader-settings', JSON.stringify({
    theme: 'broken',
    flow: 'scrolled',
    fontSize: 1000,
    customReaderFlag: 'preserved',
  }))

  expect(loadSettings()).toMatchObject({
    theme: 'paper',
    flow: 'scrolled',
    fontSize: 20,
    customReaderFlag: 'preserved',
  })
})

test('loads defaults when settings JSON is malformed', () => {
  localStorage.setItem('quiet-reader-settings', '{broken')
  expect(loadSettings()).toMatchObject({ theme: 'paper', flow: 'paginated', fontSize: 20 })
})
