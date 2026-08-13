import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import AdmZip from 'adm-zip'
import { fileURLToPath } from 'node:url'
import { releaseFiles } from './release-files.mjs'

const root = new URL('../', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
const releaseName = `quiet-reader-${manifest.version}`
const dist = new URL('../dist/', import.meta.url)
const staging = new URL(`../dist/${releaseName}/`, import.meta.url)
const archive = new URL(`../dist/${releaseName}.zip`, import.meta.url)
const checksum = new URL(`../dist/${releaseName}.sha256`, import.meta.url)
const releaseManifest = new URL(`../dist/${releaseName}.json`, import.meta.url)
const releaseTimestamp = new Date('2026-01-01T00:00:00.000Z')

await mkdir(dist, { recursive: true })
await rm(staging, { recursive: true, force: true })
await rm(archive, { force: true })
for (const path of releaseFiles)
  await cp(new URL(`../${path}`, import.meta.url), new URL(path, staging), { recursive: true })

const zip = new AdmZip()
for (const file of await listFiles(staging)) {
  const entry = zip.addFile(file, await readFile(new URL(file, staging)))
  entry.header.time = releaseTimestamp
}
zip.writeZip(fileURLToPath(archive))
const archiveHash = await sha256(archive)
const entries = await listFiles(staging)
const metadata = {
  format: 'quiet-reader-release',
  formatVersion: 1,
  version: manifest.version,
  extensionName: manifest.name,
  archive: `${releaseName}.zip`,
  sha256: archiveHash,
  files: entries,
}
await writeFile(checksum, `${archiveHash}  ${releaseName}.zip\n`)
await writeFile(releaseManifest, `${JSON.stringify(metadata, null, 2)}\n`)
await rm(staging, { recursive: true, force: true })

console.log(`Created ${archive.pathname}`)
console.log(`SHA-256 ${archiveHash}`)

async function listFiles(directory, prefix = '') {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${entry.name}`
    if (entry.isDirectory()) files.push(...await listFiles(new URL(`${entry.name}/`, directory), `${relative}/`))
    else if (entry.isFile()) files.push(relative)
  }
  return files.sort()
}

async function sha256(url) {
  return createHash('sha256').update(await readFile(url)).digest('hex')
}
