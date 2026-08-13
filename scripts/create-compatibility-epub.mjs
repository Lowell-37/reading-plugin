import { mkdir, writeFile } from 'node:fs/promises'

const encoder = new TextEncoder()
const directory = new URL('../tests/fixtures/books/', import.meta.url)
const chapters = [
  ['Vertical sample', '<h1>COMPATIBILITY-VERTICAL-TEXT</h1><p>直排中文正文用于验证语言标签、文字方向与标点。</p><p>第二段文字确保正文可读取。</p>'],
  ['Image and note', '<h1>Illustrated chapter</h1><p>IMAGE-AND-NOTE-MARKER<sup><a epub:type="noteref" href="#note-1">1</a></sup></p><img src="../cover.svg" alt="Compatibility illustration"/><aside id="note-1" epub:type="footnote"><p>FOOTNOTE-MARKER: an inline footnote must not hide body text.</p></aside>'],
  ['Long mixed chapter', Array.from({ length: 80 }, (_, index) => `<p>MIXED-PARAGRAPH-${index + 1}: English and 中文 text remain readable in a long chapter.</p>`).join('')],
]
const manifestItems = chapters.map((_, index) => `<item id="c${index + 1}" href="chapters/c${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('')
const spineItems = chapters.map((_, index) => `<itemref idref="c${index + 1}"/>`).join('')
const navItems = `<li><a href="chapters/c1.xhtml">Vertical sample</a></li><li><a href="missing.xhtml">Broken entry</a></li>${chapters.slice(1).map((_, index) => `<li><a href="chapters/c${index + 2}.xhtml">${chapters[index + 1][0]}</a></li>`).join('')}`
const entries = new Map([
  ['mimetype', encoder.encode('application/epub+zip')],
  ['META-INF/container.xml', encoder.encode('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')],
  ['OEBPS/content.opf', encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><package version="3.0" unique-identifier="book-id" xmlns="http://www.idpf.org/2007/opf"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">quiet-reader-compatibility-layout</dc:identifier><dc:title>Compatibility Vertical Text</dc:title><dc:language>zh-Hans</dc:language><meta property="dcterms:modified">2026-08-13T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="style" href="styles.css" media-type="text/css"/><item id="cover" href="cover.svg" media-type="image/svg+xml"/>${manifestItems}</manifest><spine>${spineItems}</spine></package>`)],
  ['OEBPS/nav.xhtml', encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol>${navItems}</ol></nav></body></html>`)],
  ['OEBPS/styles.css', encoder.encode('body{font-family:serif;line-height:1.8} .vertical{writing-mode:vertical-rl;height:18em} img{display:block;width:100%;max-width:640px;height:260px;object-fit:contain} aside{border-inline-start:2px solid #999;padding-inline-start:1em}')],
  ['OEBPS/cover.svg', encoder.encode('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="260"><rect width="640" height="260" fill="#c9d9d6"/><text x="80" y="135" font-size="34">Compatibility image</text></svg>')],
])
chapters.forEach(([title, body], index) => entries.set(`OEBPS/chapters/c${index + 1}.xhtml`, encoder.encode(`<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>${title}</title><link rel="stylesheet" href="../styles.css"/></head><body${index === 0 ? ' class="vertical"' : ''}>${body}</body></html>`)))
await mkdir(directory, { recursive: true })

function createZip(entries) {
  const localParts = []; const centralParts = []; let offset = 0
  for (const [name, data] of entries) {
    const nameBytes = encoder.encode(name); const crc = crc32(data); const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26)
    localParts.push(local, nameBytes, data)
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(crc, 16); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42)
    centralParts.push(central, nameBytes); offset += local.length + nameBytes.length + data.length
  }
  const centralDirectory = Buffer.concat(centralParts); const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10); end.writeUInt32LE(centralDirectory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, centralDirectory, end])
}

const crcTable = Array.from({ length: 256 }, (_, value) => { let crc = value; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); return crc >>> 0 })
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff]; return (crc ^ 0xffffffff) >>> 0 }

await writeFile(new URL('compatibility-layout.epub', directory), createZip(entries))
