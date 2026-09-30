import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { filterAnnotations, sortAnnotations, updateAnnotation } from '../../../src/core/annotations'
import { mergeAnnotationImports } from '../../../src/core/annotation-import'
import { recoverTextAnchor } from '../../../src/core/anchor-recovery'
import type { Annotation, BookRecord } from '../../../src/core/types'
import {
  clearPdfAnnotationOverlays,
  createPdfAnnotationFromRange,
  renderPdfAnnotationOverlays,
  type CreatePdfAnnotationFromRangeOptions,
} from '../pdf-annotations'

type Repository = { update(id: string, changes: Pick<BookRecord, 'annotations'>): Promise<void> }
type Session = { record: BookRecord | null, generation: number, zoom: number, root: ParentNode | null }
let configuredRepository: Repository | null = null

export function configurePdfAnnotationRepository(repository: Repository | null) {
  configuredRepository = repository
}

export function createPdfAnnotationStore({ repository }: { repository?: Repository } = {}) {
  return defineStore('pdf-annotations', () => {
    const annotations = shallowRef<Annotation[]>([])
    const recordId = shallowRef<string | null>(null)
    const generation = shallowRef(0)
    const zoom = shallowRef(1)
    const root = shallowRef<ParentNode | null>(null)
    const error = shallowRef<string | null>(null)
    const query = shallowRef('')
    const type = shallowRef<'all' | 'notes' | 'highlights' | 'pdf' | 'ebook'>('all')
    const sort = shallowRef<'newest' | 'oldest' | 'location'>('newest')
    const selected = shallowRef<string[]>([])
    const visible = computed(() => sortAnnotations(filterAnnotations(annotations.value, { query: query.value, type: type.value }), sort.value))
    const allAnnotations = computed(() => [...otherAnnotations, ...annotations.value])
    let otherAnnotations: Annotation[] = []
    let pendingRecovery = new Set<string>()
    let writeQueue: Promise<void> = Promise.resolve()
    const unsavedDrafts = new Map<string, Annotation[]>()
    let writeId = 0

    function synchronizeSession(session: Session) {
      const identityChanged = recordId.value !== session.record?.id || generation.value !== session.generation || root.value !== session.root
      const zoomChanged = zoom.value !== session.zoom
      if (identityChanged) clear()
      else if (zoomChanged && root.value) clearPdfAnnotationOverlays(root.value)
      recordId.value = session.record?.id ?? null
      generation.value = session.generation
      zoom.value = session.zoom
      root.value = session.root
      if (identityChanged) {
        const draft = session.record ? unsavedDrafts.get(session.record.id) : null
        const source = draft ?? session.record?.annotations ?? []
        annotations.value = source.filter(item => item.kind === 'pdf')
        otherAnnotations = source.filter(item => item.kind !== 'pdf')
        pendingRecovery = new Set(annotations.value.filter(item => item.anchor?.kind === 'pdf' && item.anchorStatus === 'unresolved').map(item => item.id))
        if (draft) error.value = '批注保存失败，可稍后重试'
        query.value = ''
        type.value = 'all'
        sort.value = 'newest'
      }
      renderAll()
      if (pendingRecovery.size) void recoverImported()
    }

    async function createFromSelection(options: CreatePdfAnnotationFromRangeOptions & { generation: number }) {
      if (options.generation !== generation.value || !recordId.value) return null
      const annotation = createPdfAnnotationFromRange(options)
      if (!annotation) return null
      annotations.value = [...annotations.value, annotation]
      renderAll()
      await persist(options.generation, recordId.value)
      return annotation
    }

    async function update(id: string, changes: { note?: unknown, tags?: unknown }) {
      annotations.value = updateAnnotation(annotations.value, id, changes)
      renderAll()
      await persist(generation.value, recordId.value)
    }

    async function remove(id: string) {
      annotations.value = annotations.value.filter(item => item.id !== id)
      selected.value = selected.value.filter(value => value !== id)
      renderAll()
      await persist(generation.value, recordId.value)
    }

    async function removeSelected() {
      const ids = new Set(selected.value)
      annotations.value = annotations.value.filter(item => !ids.has(item.id))
      selected.value = []
      renderAll()
      await persist(generation.value, recordId.value)
    }

    function renderPage(page: number) {
      if (!root.value) return
      if (pendingRecovery.size) void recoverImported()
      renderPdfAnnotationOverlays({ root: root.value, annotations: annotations.value, page, onResolved: (annotation, resolved) => {
        if (annotation.anchor?.kind !== 'pdf') return
        annotation.rects = resolved.rects
        annotation.anchor = { ...annotation.anchor, textOffset: resolved.textOffset }
        annotation.anchorStatus = 'resolved'
      } })
    }

    function renderAll() {
      if (!root.value) return
      renderPdfAnnotationOverlays({ root: root.value, annotations: annotations.value, onResolved: (annotation, resolved) => {
        if (annotation.anchor?.kind !== 'pdf') return
        annotation.rects = resolved.rects
        annotation.anchor = { ...annotation.anchor, textOffset: resolved.textOffset }
        annotation.anchorStatus = 'resolved'
      } })
    }

    async function importAnnotations(imported: Annotation[]) {
      const existing = [...otherAnnotations, ...annotations.value]
      const previous = new Map(existing.map(item => [item.id, item]))
      const result = mergeAnnotationImports(existing, imported)
      const changed = new Set(imported.flatMap(item => {
        const local = previous.get(item.id)
        return !local || (item.updatedAt ?? item.createdAt) > (local.updatedAt ?? local.createdAt) ? [item.id] : []
      }))
      otherAnnotations = result.annotations.filter(item => item.kind !== 'pdf')
      annotations.value = result.annotations.filter(item => item.kind === 'pdf').map(item => {
        if (!changed.has(item.id) || item.anchor?.kind !== 'pdf') return item
        pendingRecovery.add(item.id)
        return { ...item, anchorStatus: 'unresolved' as const, rects: [] }
      })
      await recoverImported(false)
      renderAll()
      await persist(generation.value, recordId.value)
      return result
    }

    async function recoverImported(save = true) {
      if (!root.value || !pendingRecovery.size) return
      const next = annotations.value.map(item => {
        if (!pendingRecovery.has(item.id) || item.anchor?.kind !== 'pdf') return item
        const origin = item.anchor.page
        const pages = [origin, origin - 1, origin + 1, origin - 2, origin + 2]
        const renderedCandidates = pages.flatMap(page => {
          if (page < 1) return []
          const element = root.value?.querySelector<HTMLElement>(`.pdf-page[data-page="${page}"][data-state="rendered"]`)
          const layer = element?.querySelector<HTMLElement>('.textLayer')
          return layer?.isConnected ? [{ location: page, text: layer.textContent || '', preferredOffset: page === origin ? item.anchor!.textOffset : null }] : []
        })
        // Keep the original page as the first candidate even when it is not
        // rendered, so duplicate quotes on neighboring pages remain ambiguous.
        const candidates = renderedCandidates[0]?.location === origin
          ? renderedCandidates
          : [{ location: origin, text: '', preferredOffset: item.anchor.textOffset }, ...renderedCandidates]
        const match = recoverTextAnchor(item.anchor.quote, candidates)
        if (!match) return item
        pendingRecovery.delete(item.id)
        return { ...item, page: match.location, locator: `page:${match.location}`, rects: [], anchorStatus: 'resolved' as const,
          anchor: { ...item.anchor, page: match.location, textOffset: match.start, quote: match.quote } }
      })
      if (next.some((item, index) => item !== annotations.value[index])) {
        annotations.value = next
        renderAll()
        if (save) await persist(generation.value, recordId.value)
      }
    }

    function clear() {
      if (root.value) clearPdfAnnotationOverlays(root.value)
      annotations.value = []
      otherAnnotations = []
      pendingRecovery = new Set()
      selected.value = []
      error.value = null
    }

    async function retrySave() {
      await persist(generation.value, recordId.value)
    }

    async function persist(expectedGeneration: number, expectedRecordId: string | null) {
      if (!expectedRecordId || expectedGeneration !== generation.value || expectedRecordId !== recordId.value) return
      const write = ++writeId
      const snapshot = [...otherAnnotations, ...annotations.value]
      unsavedDrafts.set(expectedRecordId, snapshot)
      const next = writeQueue.then(async () => {
        if (expectedGeneration !== generation.value || expectedRecordId !== recordId.value) return
        const target = repository ?? configuredRepository
        if (!target) throw new Error('批注存储不可用')
        await target.update(expectedRecordId, { annotations: snapshot })
        if (unsavedDrafts.get(expectedRecordId) === snapshot) unsavedDrafts.delete(expectedRecordId)
        if (write === writeId && expectedGeneration === generation.value && expectedRecordId === recordId.value) error.value = null
      }).catch(() => {
        if (write === writeId && expectedGeneration === generation.value && expectedRecordId === recordId.value) error.value = '批注保存失败，可稍后重试'
      })
      writeQueue = next
      await next
    }

    return { annotations, allAnnotations, recordId, generation, zoom, root, error, query, type, sort, selected, visible, synchronizeSession, createFromSelection, update, remove, removeSelected, importAnnotations, renderPage, recoverImported, retrySave, clear }
  })
}

export const usePdfAnnotationStore = createPdfAnnotationStore()
