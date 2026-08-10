import { cp, mkdir, rm } from 'node:fs/promises'

const target = new URL('../public/node_modules/pdfjs-dist/', import.meta.url)
await rm(target, { recursive: true, force: true })
await mkdir(new URL('build/', target), { recursive: true })

await Promise.all([
  cp(
    new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
    new URL('build/pdf.worker.min.mjs', target),
  ),
  ...['cmaps', 'standard_fonts', 'wasm'].map(directory => cp(
    new URL(`../node_modules/pdfjs-dist/${directory}/`, import.meta.url),
    new URL(`${directory}/`, target),
    { recursive: true },
  )),
])
