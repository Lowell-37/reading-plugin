import { mkdir, writeFile } from 'node:fs/promises'

const encoder = new TextEncoder()
const chapters = [
  chapter('Short opening', '<p>SHORT-CHAPTER-START</p>'),
  emptyChapter('Blank chapter'),
  chapter('Image chapter', '<p>IMAGE-CHAPTER</p><img src="../image.svg" alt="Boundary illustration"/>'),
  chapter('Long chapter', Array.from({ length: 140 }, (_, index) =>
    `<p>LONG-PARAGRAPH-${String(index + 1).padStart(3, '0')} — This paragraph makes the chapter tall enough to test stable scrolling inside one section.</p>`).join('')),
  ...Array.from({ length: 10 }, (_, index) =>
    chapter(`Short chapter ${index + 5}`, `<p>SHORT-CHAPTER-${index + 5}</p><p>Next chapter content.</p>`)),
]

const manifestItems = chapters.map((_, index) =>
  `<item id="c${index + 1}" href="chapters/c${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')
const spineItems = chapters.map((_, index) => `<itemref idref="c${index + 1}"/>`).join('')
const navItems = chapters.map((_, index) =>
  `<li><a href="chapters/c${index + 1}.xhtml">Chapter ${index + 1}</a></li>`).join('')

const entries = new Map([
  ['mimetype', encoder.encode('application/epub+zip')],
  ['META-INF/container.xml', encoder.encode(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>`)],
  ['OEBPS/content.opf', encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">quiet-reader-boundaries</dc:identifier>
    <dc:title>Continuous Boundaries</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-07-29T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="styles.css" media-type="text/css"/>
    <item id="image" href="image.svg" media-type="image/svg+xml"/>
    ${manifestItems}
  </manifest>
  <spine>${spineItems}</spine>
</package>`)],
  ['OEBPS/nav.xhtml', encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body><nav epub:type="toc"><ol>${navItems}</ol></nav></body></html>`)],
  ['OEBPS/styles.css', encoder.encode('body{font-family:serif;line-height:1.7} img{display:block;width:100%;height:420px;object-fit:contain}')],
  ['OEBPS/image.svg', encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420"><rect width="800" height="420" fill="#d9c7a2"/><text x="80" y="220" font-size="52">Boundary image</text></svg>')],
])

chapters.forEach((content, index) => entries.set(`OEBPS/chapters/c${index + 1}.xhtml`, encoder.encode(content)))
const directory = new URL('../tests/fixtures/books/', import.meta.url)
await mkdir(directory, { recursive: true })
function chapter(title, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link rel="stylesheet" href="../styles.css"/></head>
<body><h1>${title}</h1>${body}</body></html>`
}

function emptyChapter(title) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title><link rel="stylesheet" href="../styles.css"/></head>
<body></body></html>`
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

await writeFile(new URL('boundaries.epub', directory), createZip(entries))
