import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'

export const TEST_BOOKS = [
  { name: 'alice.epub', format: 'epub', url: 'https://www.gutenberg.org/ebooks/11.epub3.images' },
  { name: 'alice.mobi', format: 'mobi', url: 'https://www.gutenberg.org/ebooks/11.kindle.images' },
  { name: 'alice.azw3', format: 'azw3', url: 'https://www.gutenberg.org/ebooks/11.kf8.images' },
  {
    name: 'frankenstein-gutenberg.mobi',
    format: 'mobi',
    title: 'Frankenstein; Or, The Modern Prometheus',
    creator: 'Mary Wollstonecraft Shelley',
    source: 'Project Gutenberg eBook #84 older Kindle/MOBI image edition, downloaded 2026-10-15; fixture committed to this repository',
    license: 'Project Gutenberg public domain in the USA; check local law outside the USA',
    licenseUrl: 'https://www.gutenberg.org/policy/license',
    url: 'https://www.gutenberg.org/cache/epub/84/pg84-images.mobi',
    sha256: '87d68581b9f1ff1b1caf7b01691be0ebe579b62c96418822f87fed5770b70d09',
  },
  {
    name: 'water-margin.epub',
    format: 'epub',
    title: '水滸傳',
    source: 'Project Gutenberg eBook #23863 EPUB3 snapshot, package modified 2026-08-10; fixture committed to this repository',
    license: 'Project Gutenberg public domain in the USA',
    url: 'https://www.gutenberg.org/ebooks/23863.epub3.images',
    sha256: 'e764b737e341283ad10b42df6ce5846b1752655b34427b0b8fd1355e335cf980',
  },
  {
    name: 'water-margin-gitenberg.mobi',
    format: 'mobi',
    title: '水滸傳',
    creator: "Nai'an Shi",
    source: 'GITenberg release 0.1.0 / Project Gutenberg eBook #23863; fixture committed to this repository',
    license: 'Project Gutenberg public domain in the USA; check local law outside the USA',
    licenseUrl: 'https://www.gutenberg.org/policy/license',
    url: 'https://github.com/GITenberg/---_23863/releases/download/0.1.0/book.mobi',
    sha256: '8077de1e2912f17c12fb9c7034cb45c83830bc0d73a4c651c1099e45e96d0921',
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
    name: 'dracula-standard-ebooks.epub',
    format: 'epub',
    title: 'Dracula',
    creator: 'Bram Stoker',
    source: 'Standard Ebooks compatible EPUB, package version e9e81aadf8b235fb6498728bce54b0967e224612-4.0.3-epub/compatible, modified 2026-08-04; fixture committed to this repository',
    license: 'Source text and artwork believed public domain in the USA; Standard Ebooks contributions CC0 1.0; check local law outside the USA',
    licenseUrl: 'https://standardebooks.org/ebooks/bram-stoker/dracula',
    url: 'https://standardebooks.org/ebooks/bram-stoker/dracula/downloads/bram-stoker_dracula.epub?source=download',
    sha256: '568ee9d37b2cc12dfd5e24ebf7b16ae71a805e269af159dc836647751739340a',
  },
  {
    name: 'dracula-standard-ebooks.azw3',
    format: 'azw3',
    title: 'Dracula',
    creator: 'Bram Stoker',
    source: 'Standard Ebooks AZW3 download on 2026-10-15; fixture committed to this repository',
    license: 'Source text and artwork believed public domain in the USA; Standard Ebooks contributions CC0 1.0; check local law outside the USA',
    licenseUrl: 'https://standardebooks.org/ebooks/bram-stoker/dracula',
    url: 'https://standardebooks.org/ebooks/bram-stoker/dracula/downloads/bram-stoker_dracula.azw3?source=download',
    sha256: '0ee71a7b6e692ccf9ea993a2dbf79359dd637260383c546c0e6cad8be7b51b84',
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
