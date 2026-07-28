import type { BookFormat } from './types'

export const SUPPORTED_EXTENSIONS: readonly BookFormat[] = ['pdf', 'epub', 'mobi', 'azw3']

export function detectFormat(fileName = '', mimeType = ''): BookFormat | null {
  const extension = fileName.toLowerCase().split('.').pop()
  if (SUPPORTED_EXTENSIONS.includes(extension as BookFormat)) return extension as BookFormat
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === 'application/epub+zip') return 'epub'
  if (mimeType === 'application/x-mobipocket-ebook') return 'mobi'
  return null
}

export function formatBytes(bytes = 0): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`
}

export function displayValue(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join('、')
  if (typeof value !== 'object') return ''
  if ('name' in value) return displayValue(value.name)
  const first = Object.values(value).find(item => typeof item === 'string')
  return typeof first === 'string' ? first : ''
}
