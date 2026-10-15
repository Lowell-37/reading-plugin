import { expectTypeOf, test } from 'vitest'
import type { ReaderPanel, ReaderSettings } from '../entrypoints/reader/reader-types'

test('shared reader types remain independent of the retired controller port', () => {
  expectTypeOf<ReaderPanel>().toEqualTypeOf<'toc' | 'settings' | 'tools' | null>()
  expectTypeOf<ReaderSettings>().toEqualTypeOf<Record<string, unknown>>()
})
