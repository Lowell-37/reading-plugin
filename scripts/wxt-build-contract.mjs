import { isDeepStrictEqual } from 'node:util'

const IDENTITY_FIELDS = ['key', 'name', 'version']
const MANIFEST_CONTRACT_FIELDS = [
  'permissions',
  'optional_host_permissions',
  'content_security_policy',
  'icons',
]
const REQUIRED_RUNTIME_FILES = [
  'reader.html',
  'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  'node_modules/pdfjs-dist/cmaps/78-EUC-H.bcmap',
  'node_modules/pdfjs-dist/standard_fonts/FoxitDingbats.pfb',
  'node_modules/pdfjs-dist/wasm/openjpeg.wasm',
]

export function verifyWxtBuildContract({ rootManifest, builtManifest, files, requiredRuntimeFiles = [] }) {
  for (const field of IDENTITY_FIELDS) {
    if (builtManifest[field] !== rootManifest[field]) {
      throw new Error(`WXT manifest ${field} differs from root manifest`)
    }
  }

  for (const field of MANIFEST_CONTRACT_FIELDS) {
    if (!isDeepStrictEqual(builtManifest[field], rootManifest[field])) {
      throw new Error(`WXT manifest ${field} differs from root manifest`)
    }
  }

  const emittedFiles = new Set(files.map(file => file.replaceAll('\\', '/')))
  const requiredFiles = new Set([
    ...REQUIRED_RUNTIME_FILES,
    ...requiredRuntimeFiles,
    ...Object.values(rootManifest.icons ?? {}),
  ])
  for (const file of requiredFiles) {
    if (!emittedFiles.has(file)) throw new Error(`WXT build is missing ${file}`)
  }

  return {
    extensionIdentity: builtManifest.key,
    fileCount: emittedFiles.size,
  }
}
