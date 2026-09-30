<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useReaderStore } from '../stores/reader'
import { usePdfSessionStore } from '../stores/pdf-session'
import { usePdfSearchStore } from '../stores/pdf-search'
import { usePdfAnnotationStore } from '../stores/pdf-annotations'
import { annotationExportFileName, createAnnotationExport, serializeAnnotationsJson, serializeAnnotationsMarkdown } from '../../../src/core/annotation-export'
import { annotationImportMatchesBook, parseAnnotationImport } from '../../../src/core/annotation-import'

const reader = useReaderStore()
const { activePanel } = storeToRefs(reader)
const pdf = usePdfSessionStore()
const pdfSearch = usePdfSearchStore()
const pdfAnnotations = usePdfAnnotationStore()
const { record: pdfRecord, status: pdfStatus, generation, zoom, title: pdfTitle } = storeToRefs(pdf)
const { results, total, unavailablePages, status: pdfSearchStatus, error } = storeToRefs(pdfSearch)
const { annotations, allAnnotations, visible: visibleAnnotations, query: annotationQuery, type: annotationType, sort: annotationSort, selected: selectedAnnotations, error: annotationError } = storeToRefs(pdfAnnotations)
const searchQuery = ref('')
const annotationMessage = ref('')
const pdfSessionActive = computed(() => pdfRecord.value !== null)
const pdfAnnotationsActive = computed(() => pdfSessionActive.value && pdfStatus.value === 'ready')
const searchStatus = computed(() => {
  if (pdfSearchStatus.value === 'searching') return '正在搜索…'
  if (pdfSearchStatus.value === 'error') return error.value ?? '搜索失败，请换一个关键词重试'
  if (pdfSearchStatus.value !== 'ready') return '输入关键词搜索整本书'
  const message = total.value
    ? `找到 ${total.value} 处结果${total.value > 300 ? '（显示前 300 条）' : ''}`
    : '没有找到匹配内容'
  return unavailablePages.value
    ? `${message}（仅搜索已渲染页面，${unavailablePages.value} 页尚未渲染）`
    : message
})

function handleSearchSubmit(event: Event) {
  if (!pdfSessionActive.value || pdfStatus.value !== 'ready') return
  event.preventDefault()
  event.stopImmediatePropagation()
  void pdfSearch.run(searchQuery.value)
}

function capturePdfAnnotation(event: Event, withNote: boolean) {
  if (!pdfAnnotationsActive.value) return
  event.preventDefault()
  event.stopImmediatePropagation()
  const selection = window.getSelection()
  if (!selection || selection.isCollapsed || !selection.rangeCount) return
  const range = selection.getRangeAt(0).cloneRange()
  const container = range.commonAncestorContainer instanceof Element ? range.commonAncestorContainer : range.commonAncestorContainer.parentElement
  const page = container?.closest<HTMLElement>('.pdf-page')
  if (!page) return
  const note = withNote ? window.prompt('写下批注（可留空，仅保存高亮）', '') : ''
  if (note === null) return
  void pdfAnnotations.createFromSelection({ page, range, note, generation: generation.value })
}

function toggleAnnotation(id: string, checked: boolean) {
  selectedAnnotations.value = checked
    ? [...new Set([...selectedAnnotations.value, id])]
    : selectedAnnotations.value.filter(value => value !== id)
}

function toggleAllAnnotations() {
  const ids = visibleAnnotations.value.map(item => item.id)
  selectedAnnotations.value = ids.every(id => selectedAnnotations.value.includes(id)) ? [] : ids
}

function capturePdfControl(event: Event) {
  if (!pdfAnnotationsActive.value) return false
  event.preventDefault()
  event.stopImmediatePropagation()
  return true
}

function filterAnnotationsInput(event: Event) {
  if (capturePdfControl(event)) annotationQuery.value = (event.target as HTMLInputElement).value
}

