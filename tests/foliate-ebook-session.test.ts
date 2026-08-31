import { describe, expect, test } from 'vitest'
import { createFoliateEbookSession } from '../entrypoints/reader/foliate-ebook-session'
import type { EbookSessionSnapshot } from '../entrypoints/reader/ebook-session-port'
import type { BookRecord } from '../src/core/types'

describe('Foliate ebook session', () => {
  test('applies paginated renderer settings before restoring saved progress', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)

    await session.open(record('ordered.epub', {
      kind: 'ebook', cfi: 'epubcfi(/6/4)', fraction: 0.3,
    }), readerSettings())

    expect(harness.events).toEqual(expect.arrayContaining([
      'host:append',
      'view:open:4',
      'renderer:attribute:flow=paginated',
      'renderer:styles',
      'view:goTo:epubcfi(/6/4)',
    ]))
    expect(harness.events.indexOf('renderer:attribute:flow=paginated'))
      .toBeLessThan(harness.events.indexOf('view:goTo:epubcfi(/6/4)'))
    expect(harness.events.indexOf('renderer:styles'))
      .toBeLessThan(harness.events.indexOf('view:goTo:epubcfi(/6/4)'))
    expect(harness.view.renderer.attributes).toMatchObject({
      flow: 'paginated',
      animated: '',
      margin: '64px',
      gap: '7%',
      'max-inline-size': '760px',
      'max-column-count': '2',
    })
    expect(harness.view.renderer.styles).toContain('font-size: 20px')
    expect(harness.snapshots.map(snapshot => snapshot.status)).toEqual(['loading', 'ready'])
    expect(harness.snapshots.at(-1)).toMatchObject({
      title: 'Engine title',
      toc: [{ label: 'Chapter one', href: '/6/2' }],
      flow: 'paginated',
      generation: 1,
    })
  })

  test('normalizes relocate snapshots and schedules one ebook progress write', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    await session.open(record('relocate.epub'), readerSettings())
    harness.snapshots.length = 0

    harness.view.relocate({
      cfi: 'epubcfi(/6/8)',
      fraction: 1.4,
      tocItem: { label: [{ name: 'Part one' }, { name: 'Chapter two' }] },
    })

    expect(harness.snapshots).toHaveLength(1)
    expect(harness.snapshots[0]).toMatchObject({
      chapter: 'Part one、Chapter two',
      progress: 1,
      status: 'ready',
    })
    expect(harness.progress.scheduled).toEqual([{
      bookId: 'relocate.epub',
      progress: { kind: 'ebook', cfi: 'epubcfi(/6/8)', fraction: 1 },
    }])
  })

  test('preserves a CFI entering scrolled flow and a fraction returning to pages', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    await session.open(record('flow.epub'), readerSettings())
    harness.view.lastLocation = { cfi: 'epubcfi(/6/10)', fraction: 0.45 }

    await session.setFlow('scrolled')

    expect(harness.scroller.mountTargets).toEqual([
      { cfi: 'epubcfi(/6/10)', fraction: 0.45 },
    ])
    expect(harness.view.style.display).toBe('none')

    harness.scroller.location = { cfi: null, fraction: 0.62 }
    await session.setFlow('paginated')

    expect(harness.scroller.destroyCalls).toBe(1)
    expect(harness.view.style.display).toBe('')
    expect(harness.view.fractionTargets).toEqual([0.62])
    expect(harness.snapshots.at(-1)).toMatchObject({ flow: 'paginated', progress: 0.62 })
  })

  test('close flushes before destroying owned resources and is idempotent', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    await session.open(record('close.epub'), readerSettings({ flow: 'scrolled' }))
    harness.events.length = 0

    await session.close()
    await session.close()

    expect(harness.events).toEqual([
      'progress:flush',
      'scroller:destroy',
      'view:close',
      'view:remove',
    ])
    expect(harness.progress.flushCalls).toBe(1)
    expect(harness.scroller.destroyCalls).toBe(1)
    expect(harness.view.closeCalls).toBe(1)
    expect(harness.view.removeCalls).toBe(1)
  })

  test('keeps generation aligned when an already closed session is closed again', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    await session.open(record('first.epub'), readerSettings())
    await session.close()
    await session.close()

    await session.open(record('second.epub'), readerSettings())

    expect(harness.snapshots.at(-1)).toMatchObject({
      status: 'ready',
      title: 'Engine title',
      generation: 4,
    })
  })

  test('reports an initial scroller mount failure once for the active generation', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    harness.failNextScrollerMount(new Error('continuous mount failed'))

    await session.open(record('mount-error.epub'), readerSettings({ flow: 'scrolled' }))

    expect(harness.errors).toEqual([{
      error: { code: 'render', message: 'continuous mount failed' },
      generation: 1,
    }])
    expect(harness.scroller.destroyCalls).toBe(1)
    expect(harness.view.closeCalls).toBe(1)
  })

  test('ignores relocate events from a view superseded by a newer open', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    await session.open(record('first.epub'), readerSettings())
    const staleView = harness.views[0]!
    await session.open(record('second.epub'), readerSettings())
    harness.snapshots.length = 0
    harness.progress.scheduled.length = 0

    staleView.relocate({
      cfi: 'epubcfi(/6/99)',
      fraction: 0.99,
      tocItem: { label: 'Stale chapter' },
    })

    expect(harness.snapshots).toEqual([])
    expect(harness.progress.scheduled).toEqual([])
  })
})

