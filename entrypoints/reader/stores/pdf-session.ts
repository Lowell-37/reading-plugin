import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type { BookRecord } from '../../../src/core/types'
import type {
  PdfOutlineItem,
  PdfSessionCallbacks,
  PdfSessionError,
  PdfSessionPort,
  PdfSessionPortFactory,
  PdfSessionSnapshot,
  PdfSessionStatus,
} from '../pdf-session-port'
import type { ReaderSettings } from '../legacy-reader-port'
import { useReaderStore } from './reader'

export type PdfSessionRecord = Pick<BookRecord, 'id' | 'name' | 'format'>

const initialSnapshot = (generation: number): PdfSessionSnapshot => ({
  status: 'idle',
  title: '未命名 PDF',
  outline: [],
  page: 1,
  pageCount: 0,
  zoom: 1,
  progress: 0,
  error: null,
  generation,
})

export function createPdfSessionStore(initialPortFactory?: PdfSessionPortFactory) {
  return defineStore('pdf-session', () => {
    const record = shallowRef<PdfSessionRecord | null>(null)
    const status = shallowRef<PdfSessionStatus>('idle')
    const title = shallowRef('未命名 PDF')
    const outline = shallowRef<PdfOutlineItem[]>([])
    const page = shallowRef(1)
    const pageCount = shallowRef(0)
    const zoom = shallowRef(1)
    const progress = shallowRef(0)
    const error = shallowRef<PdfSessionError | null>(null)
    const generation = shallowRef(0)
    let port: PdfSessionPort | null = null
    let portEpoch = 0

    function callbacksFor(epoch: number): PdfSessionCallbacks {
      return {
        onSnapshot(snapshot) {
          if (epoch !== portEpoch || snapshot.generation !== generation.value) return
          applySnapshot(snapshot)
        },
        onError(nextError, snapshotGeneration) {
          if (epoch !== portEpoch || snapshotGeneration !== generation.value) return
          applySnapshot({
            status: 'error',
            title: title.value,
            outline: outline.value,
            page: page.value,
            pageCount: pageCount.value,
            zoom: zoom.value,
            progress: progress.value,
            error: { ...nextError },
            generation: snapshotGeneration,
          })
        },
      }
    }

    function applySnapshot(snapshot: PdfSessionSnapshot) {
      status.value = snapshot.status
      title.value = snapshot.title
      outline.value = copyOutline(snapshot.outline)
      page.value = snapshot.page
      pageCount.value = snapshot.pageCount
      zoom.value = snapshot.zoom
      progress.value = snapshot.progress
      error.value = snapshot.error ? { ...snapshot.error } : null
      useReaderStore().applyPdfSessionSnapshot({
        ...snapshot,
        outline: outline.value,
        error: error.value,
      })
    }

    function reset(nextGeneration: number) {
      record.value = null
      applySnapshot(initialSnapshot(nextGeneration))
    }

    function attachPort(portFactory: PdfSessionPortFactory | null) {
      portEpoch += 1
      port?.destroy()
      port = portFactory?.(callbacksFor(portEpoch)) ?? null
    }

    async function open(nextRecord: BookRecord, settings: ReaderSettings) {
      generation.value += 1
      reset(generation.value)
      record.value = { id: nextRecord.id, name: nextRecord.name, format: nextRecord.format }
      status.value = 'loading'
      useReaderStore().applyPdfSessionSnapshot({ ...initialSnapshot(generation.value), status: 'loading' })
      await port?.open(nextRecord, settings)
    }

    async function close() {
      const closingPort = port
      const closingEpoch = portEpoch
      const closingGeneration = generation.value + 1
      generation.value = closingGeneration
      await closingPort?.close()
      if (port === closingPort && portEpoch === closingEpoch && generation.value === closingGeneration) {
        reset(closingGeneration)
      }
    }

    async function goTo(nextPage: number) {
      await port?.goTo(nextPage)
    }

    async function navigate(direction: -1 | 1) {
      await port?.navigate(direction)
    }

    async function setZoom(nextZoom: number) {
      await port?.setZoom(nextZoom)
    }

    async function flushProgress() {
      await port?.flushProgress()
    }

    function destroy() {
      port?.destroy()
      port = null
      generation.value += 1
      reset(generation.value)
    }

    attachPort(initialPortFactory ?? null)

    return {
      record,
      status,
      title,
      outline,
      page,
      pageCount,
      zoom,
      progress,
      error,
      generation,
      attachPort,
      open,
      close,
      goTo,
      navigate,
      setZoom,
      flushProgress,
      destroy,
    }
  })
}

export const usePdfSessionStore = createPdfSessionStore()

function copyOutline(items: PdfOutlineItem[]): PdfOutlineItem[] {
  return items.map(item => ({
    label: item.label,
    page: item.page,
    ...(item.children ? { children: copyOutline(item.children) } : {}),
  }))
}
