import { expect, test } from 'vitest'
import { createEbookAnnotationRehydrator } from '../src/ebook-annotation-rehydration.js'

test('hydrates an overlay only after its section repair has settled', async () => {
  let resolveRepair
  const repair = new Promise(resolve => { resolveRepair = resolve })
  const hydrated = []
  const rehydrator = createEbookAnnotationRehydrator({
    repair: () => repair,
    hydrate: index => { hydrated.push(index) },
  })

  rehydrator.onLoad({ body: {} }, 3)
  const overlay = rehydrator.onOverlay(3)
  await Promise.resolve()
  expect(hydrated).toEqual([])

  resolveRepair()
  await overlay
  expect(hydrated).toEqual([3])
})
