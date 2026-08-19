import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

export const TEST_BOOKS = [
  { name: 'alice.epub', format: 'epub', url: 'https://www.gutenberg.org/ebooks/11.epub3.images' },
  { name: 'alice.mobi', format: 'mobi', url: 'https://www.gutenberg.org/ebooks/11.kindle.images' },
  { name: 'alice.azw3', format: 'azw3', url: 'https://www.gutenberg.org/ebooks/11.kf8.images' },
  {
    name: 'water-margin.epub',
    format: 'epub',
    title: '水滸傳',
    license: 'Project Gutenberg public domain in the USA',
    url: 'https://www.gutenberg.org/ebooks/23863.epub3.images',
    sha256: 'e764b737e341283ad10b42df6ce5846b1752655b34427b0b8fd1355e335cf980',
  },
  {
    name: 'peter-rabbit.epub',
    format: 'epub',
    title: 'The Tale of Peter Rabbit',
    creator: 'Beatrix Potter',
    source: 'GITenberg release 0.1.0 / Project Gutenberg eBook #14838',
    license: 'Public domain in the USA; check local law outside the USA',
    licenseUrl: 'https://www.gutenberg.org/policy/license',
    url: 'https://github.com/GITenberg/The-Tale-of-Peter-Rabbit_14838/releases/download/0.1.0/book.epub',
    sha256: '4865e0cfbfe7f1218f43f4ef7e8e31647ec227ecb59cc520abbe4a39e9a4a000',
  },
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
  const hash = createHash('sha256').update(bytes).digest('hex')
  if (book.sha256 && book.sha256 !== hash) {
    throw new Error(`Fixture checksum changed for ${book.name}; delete it and review the upstream revision before accepting ${hash}`)
  }
  book.bytes = bytes.length
  book.sha256 = hash
}

await import('./create-boundary-epub.mjs')
await import('./create-compatibility-epub.mjs')
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