function createHarness() {
  const events: string[] = []
  const snapshots: EbookSessionSnapshot[] = []
  const errors: Array<{ error: unknown, generation: number }> = []
  const views: FakeView[] = []
  const scrollers: FakeScroller[] = []
  const progress = new FakeProgressService(events)
  let generation = 0
  let nextScrollerMountError: Error | null = null

  const dependencies = {
    host: {
      append(view: FakeView) {
        events.push('host:append')
        view.isConnected = true
      },
    } as unknown as HTMLElement,
    createView() {
      const view = new FakeView(events)
      views.push(view)
      return view
    },
    createScroller() {
      const scroller = new FakeScroller(events, nextScrollerMountError)
      nextScrollerMountError = null
      scrollers.push(scroller)
      return scroller
    },
    createProgressService: () => progress,
    onSnapshot: (snapshot: EbookSessionSnapshot) => snapshots.push(snapshot),
    onError: (error: unknown, nextGeneration: number) => errors.push({ error, generation: nextGeneration }),
    nextGeneration: () => ++generation,
  }

  return {
    dependencies,
    errors,
    events,
    progress,
    snapshots,
    failNextScrollerMount(error: Error) { nextScrollerMountError = error },
    get scroller() { return scrollers.at(-1)! },
    get view() { return views.at(-1)! },
    views,
  }
}

class FakeRenderer {
  attributes: Record<string, string> = {}
  styles = ''

  constructor(private readonly events: string[]) {}

  setAttribute(name: string, value: string) {
    this.attributes[name] = value
    this.events.push(`renderer:attribute:${name}=${value}`)
  }

  setStyles(styles: string) {
    this.styles = styles
    this.events.push('renderer:styles')
  }
}

class FakeStyle {
  display = ''

  setProperty(name: string, value: string) {
    if (name === 'display') this.display = value
  }

  removeProperty(name: string) {
    if (name === 'display') this.display = ''
    return ''
  }
}

class FakeView extends EventTarget {
  readonly renderer: FakeRenderer
  readonly style = new FakeStyle()
  readonly targets: unknown[] = []
  readonly fractionTargets: number[] = []
  readonly book = {
    metadata: { title: 'Engine title' },
    toc: [{ label: 'Chapter one', href: '/6/2' }],
    sections: [{ linear: 'yes' }],
  }
  isConnected = false
  lastLocation: FakeLocation | null = null
  closeCalls = 0
  removeCalls = 0

  constructor(private readonly events: string[]) {
    super()
    this.renderer = new FakeRenderer(events)
  }

  async open(blob: Blob) {
    this.events.push(`view:open:${blob.size}`)
  }

  async goTo(target: unknown) {
    this.targets.push(target)
    this.lastLocation = { cfi: String(target), fraction: this.lastLocation?.fraction ?? 0 }
    this.events.push(`view:goTo:${String(target)}`)
  }

  async goToFraction(fraction: number) {
    this.fractionTargets.push(fraction)
    this.lastLocation = { cfi: null, fraction }
    this.events.push(`view:goToFraction:${fraction}`)
  }

  async goToTextStart() {
    this.lastLocation = { cfi: 'epubcfi(/6/2)', fraction: 0 }
    this.events.push('view:goToTextStart')
  }

  async goLeft() {}
  async goRight() {}

  relocate(detail: FakeLocation) {
    this.lastLocation = detail
    this.dispatchEvent(new CustomEvent('relocate', { detail }))
  }

  close() {
    this.closeCalls += 1
    this.events.push('view:close')
  }

  remove() {
    this.removeCalls += 1
    this.isConnected = false
    this.events.push('view:remove')
  }
}

class FakeScroller extends EventTarget {
  destroyCalls = 0
  location: FakeLocation | null = null
  mountTargets: unknown[] = []

  constructor(
    private readonly events: string[],
    private readonly mountError: Error | null,
  ) {
    super()
  }

  async mount(target: unknown) {
    this.mountTargets.push(target)
    if (this.mountError) throw this.mountError
    this.location = target as FakeLocation | null
    this.events.push('scroller:mount')
  }

  currentLocation() { return this.location }
  async goTo() {}
  async goToFraction() {}
  async scrollByPage() {}
  setStyles() {}

  destroy() {
    this.destroyCalls += 1
    this.events.push('scroller:destroy')
  }
}

class FakeProgressService {
  flushCalls = 0
  readonly scheduled: Array<{ bookId: string, progress: unknown }> = []

  constructor(private readonly events: string[]) {}

  schedule(bookId: string, progress: unknown) {
    this.scheduled.push({ bookId, progress })
    return true
  }

  async flush() {
    this.flushCalls += 1
    this.events.push('progress:flush')
    return true
  }

  cancel() {}
}

interface FakeLocation {
  cfi?: string | null
  fraction?: number
  tocItem?: { label?: unknown }
}

function record(name: string, progress?: BookRecord['progress']): BookRecord {
  return {
    id: name,
    name,
    type: 'application/epub+zip',
    size: 4,
    lastModified: 1,
    format: 'epub',
    blob: new Blob(['book']),
    openedAt: 1,
    progress,
  }
}

function readerSettings(overrides: Record<string, unknown> = {}) {
  return {
    theme: 'paper',
    flow: 'paginated',
    font: 'serif',
    fontSize: 20,
    lineHeight: 1.75,
    pageWidth: 760,
    ...overrides,
  }
}
