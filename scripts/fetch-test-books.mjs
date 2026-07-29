import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

export const TEST_BOOKS = [
  { name: 'alice.epub', format: 'epub', url: 'https://www.gutenberg.org/ebooks/11.epub3.images' },
  { name: 'alice.mobi', format: 'mobi', url: 'https://www.gutenberg.org/ebooks/11.kindle.images' },
  { name: 'alice.azw3', format: 'azw3', url: 'https://www.gutenberg.org/ebooks/11.kf8.images' },
  {
    name: 'tracemonkey.pdf',
    format: 'pdf',
    url: 'https://raw.githubusercontent.com/mozilla/pdf.js/master/web/compressed.tracemonkey-pldi-09.pdf',
  },
]

const directory = new URL('../tests/fixtures/books/', import.meta.url)
await mkdir(directory, { recursive: true })

for (const book of TEST_BOOKS) {
  const target = new URL(book.name, directory)
  let bytes
  try {
    bytes = await readFile(target)
  } catch {
    bytes = await downloadWithRetry(book.url)
    if (bytes.length < 1024) throw new Error(`Downloaded fixture is unexpectedly small: ${book.name}`)
    await writeFile(target, bytes)
  }
  book.bytes = bytes.length
  book.sha256 = createHash('sha256').update(bytes).digest('hex')
}

await import('./create-boundary-epub.mjs')
await writeFile(new URL('manifest.json', directory), `${JSON.stringify(TEST_BOOKS, null, 2)}\n`)

async function downloadWithRetry(url, attempts = 4) {
  let lastError
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: 'follow' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return Buffer.from(await response.arrayBuffer())
    } catch (error) {
      lastError = error
      if (attempt < attempts) await new Promise(resolve => setTimeout(resolve, attempt * 750))
    }
  }
  throw new Error(`Failed to download ${url} after ${attempts} attempts`, { cause: lastError })
}
