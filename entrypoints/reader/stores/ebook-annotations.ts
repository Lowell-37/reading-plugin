import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'
import { createAnnotation, filterAnnotations, sortAnnotations, updateAnnotation } from '../../../src/core/annotations'
import { mergeAnnotationImports } from '../../../src/core/annotation-import'
import type { Annotation, BookRecord } from '../../../src/core/types'
import { useEbookSessionStore } from './ebook-session'

type Repository = { update(id: string, changes: Pick<BookRecord, 'annotations'>): Promise<void> }
type Session = { record: BookRecord | null, generation: number }
let configuredRepository: Repository | null = null

export function configureEbookAnnotationRepository(repository: Repository | null) {
  configuredRepository = repository
}

export function createEbookAnnotationStore({ repository }: { repository?: Repository } = {}) {
  return defineStore('ebook-annotations', () => {
    const ebook = useEbookSessionStore()
    const annotations = shallowRef<Annotation[]>([])
    const recordId = shallowRef<string | null>(null)
    const generation = shallowRef(0)
    const error = shallowRef<string | null>(null)
    const query = shallowRef('')
    const type = shallowRef<'all' | 'notes' | 'highlights' | 'pdf' | 'ebook'>('all')
    const sort = shallowRef<'newest' | 'oldest' | 'location'>('newest')
    const selected = shallowRef<string[]>([])
    const visible = computed(() => sortAnnotations(filterAnnotations(annotations.value, { query: query.value, type: type.value }), sort.value))
    const allAnnotations = computed(() => [...otherAnnotations, ...annotations.value])
    let otherAnnotations: Annotation[] = []
    let writeQueue: Promise<void> = Promise.resolve()
    const unsavedDrafts = new Map<string, Annotation[]>()
    const savedSnapshots = new Map<string, Annotation[]>()
    let writeId = 0

    function synchronizeSession(session: Session) {
      if (recordId.value === session.record?.id && generation.value === session.generation) return
      recordId.value = session.record?.id ?? null
      generation.value = session.generation
      const draft = session.record ? unsavedDrafts.get(session.record.id) : null
      const source = draft ?? (session.record ? savedSnapshots.get(session.record.id) : null) ?? session.record?.annotations ?? []
      annotations.value = source.filter(item => item.kind === 'ebook')
      otherAnnotations = source.filter(item => item.kind !== 'ebook')
      selected.value = []
      query.value = ''
      type.value = 'all'
      sort.value = 'newest'
      error.value = draft ? '批注保存失败，可稍后重试' : null
      void render()
    }

    async function createFromSelection(note = '') {
      if (!recordId.value || ebook.status !== 'ready' || ebook.record?.id !== recordId.value) return null
      const selection = ebook.consumeSelection()
      if (!selection?.locator || !selection.text.trim()) return null
      const annotation = createAnnotation({ kind: 'ebook', ...selection, note, anchorStatus: 'resolved' })
      annotations.value = [...annotations.value, annotation]
      const save = persist(generation.value, recordId.value)
      await render()
      await save
      return annotation
    }

    async function update(id: string, changes: { note?: unknown, tags?: unknown }) {
      annotations.value = updateAnnotation(annotations.value, id, changes)
      const save = persist(generation.value, recordId.value)
      await render()
      await save
    }

    async function remove(id: string) {
      annotations.value = annotations.value.filter(item => item.id !== id)
      selected.value = selected.value.filter(value => value !== id)
      const save = persist(generation.value, recordId.value)
      await render()
      await save
    }

    async function removeSelected() {
      const ids = new Set(selected.value)
      annotations.value = annotations.value.filter(item => !ids.has(item.id))
      selected.value = []
      const save = persist(generation.value, recordId.value)
      await render()
      await save
    }

    async function importAnnotations(imported: Annotation[]) {
      const result = mergeAnnotationImports([...otherAnnotations, ...annotations.value], imported)
      otherAnnotations = result.annotations.filter(item => item.kind !== 'ebook')
      annotations.value = result.annotations.filter(item => item.kind === 'ebook')
      const save = persist(generation.value, recordId.value)
      await render()
      await save
      return result
    }

    async function applyRepair(repaired: Annotation, expectedGeneration: number) {
      if (expectedGeneration !== generation.value || repaired.kind !== 'ebook') return
      const index = annotations.value.findIndex(item => item.id === repaired.id)
      if (index < 0) return
      annotations.value = annotations.value.map(item => item.id === repaired.id ? repaired : item)
      await persist(expectedGeneration, recordId.value)
    }

    async function render() {
      if (recordId.value && ebook.record?.id === recordId.value && ebook.status === 'ready') {
        try { await ebook.setAnnotations(annotations.value) }
        catch { error.value = '批注显示失败，请尝试重新打开书籍' }
      }
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
        if (unsavedDrafts.get(expectedRecordId) === snapshot) {
          unsavedDrafts.delete(expectedRecordId)
          savedSnapshots.set(expectedRecordId, snapshot)
        }
        if (write === writeId && expectedGeneration === generation.value && expectedRecordId === recordId.value) error.value = null
      }).catch(() => {
        if (write === writeId && expectedGeneration === generation.value && expectedRecordId === recordId.value) error.value = '批注保存失败，可稍后重试'
      })
      writeQueue = next
      await next
    }

    return { annotations, allAnnotations, recordId, generation, error, query, type, sort, selected, visible,
      synchronizeSession, createFromSelection, update, remove, removeSelected, importAnnotations, applyRepair, retrySave }
  })
}

export const useEbookAnnotationStore = createEbookAnnotationStore()
