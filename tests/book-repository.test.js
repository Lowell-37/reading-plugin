import { test } from 'vitest'
import assert from 'node:assert/strict'
import { BookRepository } from '../src/book-repository.js'

test('BookRepository keeps persistence details behind one interface', async () => {
  const calls = []
  const repository = new BookRepository({
    saveBook: async (...args) => { calls.push(['save', ...args]); return { id: '1' } },
    updateBook: async (...args) => calls.push(['update', ...args]),
    listBooks: async () => { calls.push(['list']); return [{ id: '1' }] },
    deleteBook: async (...args) => calls.push(['delete', ...args]),
  })
  const file = { name: 'book.epub' }
  assert.deepEqual(await repository.save(file, 'epub'), { id: '1' })
  await repository.update('1', { openedAt: 1 })
  assert.deepEqual(await repository.list(), [{ id: '1' }])
  await repository.delete('1')
  assert.deepEqual(calls, [
    ['save', file, 'epub'],
    ['update', '1', { openedAt: 1 }],
    ['list'],
    ['delete', '1'],
  ])
})
