import AdmZip from 'adm-zip'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { deflateSync } from 'node:zlib'

const chapterCount = 8
const imageWidth = 1000
const imageHeight = 800
const directory = new URL('../tests/fixtures/books/', import.meta.url)
const fixedTimestamp = new Date(2026, 7, 18, 0, 0, 0)
const archive = new AdmZip({ noSort: true })
const crcTable = Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
  return crc >>> 0
})

add('mimetype', 'application/epub+zip').header.method = 0
add('META-INF/container.xml', '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')

const chapterManifest = Array.from({ length: chapterCount }, (_, index) =>
  `<item id="chapter-${index + 1}" href="chapters/chapter-${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')
const imageManifest = Array.from({ length: chapterCount }, (_, index) =>
  `<item id="photo-${index + 1}" href="images/photo-${index + 1}.png" media-type="image/png"/>`).join('')
const spine = Array.from({ length: chapterCount }, (_, index) =>
  `<itemref idref="chapter-${index + 1}"/>`).join('')
const navigation = Array.from({ length: chapterCount }, (_, index) =>
  `<li><a href="chapters/chapter-${index + 1}.xhtml">Illustrated section ${index + 1}</a></li>`).join('')

add('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">quiet-reader-image-heavy</dc:identifier>
    <dc:title>Image Heavy Compression Stress</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-08-18T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="styles.css" media-type="text/css"/>
    <item id="diagram" href="images/diagram.svg" media-type="image/svg+xml"/>
    ${chapterManifest}${imageManifest}
  </manifest>
  <spine>${spine}</spine>
</package>`)
add('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Contents</title></head><body><nav epub:type="toc"><ol>${navigation}</ol></nav></body></html>`)
add('OEBPS/styles.css', 'body{font-family:serif;line-height:1.7;margin:2rem}img{display:block;width:100%;height:auto;margin:1rem 0}.diagram{max-height:18rem;object-fit:contain;background:#eef3f5}')
add('OEBPS/images/diagram.svg', createCompressibleSvg())

for (let index = 0; index < chapterCount; index += 1) {
  const number = String(index + 1).padStart(3, '0')
  add(`OEBPS/images/photo-${index + 1}.png`, createNoisePng(imageWidth, imageHeight, index + 1))
  add(`OEBPS/chapters/chapter-${index + 1}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Illustrated section ${index + 1}</title><link rel="stylesheet" href="../styles.css"/></head>
<body><h1>IMAGE-HEAVY-SECTION-${number}</h1><p>Mixed-compression image chapter ${index + 1}.</p>
<img src="../images/photo-${index + 1}.png" alt="Deterministic raster ${index + 1}"/>
<img class="diagram" src="../images/diagram.svg" alt="Compressible vector diagram"/></body></html>`)
}

await mkdir(directory, { recursive: true })
archive.writeZip(fileURLToPath(new URL('image-heavy.epub', directory)))

function add(name, content) {
  const entry = archive.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content))
  entry.header.time = fixedTimestamp
  return entry
}

function createCompressibleSvg() {
  const dots = Array.from({ length: 2400 }, (_, index) => {
    const x = 20 + (index % 80) * 12
    const y = 20 + Math.floor(index / 80) * 12
    return `<circle cx="${x}" cy="${y}" r="4" fill="#5f7772"/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="400" viewBox="0 0 1000 400"><rect width="1000" height="400" fill="#eef3f5"/>${dots}</svg>`
}

function createNoisePng(width, height, seed) {
  const scanlines = Buffer.alloc((width * 3 + 1) * height)
  let state = seed >>> 0
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    scanlines[offset++] = 0
    for (let x = 0; x < width * 3; x += 1) {
      state ^= state << 13
      state ^= state >>> 17
      state ^= state << 5
      scanlines[offset++] = state & 0xff
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 2
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(scanlines, { level: 6 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const checksum = Buffer.alloc(4)
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])))
  return Buffer.concat([length, typeBytes, data, checksum])
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]
  return (crc ^ 0xffffffff) >>> 0
}
