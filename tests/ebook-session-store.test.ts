import { createPinia } from 'pinia'
import { describe, expect, test } from 'vitest'
import { type EbookSessionCallbacks, type EbookSessionPort, type EbookSessionPortFactory, type EbookSessionSnapshot, type EbookSessionTocItem } from '../entrypoints/reader/ebook-session-port'
import { createEbookSessionStore } from '../entrypoints/reader/stores/ebook-session'
import { useReaderStore } from '../entrypoints/reader/stores/reader'
import type { BookRecord } from '../src/core/types'

describe('ebook session store', () => {
  test('opens with normalized settings, clears stale reader data, and ignores stale snapshots', async () => {
    const fake = createFakePort()
    const useStore = createEbookSessionStore(fake.factory)
    const store = useStore(createPinia())

    await store.open(record('first.epub'), { flow: 'scrolled', fontSize: 99 })
    fake.emit(snapshot(1, {
      title: 'First title',
      chapter: 'First chapter',
      progress: 0.75,
      flow: 'scrolled',
      toc: [{ label: 'First chapter', href: '/6/2' }],
    }))

    await store.open(record('second.epub'), { flow: 'scrolled', fontSize: 99 })

    expect(fake.opens.at(-1)).toMatchObject({
      record: { id: 'second.epub', name: 'second.epub', format: 'epub' },
      settings: { flow: 'scrolled', fontSize: 20 },
    })
    expect(store.$state).toMatchObject({
      record: { id: 'second.epub', name: 'second.epub', format: 'epub' },
      title: '未命名书籍',
      chapter: '开始',
      progress: 0,
      toc: [],
      flow: 'scrolled',
      generation: 2,
    })

    fake.emit(snapshot(1, { title: 'Stale title', chapter: 'Stale chapter', progress: 0.9 }))

    expect(store.title).toBe('未命名书籍')
    expect(store.chapter).toBe('开始')
    expect(store.progress).toBe(0)
  })

  test('forwards session commands once and projects emitted snapshots into Pinia', async () => {
    const fake = createFakePort()
    const useStore = createEbookSessionStore(fake.factory)
    const store = useStore(createPinia())

    await store.open(record('commands.epub'), {})
    await store.navigate(-1)
    await store.goTo('/6/4')
    await store.setFlow('scrolled')
    fake.emit(snapshot(1, { title: 'Commands', chapter: 'Second chapter', progress: 0.5, flow: 'scrolled' }))
    await store.flushProgress()
    await store.close()

    expect(fake.calls).toEqual(['open', 'navigate:-1', 'goTo:/6/4', 'setFlow:scrolled', 'flushProgress', 'close'])
    expect(store.$state).toMatchObject({
      record: null,
      title: '未命名书籍',
      chapter: '开始',
      progress: 0,
      toc: [],
      status: 'idle',
    })
  })

  test('rejects same-generation callbacks from a port replaced by another port', async () => {
    const first = createFakePort()
    const second = createFakePort()
    const useStore = createEbookSessionStore()
    const store = useStore(createPinia())

    store.attachPort(first.factory)
    await store.open(record('replacement.epub'), {})
    first.emit(snapshot(1, { title: 'First port', chapter: 'First chapter', progress: 0.2 }))
    store.attachPort(second.factory)
    second.emit(snapshot(1, { title: 'Second port', chapter: 'Second chapter', progress: 0.8 }))

    first.emit(snapshot(1, { title: 'Late first port', chapter: 'Late chapter', progress: 0.1 }))
    first.emitError({ code: 'render', message: 'late first error' }, 1)

    expect(store.$state).toMatchObject({
      status: 'ready',
      title: 'Second port',
      chapter: 'Second chapter',
      progress: 0.8,
      error: null,
    })
  })

  test('preserves the current reader projection when a current-generation error arrives', async () => {
    const fake = createFakePort()
    const useStore = createEbookSessionStore(fake.factory)
    const pinia = createPinia()
    const store = useStore(pinia)
    const reader = useReaderStore(pinia)
    const currentToc = [{ label: 'Current chapter', href: '/6/4' }]

    await store.open(record('error.epub'), {})
    fake.emit(snapshot(1, {
      title: 'Current title',
      toc: currentToc,
      chapter: 'Current chapter',
      progress: 0.4,
      flow: 'scrolled',
    }))
    fake.emitError({ code: 'render', message: 'Cannot render chapter' }, 1)

    expect(store.$state).toMatchObject({
      status: 'error',
      error: { code: 'render', message: 'Cannot render chapter' },
      title: 'Current title',
      toc: currentToc,
      chapter: 'Current chapter',
      progress: 0.4,
      flow: 'scrolled',
    })
    expect(reader.$state).toMatchObject({
      title: 'Current title',
      chapter: 'Current chapter',
      progress: 0.4,
      isReading: false,
    })
  })

  test('copies nested TOC snapshots so adapter mutation cannot change Pinia state', async () => {
    const fake = createFakePort()
    const useStore = createEbookSessionStore(fake.factory)
    const store = useStore(createPinia())
    const emittedToc: EbookSessionTocItem[] = [{
      label: 'Top level',
      href: '/6/2',
      subitems: [{ label: 'Nested level', href: '/6/4' }],
    }]

    await store.open(record('toc.epub'), {})
    fake.emit(snapshot(1, { toc: emittedToc }))
    const topLevel = emittedToc[0]!
    const nestedLevel = topLevel.subitems![0]!
    topLevel.label = 'Mutated top level'
    nestedLevel.label = 'Mutated nested level'

    expect(store.toc).toEqual([{
      label: 'Top level',
      href: '/6/2',
      subitems: [{ label: 'Nested level', href: '/6/4' }],
    }])
  })
})

function createFakePort() {
  let callbacks: EbookSessionCallbacks | null = null
  const calls: string[] = []
  const opens: Array<{ record: BookRecord, settings: Record<string, unknown> }> = []
  const port: EbookSessionPort = {
    async open(record, settings) {
      calls.push('open')
      opens.push({ record, settings })
    },
    async close() { calls.push('close') },
    async goTo(target) { calls.push(`goTo:${String(target)}`) },
    async navigate(direction) { calls.push(`navigate:${direction}`) },
    async setFlow(flow) { calls.push(`setFlow:${flow}`) },
    async applySettings() {},
    async flushProgress() { calls.push('flushProgress') },
    destroy() {},
  }

  const factory: EbookSessionPortFactory = nextCallbacks => {
    callbacks = nextCallbacks
    return port
  }

  return {
    calls,
    factory,
    opens,
    emit(next: EbookSessionSnapshot) {
      callbacks?.onSnapshot(next)
    },
    emitError(error: { code: 'format' | 'parse' | 'restore' | 'render', message: string }, generation: number) {
      callbacks?.onError(error, generation)
    },
  }
}

function record(name: string): BookRecord {
  return {
    id: name,
    name,
    type: 'application/epub+zip',
    size: 4,
    lastModified: 1,
    format: 'epub',
    blob: new Blob(['book']),
    openedAt: 1,
  }
}

function snapshot(generation: number, overrides: Partial<EbookSessionSnapshot> = {}): EbookSessionSnapshot {
  return {
    status: 'ready',
    title: 'Untitled',
    toc: [],
    chapter: '开始',
    progress: 0,
    flow: 'paginated',
    error: null,
    generation,
    ...overrides,
  }
}
