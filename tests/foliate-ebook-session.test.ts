import { describe, expect, test } from 'vitest'
import { createFoliateEbookSession } from '../entrypoints/reader/foliate-ebook-session'
import type { EbookSessionError, EbookSessionSnapshot } from '../entrypoints/reader/ebook-session-port'
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
      error: expectedSessionError('render', 'continuous mount failed'),
      generation: 1,
    }])
    expect(harness.scroller.destroyCalls).toBe(1)
    expect(harness.view.closeCalls).toBe(1)
  })

  test('maps hostile engine failures to safe presentation while retaining diagnostics', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    const rawEngineMessage = 'engine says <script>steal()</script> while parsing chapter 7'
    harness.failNextOpenStage('view-open', new Error(rawEngineMessage))

    await session.open(record('hostile.epub'), readerSettings())

    expect(harness.errors).toEqual([{
      error: {
        code: 'parse',
        title: '无法解析这本书',
        detail: '文件内容无法解析。请确认文件完整后重试。',
        diagnostic: rawEngineMessage,
      },
      generation: 1,
    }])
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

  test('destroy during a suspended view open prevents a later ready snapshot', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    const openGate = deferred<void>()
    const openStarted = harness.deferNextViewOpen(openGate.promise)

    const opening = session.open(record('suspended.epub'), readerSettings())
    await openStarted
    session.destroy()
    openGate.resolve()
    await opening

    expect(harness.snapshots.map(snapshot => snapshot.status)).toEqual(['loading'])
    expect(harness.view.closeCalls).toBe(1)
    expect(harness.view.removeCalls).toBe(1)
  })

  test('destroy while a prior-session flush is suspended prevents the waiting open from creating a view', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    await session.open(record('first.epub'), readerSettings())
    const flushGate = deferred<boolean>()
    const flushStarted = harness.progress.enqueueFlush(flushGate.promise)

    const opening = session.open(record('second.epub'), readerSettings())
    await flushStarted
    session.destroy()
    flushGate.resolve(true)
    await opening

    expect(harness.views).toHaveLength(1)
    expect(harness.snapshots.map(snapshot => snapshot.generation)).toEqual([1, 1])
  })

  test('a rejected destroy flush cannot report an error to a newer session', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    await session.open(record('old.epub'), readerSettings())
    const flushGate = deferred<boolean>()
    const flushStarted = harness.progress.enqueueFlush(flushGate.promise)

    session.destroy()
    await flushStarted
    await session.open(record('new.epub'), readerSettings())
    flushGate.reject(new Error('old flush failed'))
    await Promise.resolve()

    expect(harness.errors).toEqual([])
    expect(harness.snapshots.at(-1)).toMatchObject({ status: 'ready', generation: 3 })
  })

  test('the latest flow request wins when pagination is requested during a suspended mount', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    await session.open(record('latest-flow.epub'), readerSettings())
    const mountGate = deferred<void>()
    const mountStarted = harness.deferNextScrollerMount(mountGate.promise)

    const scrolling = session.setFlow('scrolled')
    await mountStarted
    const paginating = session.setFlow('paginated')
    mountGate.resolve()
    await Promise.all([scrolling, paginating])

    expect(harness.snapshots.at(-1)).toMatchObject({ flow: 'paginated' })
    expect(harness.view.style.display).toBe('')
    expect(harness.scroller.destroyCalls).toBe(1)
  })

  test.each([
    ['setFlow', (session: ReturnType<typeof createFoliateEbookSession>) => session.setFlow('paginated')],
    ['applySettings', (session: ReturnType<typeof createFoliateEbookSession>) => (
      session.applySettings(readerSettings({ flow: 'paginated' }))
    )],
  ] as const)('%s reverses a deferred initial scrolled mount before it can commit', async (
    _operation,
    requestPaginated,
  ) => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    const mountGate = deferred<void>()
    const mountStarted = harness.deferNextScrollerMount(mountGate.promise)

    const opening = session.open(
      record('initial-flow-race.epub'),
      readerSettings({ flow: 'scrolled' }),
    )
    await mountStarted
    const staleScroller = harness.scroller
    const reversing = requestPaginated(session)
    mountGate.resolve()
    await Promise.all([opening, reversing])
    await session.navigate(1)

    expect(harness.snapshots.at(-1)).toMatchObject({ status: 'ready', flow: 'paginated' })
    expect(harness.view.style.display).toBe('')
    expect(staleScroller.destroyCalls).toBe(1)
    expect(harness.view.rightCalls).toBe(1)
  })

  test.each([
    ['setFlow', (session: ReturnType<typeof createFoliateEbookSession>, flow: 'paginated' | 'scrolled') => (
      session.setFlow(flow)
    )],
    ['applySettings', (session: ReturnType<typeof createFoliateEbookSession>, flow: 'paginated' | 'scrolled') => (
      session.applySettings(readerSettings({ flow }))
    )],
  ] as const)('%s fulfills a final scrolled request after invalidating a deferred initial mount', async (
    _operation,
    requestFlow,
  ) => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    const mountGate = deferred<void>()
    const mountStarted = harness.deferNextScrollerMount(mountGate.promise)

    const opening = session.open(
      record('overlapping-initial-flow.epub'),
      readerSettings({ flow: 'scrolled' }),
    )
    await mountStarted
    const staleScroller = harness.scroller
    await requestFlow(session, 'paginated')
    await requestFlow(session, 'scrolled')
    mountGate.resolve()
    await opening
    await session.navigate(1)

    expect(harness.snapshots.at(-1)).toMatchObject({ status: 'ready', flow: 'scrolled' })
    expect(harness.view.style.display).toBe('none')
    expect(harness.scrollers).toHaveLength(2)
    expect(staleScroller.destroyCalls).toBe(1)
    expect(harness.scrollers[1]?.destroyCalls).toBe(0)
    expect(harness.scrollers[1]?.pageDirections).toEqual([1])
  })

  test('close and reopen own teardown when they supersede a suspended scroller mount', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    await session.open(record('old.epub'), readerSettings())
    const mountGate = deferred<void>()
    const mountStarted = harness.deferNextScrollerMount(mountGate.promise)
    const scrolling = session.setFlow('scrolled')
    await mountStarted
    const staleScroller = harness.scroller

    await session.close()
    await session.open(record('new.epub'), readerSettings())
    mountGate.resolve()
    await scrolling

    expect(staleScroller.destroyCalls).toBe(1)
    expect(harness.snapshots.at(-1)).toMatchObject({ status: 'ready', generation: 3 })
  })

  test.each([
    ['CFI', { cfi: 'epubcfi(/6/12)', fraction: 0.5 }, 'goTo'],
    ['fraction', { cfi: null, fraction: 0.5 }, 'goToFraction'],
  ] as const)('a rejected %s restoration still leaves a consistent paginated session', async (
    _label,
    location,
    failingMethod,
  ) => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    await session.open(record('restore-error.epub'), readerSettings({ flow: 'scrolled' }))
    const scroller = harness.scroller
    scroller.location = location
    harness.view.failNextNavigation(failingMethod, new Error('page restore failed'))

    await expect(session.setFlow('paginated')).rejects.toThrow('page restore failed')
    await session.navigate(1)

    expect(harness.errors.at(-1)).toEqual({
      error: expectedSessionError('restore', 'page restore failed'),
      generation: 1,
    })
    expect(harness.snapshots.at(-1)).toMatchObject({ flow: 'paginated', progress: 0.5 })
    expect(harness.view.style.display).toBe('')
    expect(scroller.destroyCalls).toBe(1)
    expect(harness.view.rightCalls).toBe(1)
  })

  test.each([
    ['create-view', 'render', 0, 0],
    ['append', 'render', 1, 1],
    ['listener', 'render', 1, 1],
    ['view-open', 'parse', 1, 1],
    ['settings', 'render', 1, 1],
    ['restore', 'restore', 1, 1],
  ] as const)('a %s failure emits one classified error and cleans partial resources', async (
    stage,
    code,
    expectedViews,
    expectedCloses,
  ) => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    harness.failNextOpenStage(stage, new Error(`${stage} failed`))

    await session.open(record('setup-error.epub'), readerSettings())

    expect(harness.errors).toEqual([{
      error: expectedSessionError(code, `${stage} failed`),
      generation: 1,
    }])
    expect(harness.views).toHaveLength(expectedViews)
    if (expectedViews) {
      expect(harness.view.closeCalls).toBe(expectedCloses)
      expect(harness.view.removeCalls).toBe(expectedCloses)
    }
    expect(harness.snapshots.filter(snapshot => snapshot.status === 'ready')).toEqual([])
  })

  test('a prior-session flush failure is contained by the new open boundary', async () => {
    const harness = createHarness()
    const session = createFoliateEbookSession(harness.dependencies)
    await session.open(record('old.epub'), readerSettings())
    harness.progress.enqueueFlush(Promise.reject(new Error('prior flush failed')))

    await session.open(record('new.epub'), readerSettings())

    expect(harness.errors).toEqual([{
      error: expectedSessionError('render', 'prior flush failed'),
      generation: 2,
    }])
    expect(harness.views).toHaveLength(1)
    expect(harness.views[0]!.closeCalls).toBe(1)
    expect(harness.snapshots.filter(snapshot => snapshot.generation === 2)).toEqual([])
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
  let nextScrollerMountPromise: Promise<void> | null = null
  let nextScrollerMountStarted: (() => void) | null = null
  let nextViewOpenPromise: Promise<void> | null = null
  let nextViewOpenStarted: (() => void) | null = null
  let nextOpenFailure: { stage: OpenFailureStage, error: Error } | null = null

  const dependencies = {
    host: {
      append(view: FakeView) {
        if (nextOpenFailure?.stage === 'append') {
          const { error } = nextOpenFailure
          nextOpenFailure = null
          throw error
        }
        events.push('host:append')
        view.isConnected = true
      },
    } as unknown as HTMLElement,
    createView() {
      if (nextOpenFailure?.stage === 'create-view') {
        const { error } = nextOpenFailure
        nextOpenFailure = null
        throw error
      }
      const view = new FakeView(events, {
        listenerError: consumeOpenFailure('listener'),
        openError: consumeOpenFailure('view-open'),
        openPromise: nextViewOpenPromise,
        openStarted: nextViewOpenStarted,
        restoreError: consumeOpenFailure('restore'),
        settingsError: consumeOpenFailure('settings'),
      })
      nextViewOpenPromise = null
      nextViewOpenStarted = null
      views.push(view)
      return view
    },
    createScroller() {
      const scroller = new FakeScroller(
        events,
        nextScrollerMountError,
        nextScrollerMountPromise,
        nextScrollerMountStarted,
      )
      nextScrollerMountError = null
      nextScrollerMountPromise = null
      nextScrollerMountStarted = null
      scrollers.push(scroller)
      return scroller
    },
    createProgressService: () => progress,
    onSnapshot: (snapshot: EbookSessionSnapshot) => snapshots.push(snapshot),
    onError: (error: unknown, nextGeneration: number) => errors.push({ error, generation: nextGeneration }),
    nextGeneration: () => ++generation,
  }

  function consumeOpenFailure(stage: OpenFailureStage): Error | null {
    if (nextOpenFailure?.stage !== stage) return null
    const { error } = nextOpenFailure
    nextOpenFailure = null
    return error
  }

  return {
    dependencies,
    errors,
    events,
    progress,
    snapshots,
    deferNextScrollerMount(promise: Promise<void>) {
      const started = deferred<void>()
      nextScrollerMountPromise = promise
      nextScrollerMountStarted = () => started.resolve()
      return started.promise
    },
    deferNextViewOpen(promise: Promise<void>) {
      const started = deferred<void>()
      nextViewOpenPromise = promise
      nextViewOpenStarted = () => started.resolve()
      return started.promise
    },
    failNextScrollerMount(error: Error) { nextScrollerMountError = error },
    failNextOpenStage(stage: OpenFailureStage, error: Error) { nextOpenFailure = { stage, error } },
    get scroller() { return scrollers.at(-1)! },
    get view() { return views.at(-1)! },
    scrollers,
    views,
  }
}

type OpenFailureStage = 'create-view' | 'append' | 'listener' | 'view-open' | 'settings' | 'restore'

class FakeRenderer {
  attributes: Record<string, string> = {}
  styles = ''

  constructor(
    private readonly events: string[],
    private settingsError: Error | null = null,
  ) {}

  setAttribute(name: string, value: string) {
    if (this.settingsError) {
      const error = this.settingsError
      this.settingsError = null
      throw error
    }
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
  rightCalls = 0
  private listenerError: Error | null
  private readonly navigationFailures = new Map<string, Error>()

  constructor(
    private readonly events: string[],
    private readonly options: {
      listenerError: Error | null
      openError: Error | null
      openPromise: Promise<void> | null
      openStarted: (() => void) | null
      restoreError: Error | null
      settingsError: Error | null
    } = {
      listenerError: null,
      openError: null,
      openPromise: null,
      openStarted: null,
      restoreError: null,
      settingsError: null,
    },
  ) {
    super()
    this.listenerError = options.listenerError
    this.renderer = new FakeRenderer(events, options.settingsError)
    if (options.restoreError) this.navigationFailures.set('goToTextStart', options.restoreError)
  }

  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
    if (type === 'relocate' && this.listenerError) {
      const error = this.listenerError
      this.listenerError = null
      throw error
    }
    super.addEventListener(type, callback, options)
  }

  async open(blob: Blob) {
    this.events.push(`view:open:${blob.size}`)
    this.options.openStarted?.()
    if (this.options.openPromise) await this.options.openPromise
    if (this.options.openError) throw this.options.openError
  }

  async goTo(target: unknown) {
    this.throwNavigationFailure('goTo')
    this.targets.push(target)
    this.lastLocation = { cfi: String(target), fraction: this.lastLocation?.fraction ?? 0 }
    this.events.push(`view:goTo:${String(target)}`)
  }

  async goToFraction(fraction: number) {
    this.throwNavigationFailure('goToFraction')
    this.fractionTargets.push(fraction)
    this.lastLocation = { cfi: null, fraction }
    this.events.push(`view:goToFraction:${fraction}`)
  }

  async goToTextStart() {
    this.throwNavigationFailure('goToTextStart')
    this.lastLocation = { cfi: 'epubcfi(/6/2)', fraction: 0 }
    this.events.push('view:goToTextStart')
  }

  async goLeft() {}
  async goRight() { this.rightCalls += 1 }

  failNextNavigation(method: string, error: Error) {
    this.navigationFailures.set(method, error)
  }

  private throwNavigationFailure(method: string) {
    const error = this.navigationFailures.get(method)
    if (!error) return
    this.navigationFailures.delete(method)
    throw error
  }

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
  pageDirections: Array<-1 | 1> = []

  constructor(
    private readonly events: string[],
    private readonly mountError: Error | null,
    private readonly mountPromise: Promise<void> | null = null,
    private readonly mountStarted: (() => void) | null = null,
  ) {
    super()
  }

  async mount(target: unknown) {
    this.mountTargets.push(target)
    this.mountStarted?.()
    if (this.mountPromise) await this.mountPromise
    if (this.mountError) throw this.mountError
    this.location = target as FakeLocation | null
    this.events.push('scroller:mount')
  }

  currentLocation() { return this.location }
  async goTo() {}
  async goToFraction() {}
  async scrollByPage(direction: -1 | 1) { this.pageDirections.push(direction) }
  setStyles() {}

  destroy() {
    this.destroyCalls += 1
    this.events.push('scroller:destroy')
  }
}

class FakeProgressService {
  flushCalls = 0
  readonly scheduled: Array<{ bookId: string, progress: unknown }> = []
  private readonly flushResults: Array<{
    result: Promise<boolean>
    started: () => void
  }> = []

  constructor(private readonly events: string[]) {}

  schedule(bookId: string, progress: unknown) {
    this.scheduled.push({ bookId, progress })
    return true
  }

  async flush() {
    this.flushCalls += 1
    this.events.push('progress:flush')
    const queued = this.flushResults.shift()
    if (queued) {
      queued.started()
      return await queued.result
    }
    return true
  }

  enqueueFlush(result: Promise<boolean>) {
    const started = deferred<void>()
    this.flushResults.push({ result, started: () => started.resolve() })
    return started.promise
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

function expectedSessionError(
  code: EbookSessionError['code'],
  diagnostic: string,
): EbookSessionError {
  const presentation = {
    format: {
      title: '不支持这个文件',
      detail: '请确认文件格式为 EPUB、MOBI 或 AZW3 后重试。',
    },
    parse: {
      title: '无法解析这本书',
      detail: '文件内容无法解析。请确认文件完整后重试。',
    },
    restore: {
      title: '无法恢复阅读位置',
      detail: '已保留这本书，请重新打开后从开头继续阅读。',
    },
    render: {
      title: '无法显示这本书',
      detail: '阅读视图无法建立。请重新打开书籍后重试。',
    },
  }[code]
  return { code, ...presentation, diagnostic }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