function filterAnnotationsType(event: Event) {
  if (capturePdfControl(event)) annotationType.value = (event.target as HTMLSelectElement).value as typeof annotationType.value
}

function sortAnnotationsInput(event: Event) {
  if (capturePdfControl(event)) annotationSort.value = (event.target as HTMLSelectElement).value as typeof annotationSort.value
}

function selectAllAnnotations(event: Event) {
  if (capturePdfControl(event)) toggleAllAnnotations()
}

function deleteSelectedAnnotations(event: Event) {
  if (!capturePdfControl(event)) return
  if (!selectedAnnotations.value.length || !window.confirm(`确定删除所选的 ${selectedAnnotations.value.length} 条高亮或批注吗？`)) return
  void pdfAnnotations.removeSelected()
}

function openAnnotationImport(event: Event) {
  if (!capturePdfControl(event)) return
  const input = document.getElementById('annotation-import-input') as HTMLInputElement | null
  if (input) { input.value = ''; input.click() }
}

async function importAnnotationFile(event: Event) {
  if (!capturePdfControl(event)) return
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file || !pdfRecord.value) return
  const expectedGeneration = generation.value
  const expectedId = pdfRecord.value.id
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('批注文件不能超过 10 MB')
    const archive = parseAnnotationImport(await file.text())
    if (expectedGeneration !== generation.value || expectedId !== pdfRecord.value?.id) return
    if (!annotationImportMatchesBook(archive.book, { fileName: pdfRecord.value.name, format: pdfRecord.value.format })
      && !window.confirm('导入文件属于另一本书，仍要合并到当前书籍吗？')) return
    const result = await pdfAnnotations.importAnnotations(archive.annotations)
    annotationMessage.value = `导入完成：新增 ${result.added}，更新 ${result.updated}，跳过 ${result.skipped}`
  } catch (error) {
    annotationMessage.value = error instanceof Error ? error.message : '无法导入批注文件'
  } finally {
    input.value = ''
  }
}

