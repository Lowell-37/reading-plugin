import { readdir, readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyWxtBuildContract } from './wxt-build-contract.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const outputDirectory = resolve(projectRoot, process.argv[2] ?? '.output/chrome-mv3')
const [rootManifest, builtManifest, files] = await Promise.all([
  readJson(resolve(projectRoot, 'manifest.json')),
  readJson(resolve(outputDirectory, 'manifest.json')),
  listFiles(outputDirectory),
])

const result = verifyWxtBuildContract({ rootManifest, builtManifest, files })
console.log(`Verified WXT build identity and runtime assets (${result.fileCount} files)`)

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

async function listFiles(directory) {
  const files = []
  await visit(directory)
  return files

  async function visit(currentDirectory) {
    for (const entry of await readdir(currentDirectory, { withFileTypes: true })) {
      const path = resolve(currentDirectory, entry.name)
      if (entry.isDirectory()) await visit(path)
      else if (entry.isFile()) files.push(relative(directory, path).replaceAll('\\', '/'))
    }
  }
}
