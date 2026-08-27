import { describe, expect, test } from 'vitest'
import { verifyWxtBuildContract } from '../scripts/wxt-build-contract.mjs'

const rootManifest = {
  manifest_version: 3,
  key: 'stable-key',
  name: '静读',
  version: '0.2.0',
  permissions: ['storage'],
  optional_host_permissions: ['https://*/*', 'http://*/*'],
  icons: {
    16: 'assets/icon-16.png',
    32: 'assets/icon-32.png',
    48: 'assets/icon-48.png',
    128: 'assets/icon-128.png',
  },
  content_security_policy: {
    extension_pages: "script-src 'self'; worker-src 'self'; frame-src 'self' blob:",
  },
}

const completeFiles = [
  'reader.html',
  'assets/icon-16.png',
  'assets/icon-32.png',
  'assets/icon-48.png',
  'assets/icon-128.png',
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  'node_modules/pdfjs-dist/cmaps/78-EUC-H.bcmap',
  'node_modules/pdfjs-dist/standard_fonts/FoxitDingbats.pfb',
  'node_modules/pdfjs-dist/wasm/openjpeg.wasm',
]

describe('WXT build contract', () => {
  test.each(['key', 'name', 'version'])('rejects a different extension %s', field => {
    expect(() => verifyWxtBuildContract({
      rootManifest,
      builtManifest: { ...rootManifest, [field]: `different-${field}` },
      files: completeFiles,
    })).toThrow(new RegExp(field, 'i'))
  })

  test.each(['permissions', 'optional_host_permissions', 'content_security_policy'])(
    'rejects a different %s contract',
    field => {
      expect(() => verifyWxtBuildContract({
        rootManifest,
        builtManifest: { ...rootManifest, [field]: field === 'content_security_policy' ? {} : [] },
        files: completeFiles,
      })).toThrow(new RegExp(field, 'i'))
    },
  )

  test('requires the same declared icons and their emitted files', () => {
    expect(() => verifyWxtBuildContract({
      rootManifest,
      builtManifest: { ...rootManifest, icons: { 128: 'other-icon.png' } },
      files: completeFiles,
    })).toThrow(/icons/i)

    expect(() => verifyWxtBuildContract({
      rootManifest,
      builtManifest: rootManifest,
      files: completeFiles.filter(file => file !== 'assets/icon-32.png'),
    })).toThrow(/icon-32\.png/i)
  })

  test.each([
    ['reader entry', 'reader.html'],
    ['PDF worker', 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs'],
    ['PDF character maps', 'node_modules/pdfjs-dist/cmaps/78-EUC-H.bcmap'],
    ['PDF standard fonts', 'node_modules/pdfjs-dist/standard_fonts/FoxitDingbats.pfb'],
    ['PDF WASM decoder', 'node_modules/pdfjs-dist/wasm/openjpeg.wasm'],
  ])('requires the %s runtime asset', (_label, missingFile) => {
    expect(() => verifyWxtBuildContract({
      rootManifest,
      builtManifest: rootManifest,
      files: completeFiles.filter(file => file !== missingFile),
    })).toThrow(new RegExp(missingFile.split('/').at(-1).replace('.', '\\.')))
  })

  test('returns the verified extension identity and file count', () => {
    expect(verifyWxtBuildContract({
      rootManifest,
      builtManifest: structuredClone(rootManifest),
      files: completeFiles,
    })).toEqual({ extensionIdentity: 'stable-key', fileCount: completeFiles.length })
  })
})
