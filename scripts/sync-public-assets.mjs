import { cp, mkdir, rm } from 'node:fs/promises'

const target = new URL('../public/node_modules/pdfjs-dist/', import.meta.url)
const iconTarget = new URL('../public/assets/', import.meta.url)
await rm(target, { recursive: true, force: true })
await mkdir(new URL('build/', target), { recursive: true })
await mkdir(iconTarget, { recursive: true })

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
  ...[16, 32, 48, 128].map(size => cp(
    new URL(`../assets/icon-${size}.png`, import.meta.url),
    new URL(`icon-${size}.png`, iconTarget),
  )),
])
