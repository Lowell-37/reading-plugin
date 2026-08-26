import { describe, expect, test } from 'vitest'
import { parseChangelog, verifyChangelog } from '../scripts/verify-changelog.mjs'

const validChangelog = `# Changelog

## [Unreleased]

## [0.2.0] - 2026-08-26

### Added

- Added local EPUB reading.

## [0.1.0] - 2026-07-01

### Fixed

- Fixed startup errors.
`

describe('changelog verification', () => {
  test('parses released versions in descending order and ignores Unreleased', () => {
    expect(parseChangelog(validChangelog).map(release => release.version)).toEqual(['0.2.0', '0.1.0'])
  })

  test('accepts a changelog whose newest release matches the package version', () => {
    expect(verifyChangelog(validChangelog, '0.2.0')).toEqual({
      currentVersion: '0.2.0',
      releaseCount: 2,
    })
  })

  test('accepts Windows CRLF line endings', () => {
    expect(verifyChangelog(validChangelog.replaceAll('\n', '\r\n'), '0.2.0')).toEqual({
      currentVersion: '0.2.0',
      releaseCount: 2,
    })
  })

  test('rejects a missing current release', () => {
    expect(() => verifyChangelog(validChangelog, '0.3.0')).toThrow(/0\.3\.0/)
  })

  test('rejects releases without categorized change entries', () => {
    const emptyRelease = validChangelog.replace('- Added local EPUB reading.', 'No changes documented.')
    expect(() => verifyChangelog(emptyRelease, '0.2.0')).toThrow(/change entr/i)
  })

  test('rejects duplicate release versions', () => {
    const duplicateRelease = validChangelog.replace('## [0.1.0] - 2026-07-01', '## [0.2.0] - 2026-07-01')
    expect(() => verifyChangelog(duplicateRelease, '0.2.0')).toThrow(/descending/i)
  })

  test('rejects non-descending release versions', () => {
    const outOfOrderRelease = validChangelog.replaceAll('0.1.0', '0.3.0')
    expect(() => verifyChangelog(outOfOrderRelease, '0.2.0')).toThrow(/descending/i)
  })

  test('rejects semantic versions with leading zeroes', () => {
    const invalidVersion = validChangelog.replaceAll('0.2.0', '01.2.0')
    expect(() => verifyChangelog(invalidVersion, '01.2.0')).toThrow(/semantic version/i)
  })

  test('rejects release headings without a date', () => {
    const malformedHeading = validChangelog.replace('## [0.1.0] - 2026-07-01', '## [0.1.0]')
    expect(() => verifyChangelog(malformedHeading, '0.2.0')).toThrow(/heading/i)
  })

  test('requires a bullet directly under a recognized category', () => {
    const misplacedEntry = validChangelog.replace(
      '### Added\n\n- Added local EPUB reading.',
      '### Added\n\nNo entries.\n\n### Notes\n\n- Added local EPUB reading.',
    )
    expect(() => verifyChangelog(misplacedEntry, '0.2.0')).toThrow(/change entr/i)
  })
})
