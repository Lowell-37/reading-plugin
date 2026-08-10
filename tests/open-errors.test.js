import assert from 'node:assert/strict'
import { test } from 'vitest'
import { describeOpenError } from '../src/core/open-errors.ts'

test('describes unsupported files with the supported format list', () => {
  const result = describeOpenError(null, null)
  assert.equal(result.code, 'unsupported')
  assert.match(result.message, /PDF、EPUB、MOBI 或 AZW3/)
})

test('recognizes password and encrypted-document failures', () => {
  assert.equal(describeOpenError({ name: 'PasswordException' }, 'pdf').code, 'password')
  assert.equal(describeOpenError(new Error('Encrypted EPUB resource'), 'epub').code, 'protected')
  assert.equal(describeOpenError(new Error('DRM protected'), 'azw3').code, 'protected')
})

test('provides format-specific damaged file guidance', () => {
  assert.match(describeOpenError(new Error('Invalid PDF'), 'pdf').message, /PDF/)
  assert.match(describeOpenError(new Error('Invalid ZIP'), 'epub').message, /EPUB/)
  assert.match(describeOpenError(new Error('Invalid PalmDB'), 'mobi').message, /Kindle/)
})