function exportAnnotations(event: Event, extension: 'json' | 'md') {
  if (!capturePdfControl(event)) return
  if (!pdfRecord.value || !allAnnotations.value.length) {
    annotationMessage.value = '当前书籍还没有可导出的高亮或批注'
    return
  }
  const archive = createAnnotationExport({ name: pdfRecord.value.name, format: pdfRecord.value.format, title: pdfTitle.value }, allAnnotations.value)
  const content = extension === 'json' ? serializeAnnotationsJson(archive) : serializeAnnotationsMarkdown(archive)
  const type = extension === 'json' ? 'application/json' : 'text/markdown'
  const url = URL.createObjectURL(new Blob([content], { type: `${type};charset=utf-8` }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = annotationExportFileName(archive, extension)
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  annotationMessage.value = `已导出 ${allAnnotations.value.length} 条高亮与批注`
}

function editAnnotation(annotation: typeof annotations.value[number]) {
  const note = window.prompt('编辑批注（留空则仅保留高亮）', annotation.note)
  if (note === null) return
  const tags = window.prompt('编辑标签（使用逗号分隔，最多 10 个）', annotation.tags?.join(', ') || '')
  if (tags === null) return
  void pdfAnnotations.update(annotation.id, { note, tags })
}

function deleteAnnotation(annotation: typeof annotations.value[number]) {
  if (window.confirm('确定删除这条高亮或批注吗？')) void pdfAnnotations.remove(annotation.id)
}

function jumpToAnnotation(page: number | null) {
  if (page != null) void pdf.goTo(page)
}

watch(
  [generation, pdfStatus, zoom, () => pdfRecord.value?.id ?? null],
  ([nextGeneration, nextStatus, nextZoom, recordId]) => {
    pdfSearch.synchronizeSession({
      generation: nextGeneration,
      status: nextStatus,
      zoom: nextZoom,
      recordId,
    })
    if (pdfSessionActive.value && pdfSearch.query === '') searchQuery.value = ''
  },
  { immediate: true },
)

onMounted(() => {
  pdfSearch.attachRoot(document.getElementById('pdf-pages'))
})

onUnmounted(() => {
  pdfSearch.attachRoot(null)
})
</script>

<template>
  <aside id="tools-panel" class="tools-panel" :class="{ open: activePanel === 'tools' }" aria-label="搜索与批注">
    <div class="panel-header"><div><p class="eyebrow">TOOLS</p><h2>搜索与批注</h2></div><button id="close-tools" class="icon-button" aria-label="关闭工具" @click="reader.closePanel()">×</button></div>
    <form id="search-form" class="search-form" @submit="handleSearchSubmit"><input id="search-input" v-model="searchQuery" type="search" placeholder="搜索书中内容" autocomplete="off"><button type="submit">搜索</button></form>
    <div id="search-status" class="search-status" aria-live="polite">{{ pdfSessionActive ? searchStatus : '输入关键词搜索整本书' }}</div>
    <div id="search-results" class="search-results">
      <template v-if="pdfSessionActive">
        <button v-for="result in results" :key="`${result.page}:${result.start}:${result.end}`" class="search-result" type="button" @click="pdfSearch.goToResult(result)">
          <strong>第 {{ result.page }} 页</strong><span>{{ result.context }}</span>
        </button>
      </template>
    </div>
    <div class="tool-divider" />
    <section class="ai-section" aria-labelledby="ai-heading" hidden>
      <div class="annotation-heading"><strong id="ai-heading">AI 阅读助手</strong><button id="ai-settings-toggle" class="text-button" type="button">接口设置</button></div>
      <p id="ai-selection-preview" class="selection-hint">选中文字后，可以解释、翻译或补充背景。</p>
      <div class="ai-actions" aria-label="划词 AI">
        <button type="button" data-ai-scope="selection" data-ai-action="explain">解释这段话</button><button type="button" data-ai-scope="selection" data-ai-action="translate">翻译</button><button type="button" data-ai-scope="selection" data-ai-action="simplify">简化表达</button><button type="button" data-ai-scope="selection" data-ai-action="terms">分析术语</button><button type="button" data-ai-scope="selection" data-ai-action="background">补充背景</button>
      </div>
      <div class="ai-subheading">当前章节</div>
      <div class="ai-actions" aria-label="章节助手">
        <button type="button" data-ai-scope="chapter" data-ai-action="summary">章节摘要</button><button type="button" data-ai-scope="chapter" data-ai-action="keyPoints">核心观点</button><button type="button" data-ai-scope="chapter" data-ai-action="characters">人物和事件</button><button type="button" data-ai-scope="chapter" data-ai-action="timeline">时间线</button><button type="button" data-ai-scope="chapter" data-ai-action="concepts">重要概念</button>
      </div>
      <div id="ai-result" class="ai-result" hidden>
        <div class="ai-result-heading"><strong id="ai-result-title">AI 回答</strong><button id="ai-stop" class="text-button" type="button" hidden>停止</button></div>
        <div id="ai-result-status" class="ai-result-status" /><div id="ai-result-content" class="ai-result-content" />
      </div>
      <div id="ai-settings" class="ai-settings" hidden>
        <label for="ai-endpoint">OpenAI 兼容接口地址</label><input id="ai-endpoint" type="url" placeholder="https://api.openai.com/v1" spellcheck="false">
        <label for="ai-model">模型名称</label><input id="ai-model" type="text" placeholder="填写接口支持的模型" spellcheck="false">
        <label for="ai-api-key">API 密钥</label><input id="ai-api-key" type="password" placeholder="仅保存在当前浏览器" autocomplete="off" spellcheck="false">
        <button id="save-ai-settings" class="soft-button ai-save-button" type="button">保存设置</button>
        <p>默认不会发送图书内容。点击某项 AI 功能时，仅发送选中文字或当前章节；密钥保存在本机扩展数据中。</p>
      </div>
    </section>
    <div class="tool-divider" />
    <div class="annotation-heading"><strong>高亮与批注</strong><span id="annotation-count">{{ pdfAnnotationsActive ? `${annotations.length} 条` : '0 条' }}</span></div>
    <p class="selection-hint">在正文中选中文字，然后高亮或添加批注。</p>
    <div class="selection-actions"><button id="highlight-selection" type="button" @click.capture="capturePdfAnnotation($event, false)">高亮选中</button><button id="note-selection" type="button" @click.capture="capturePdfAnnotation($event, true)">添加批注</button></div>
    <div class="annotation-filters">
      <input id="annotation-filter-query" v-model="annotationQuery" type="search" placeholder="筛选原文、批注或标签" aria-label="筛选批注" @input.capture="filterAnnotationsInput">
      <select id="annotation-filter-type" v-model="annotationType" aria-label="批注类型" @change.capture="filterAnnotationsType">
        <option value="all">全部</option><option value="notes">有批注</option><option value="highlights">仅高亮</option><option value="pdf">PDF</option><option value="ebook">电子书</option>
      </select>
      <select id="annotation-sort" v-model="annotationSort" aria-label="批注排序" @change.capture="sortAnnotationsInput">
        <option value="newest">最近修改</option><option value="oldest">最早创建</option><option value="location">阅读位置</option>
      </select>
      <button id="annotation-select-all" class="text-button" type="button" @click.capture="selectAllAnnotations">全选当前</button>
      <button id="annotation-delete-selected" class="text-button danger" type="button" :disabled="!pdfAnnotationsActive || !selectedAnnotations.length" @click.capture="deleteSelectedAnnotations">删除所选</button>
    </div>
    <div class="annotation-export-actions">
      <button id="import-annotations-json" class="text-button" type="button" @click.capture="openAnnotationImport">导入 JSON</button>
      <input id="annotation-import-input" type="file" accept=".json,application/json" hidden @change.capture="importAnnotationFile">
      <button id="export-annotations-markdown" class="text-button" type="button" @click.capture="exportAnnotations($event, 'md')">导出 Markdown</button>
      <button id="export-annotations-json" class="text-button" type="button" @click.capture="exportAnnotations($event, 'json')">导出 JSON</button>
    </div>
    <p v-if="pdfAnnotationsActive && annotationMessage" class="selection-hint" role="status">{{ annotationMessage }}</p>
    <p v-if="pdfAnnotationsActive && annotationError" class="selection-hint" role="alert">{{ annotationError }} <button type="button" class="text-button" @click="pdfAnnotations.retrySave()">重试保存</button></p>
    <div id="annotation-list" class="annotation-list">
      <template v-if="pdfAnnotationsActive">
        <article v-for="annotation in visibleAnnotations" :key="annotation.id" class="annotation-item">
          <input class="annotation-select" type="checkbox" :checked="selectedAnnotations.includes(annotation.id)" :aria-label="`选择${annotation.text}`" @change="toggleAnnotation(annotation.id, ($event.target as HTMLInputElement).checked)">
          <button class="annotation-jump" type="button" @click="jumpToAnnotation(annotation.page)"><small>第 {{ annotation.page }} 页</small><q>{{ annotation.text }}</q><p v-if="annotation.note">{{ annotation.note }}</p><small v-if="annotation.anchorStatus === 'unresolved'" class="annotation-anchor-status">定位待恢复</small><small v-if="annotation.tags?.length" class="annotation-tags">{{ annotation.tags.join('、') }}</small></button>
          <button class="text-button" type="button" @click="editAnnotation(annotation)">编辑</button>
          <button class="text-button danger" type="button" @click="deleteAnnotation(annotation)">删除</button>
        </article>
      </template>
    </div>
  </aside>
</template>
