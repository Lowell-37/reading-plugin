import type { Annotation, BookRecord } from './types'
import { normalizeAnnotations } from './annotations.js'

export interface AnnotationExportBook {
  title?: string
  author?: string
  fileName?: string
  format?: string
}

export interface AnnotationExportDocument {
  format: 'quiet-reader-annotations'
  version: 1
  exportedAt: string
  book: {
    title: string
    author: string
    fileName: string
    format: string
  }
  annotations: Annotation[]
}

export function createAnnotationExport(
  book: AnnotationExportBook | Partial<BookRecord>,
  value: unknown,
  exportedAt = new Date().toISOString(),
): AnnotationExportDocument {
  const source = book as AnnotationExportBook & Partial<BookRecord>
  const metadata = source.metadata
  return {
    format: 'quiet-reader-annotations',
    version: 1,
    exportedAt,
    book: {
      title: clean(metadata?.title || source.title || source.fileName || source.name || '未命名书籍'),
      author: clean(metadata?.author || source.author || '未知作者'),
      fileName: clean(source.fileName || source.name),
      format: clean(source.format),
    },
    annotations: normalizeAnnotations(value).map(annotation => ({
      ...annotation,
      rects: Array.isArray(annotation.rects) ? annotation.rects : [],
    })),
  }
}

export function serializeAnnotationsJson(document: AnnotationExportDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`
}

export function serializeAnnotationsMarkdown(document: AnnotationExportDocument): string {
  const lines = [
    `# ${document.book.title} · 高亮与批注`,
    '',
    `- 作者：${document.book.author || '未知作者'}`,
    `- 文件：${document.book.fileName || '未知文件'}`,
    `- 格式：${document.book.format.toUpperCase() || '未知'}`,
    `- 导出时间：${document.exportedAt}`,
    `- 条目数：${document.annotations.length}`,
    '',
  ]
  document.annotations.forEach((annotation, index) => {
    const location = annotation.kind === 'pdf'
      ? `第 ${annotation.page || '?'} 页`
      : `电子书章节${annotation.section == null ? '' : ` ${annotation.section + 1}`}`
    const timestamp = annotation.updatedAt || annotation.createdAt
    lines.push(`## ${index + 1}. ${location}`, '')
    if (annotation.text) lines.push(quote(annotation.text), '')
    if (annotation.note) lines.push(`**批注：** ${annotation.note}`, '')
    if (timestamp) lines.push(`_记录时间：${new Date(timestamp).toISOString()}_`, '')
  })
  return `${lines.join('\n').trimEnd()}\n`
}

export function annotationExportFileName(
  document: AnnotationExportDocument,
  extension: 'md' | 'json',
): string {
  const base = document.book.title
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80) || 'quiet-reader'
  return `${base}-annotations.${extension}`
}

function clean(value: unknown): string {
  return String(value || '').trim()
}

function quote(value: string): string {
  return String(value).split(/\r?\n/).map(line => `> ${line}`).join('\n')
}
