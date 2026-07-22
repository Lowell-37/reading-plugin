export const SUPPORTED_EXTENSIONS = ['pdf', 'epub', 'mobi', 'azw3']

export function detectFormat(fileName = '', mimeType = '') {
  const extension = fileName.toLowerCase().split('.').pop()
  if (SUPPORTED_EXTENSIONS.includes(extension)) return extension
  if (mimeType === 'application/pdf') return 'pdf'
  if (mimeType === 'application/epub+zip') return 'epub'
  if (mimeType === 'application/x-mobipocket-ebook') return 'mobi'
  return null
}

export function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 ** 2).toFixed(bytes < 10 * 1024 ** 2 ? 1 : 0)} MB`
}

export function displayValue(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map(displayValue).filter(Boolean).join('、')
  if (value.name) return displayValue(value.name)
  const first = Object.values(value).find(item => typeof item === 'string')
  return first || ''
}
