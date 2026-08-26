import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RELEASE_HEADING = /^## \[([^\]]+)](?: - (\d{4}-\d{2}-\d{2}))?$/
const SEMANTIC_VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/
const CHANGE_CATEGORY = /^### (Added|Changed|Deprecated|Removed|Fixed|Security)$/

export function parseChangelog(source) {
  const releases = []
  let currentRelease = null

  for (const line of source.replace(/\r\n?/g, '\n').split('\n')) {
    if (line.startsWith('## [')) {
      appendRelease(releases, currentRelease)
      const match = line.match(RELEASE_HEADING)
      if (!match || (match[1] === 'Unreleased' ? match[2] : !match[2]))
        throw new Error(`Invalid changelog release heading: ${line}`)
      currentRelease = { version: match[1], date: match[2], lines: [] }
      continue
    }
    currentRelease?.lines.push(line)
  }

  appendRelease(releases, currentRelease)

  return releases
}

export function verifyChangelog(source, currentVersion) {
  const releases = parseChangelog(source)
  if (releases.length === 0 || releases[0].version !== currentVersion)
    throw new Error(`Changelog must start with the current release ${currentVersion}`)

  for (const release of releases) {
    if (!SEMANTIC_VERSION.test(release.version))
      throw new Error(`Invalid semantic version in changelog: ${release.version}`)
    if (!hasCategorizedChangeEntry(release.body))
      throw new Error(`Release ${release.version} must contain a categorized change entry`)
  }

  for (let index = 1; index < releases.length; index += 1) {
    if (compareVersions(releases[index - 1].version, releases[index].version) <= 0)
      throw new Error('Changelog releases must be unique and in descending version order')
  }

  return { currentVersion, releaseCount: releases.length }
}

function appendRelease(releases, release) {
  if (!release || release.version === 'Unreleased') return
  releases.push({
    version: release.version,
    date: release.date,
    body: release.lines.join('\n').trim(),
  })
}

function hasCategorizedChangeEntry(body) {
  let inChangeCategory = false
  for (const line of body.split('\n')) {
    if (line.startsWith('### ')) {
      inChangeCategory = CHANGE_CATEGORY.test(line)
      continue
    }
    if (inChangeCategory && /^- \S.+$/.test(line)) return true
  }
  return false
}

function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) return leftParts[index] - rightParts[index]
  }
  return 0
}

async function main() {
  const root = new URL('../', import.meta.url)
  const [source, packageSource] = await Promise.all([
    readFile(new URL('CHANGELOG.md', root), 'utf8'),
    readFile(new URL('package.json', root), 'utf8'),
  ])
  const { version } = JSON.parse(packageSource)
  const result = verifyChangelog(source, version)
  console.log(`Verified CHANGELOG.md for ${result.currentVersion} (${result.releaseCount} releases)`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main()
