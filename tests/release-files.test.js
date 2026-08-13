import { describe, expect, it } from 'vitest'
import { releaseFiles } from '../scripts/release-files.mjs'

describe('releaseFiles', () => {
  it('contains the stable root extension entrypoints and runtime dependencies only', () => {
    expect(releaseFiles).toEqual([
      'manifest.json',
      'reader.html',
      'styles',
      'src',
      'node_modules/foliate-js',
      'node_modules/pdfjs-dist/build',
      'node_modules/pdfjs-dist/cmaps',
      'node_modules/pdfjs-dist/standard_fonts',
      'node_modules/pdfjs-dist/wasm',
    ])
  })

  it('does not include development and alternate-build directories', () => {
    expect(releaseFiles).not.toContain('.output')
    expect(releaseFiles).not.toContain('.wxt')
    expect(releaseFiles).not.toContain('tests')
    expect(releaseFiles).not.toContain('node_modules')
  })
})
