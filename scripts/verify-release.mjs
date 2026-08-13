import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import AdmZip from 'adm-zip'
import { fileURLToPath } from 'node:url'
import { releaseFiles } from './release-files.mjs'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
const releaseName = `quiet-reader-${manifest.version}`
const archive = new URL(`../dist/${releaseName}.zip`, import.meta.url)
const checksum = new URL(`../dist/${releaseName}.sha256`, import.meta.url)
const releaseManifest = new URL(`../dist/${releaseName}.json`, import.meta.url)
const metadata = JSON.parse(await readFile(releaseManifest, 'utf8'))
const actualHash = createHash('sha256').update(await readFile(archive)).digest('hex')
const expectedChecksum = (await readFile(checksum, 'utf8')).trim().split(/\s+/)[0]
const archiveFiles = new AdmZip(fileURLToPath(archive)).getEntries()
  .filter(entry => !entry.isDirectory)
  .map(entry => entry.entryName.replace(/\\/g, '/'))

if (metadata.format !== 'quiet-reader-release' || metadata.formatVersion !== 1)
  throw new Error('Release manifest format is invalid')
if (metadata.version !== manifest.version) throw new Error('Release manifest version does not match manifest.json')
if (metadata.sha256 !== actualHash || expectedChecksum !== actualHash)
  throw new Error('Release archive SHA-256 verification failed')
for (const path of ['manifest.json', 'reader.html', 'src/background.js', ...releaseFiles.filter(path => path.endsWith('/')).map(() => '')]) {
  if (path && !archiveFiles.includes(path)) throw new Error(`Release archive is missing ${path}`)
}
if (archiveFiles.some(path => path.startsWith('.output/') || path.startsWith('.wxt/') || path.startsWith('tests/')))
  throw new Error('Release archive contains development or alternate-build files')

console.log(`Verified ${releaseName}.zip (${archiveFiles.length} files)`)
