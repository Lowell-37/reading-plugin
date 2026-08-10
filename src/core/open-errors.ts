import type { BookFormat } from './types'

export type OpenErrorCode = 'unsupported' | 'password' | 'protected' | 'damaged'

export interface OpenErrorDescription {
  code: OpenErrorCode
  message: string
}

export function describeOpenError(error: unknown, format: BookFormat | null): OpenErrorDescription {
  if (!format) {
    return {
      code: 'unsupported',
      message: '不支持这种文件格式。请选择 PDF、EPUB、MOBI 或 AZW3 文件。',
    }
  }

  const detail = errorText(error)
  if (/password|passwordexception|口令|密码/i.test(detail)) {
    return {
      code: 'password',
      message: '这本书受密码保护。请先在原应用中移除密码后再打开。',
    }
  }
  if (/drm|encrypt|encrypted|encryption|rights management|加密/i.test(detail)) {
    return {
      code: 'protected',
      message: format === 'pdf'
        ? '这个 PDF 使用了暂不支持的加密保护，无法读取正文。'
        : '这本电子书包含 DRM 或加密内容，浏览器扩展无法解密。',
    }
  }
  if (format === 'mobi' || format === 'azw3') {
    return {
      code: 'damaged',
      message: '无法解析这本 Kindle 书籍。文件可能损坏、带有 DRM，或使用了暂不支持的压缩方式。',
    }
  }
  if (format === 'epub') {
    return {
      code: 'damaged',
      message: '无法解析这个 EPUB。文件可能损坏、缺少正文，或包含不受支持的加密内容。',
    }
  }
  return {
    code: 'damaged',
    message: '无法解析这个 PDF。文件可能损坏、内容不完整或受保护。',
  }
}

function errorText(error: unknown): string {
  if (!error) return ''
  if (typeof error === 'string') return error
  if (typeof error !== 'object') return String(error)
  const candidate = error as { name?: unknown, message?: unknown, code?: unknown }
  return [candidate.name, candidate.message, candidate.code].filter(Boolean).join(' ')
}
