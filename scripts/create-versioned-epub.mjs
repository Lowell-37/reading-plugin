import { mkdir, writeFile } from 'node:fs/promises'

const encoder = new TextEncoder()
const directory = new URL('../tests/fixtures/books/', import.meta.url)

function createEdition(changed) {
  const twin = '<p>Before twin. A worn brass lantern glowed softly beside the door. After twin.</p>'
  const chapters = changed ? [
    chapter('Twin Room', twin),
    chapter('Compass Room', `
      <p>Before marker. The old silver compass pointed north at dawn. After marker.</p>
      <p>Before twin. A brass astrolabe rested quietly beside the door. After twin.</p>`),
    chapter('Twin Room', twin),
  ] : [
    chapter('Opening', '<p>This opening chapter gives the reader a stable first page.</p>'),
    chapter('Compass Room', `
      <p>Before marker. The silver compass pointed north at dawn. After marker.</p>
      <p>Before twin. A brass lantern glowed softly beside the door. After twin.</p>`),
    chapter('Closing', '<p>The final chapter remains unchanged between editions.</p>'),
  ]
  const entries = new Map([
    ['mimetype', encoder.encode('application/epub+zip')],
    ['META-INF/container.xml', encoder.encode(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)],
    ['OEBPS/content.opf', encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">quiet-reader-versioned</dc:identifier>
    <dc:title>Versioned Anchor Test</dc:title><dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-08-03T00:00:00Z</meta>
  </metadata>
  <manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${chapters.map((_, index) => `<item id="c${index + 1}" href="c${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')}
  </manifest>
  <spine>${chapters.map((_, index) => `<itemref idref="c${index + 1}"/>`).join('')}</spine>
</package>`)],
    ['OEBPS/nav.xhtml', encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head>
<body><nav epub:type="toc"><ol>${chapters.map((_, index) => `<li><a href="c${index + 1}.xhtml">Chapter ${index + 1}</a></li>`).join('')}</ol></nav></body></html>`)],
  ])
  chapters.forEach((value, index) => entries.set(`OEBPS/c${index + 1}.xhtml`, encoder.encode(value)))
  return createZip(entries)
}

function chapter(title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body><h1>${title}</h1>${body}</body></html>`
}

function createZip(entries) {
  const localParts = []
  const centralParts = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    localParts.push(local, nameBytes, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBytes)
    offset += local.length + nameBytes.length + data.length
  }
  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.size, 8)
  end.writeUInt16LE(entries.size, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, centralDirectory, end])
}

const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  return crc >>> 0
})

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}


await mkdir(directory, { recursive: true })
await writeFile(new URL('versioned-v1.epub', directory), createEdition(false))
await writeFile(new URL('versioned-v2.epub', directory), createEdition(true))
