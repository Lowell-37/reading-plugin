import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

export const storePromos = Object.freeze([
  Object.freeze({ name: 'promo-small.png', width: 440, height: 280, variant: 'small' }),
  Object.freeze({ name: 'promo-marquee.png', width: 1400, height: 560, variant: 'marquee' }),
])

export async function storePromoFingerprint() {
  const icon = normalizeLineEndings(await readFile(new URL('../assets/icon.svg', import.meta.url), 'utf8'))
  return createHash('sha256')
    .update(JSON.stringify(storePromos))
    .update('\0')
    .update(normalizeLineEndings(renderStorePromo.toString()))
    .update('\0')
    .update(icon)
    .digest('hex')
}

function normalizeLineEndings(value) {
  return value.replace(/\r\n/g, '\n')
}

export function renderStorePromo(variant, iconSvg) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}
body{background:radial-gradient(circle at 8% 8%,rgba(200,97,64,.82) 0 10%,transparent 34%),radial-gradient(circle at 92% 88%,rgba(214,160,98,.34) 0 12%,transparent 35%),linear-gradient(135deg,#17261f 0%,#2e493a 58%,#1d3028 100%)}
.grain{position:absolute;inset:0;opacity:.2;background-image:url("data:image/svg+xml,%3Csvg viewBox='0 0 160 160' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.18'/%3E%3C/svg%3E")}
.promo{position:relative;width:100%;height:100%}.brand-icon{position:absolute;filter:drop-shadow(0 18px 30px rgba(8,18,13,.32))}.brand-icon svg{display:block;width:100%;height:100%}
.reader-card{position:absolute;overflow:hidden;background:linear-gradient(145deg,rgba(255,250,240,.98),rgba(234,223,205,.95));border:1px solid rgba(255,255,255,.58);box-shadow:0 26px 60px rgba(7,17,12,.34)}
.reader-card::before{content:"";position:absolute;inset:0;background:radial-gradient(circle at 100% 0,rgba(200,97,64,.18),transparent 32%)}
.reader-card::after{content:"";position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(145,59,38,.16)}
.book-line{position:absolute;height:3px;border-radius:3px;background:#b9a994;opacity:.72}.book-line.accent{height:6px;background:#b94e31;opacity:.95}
.orbit{position:absolute;border:1px solid rgba(234,223,205,.2);border-radius:999px}.bookmark{position:absolute;background:#c86140;box-shadow:0 16px 30px rgba(8,18,13,.22);transform:rotate(10deg)}
.bookmark::after{content:"";position:absolute;left:0;right:0;bottom:-1px;margin:auto;width:0;height:0;border-left:12px solid transparent;border-right:12px solid transparent;border-bottom:12px solid #264235}
.small .brand-icon{width:128px;height:128px;left:46px;top:76px}.small .reader-card{right:-28px;bottom:25px;width:230px;height:155px;border-radius:25px;transform:rotate(-8deg)}
.small .book-line:nth-child(1){left:13%;top:28%;width:30%}.small .book-line:nth-child(2){left:13%;top:46%;width:31%}.small .book-line:nth-child(3){left:13%;top:62%;width:24%}.small .book-line:nth-child(4){left:58%;top:28%;width:28%}.small .book-line:nth-child(5){left:58%;top:46%;width:22%}.small .book-line:nth-child(6){left:58%;top:62%;width:29%}
.small .orbit{width:214px;height:214px;left:3px;top:33px}.small .bookmark{width:27px;height:58px;left:181px;top:51px;border-radius:6px 6px 0 0}
.marquee .brand-icon{width:230px;height:230px;left:180px;top:165px}.marquee .reader-card{right:-40px;top:70px;width:620px;height:420px;border-radius:42px 0 0 42px;transform:rotate(-4deg)}
.marquee .book-line:nth-child(1){left:13%;top:23%;width:25%}.marquee .book-line:nth-child(2){left:13%;top:36%;width:31%}.marquee .book-line:nth-child(3){left:13%;top:49%;width:27%}.marquee .book-line:nth-child(4){left:58%;top:23%;width:28%}.marquee .book-line:nth-child(5){left:58%;top:36%;width:20%}.marquee .book-line:nth-child(6){left:58%;top:49%;width:30%}
.marquee .orbit{width:360px;height:360px;left:115px;top:100px}.marquee .bookmark{width:44px;height:100px;left:475px;top:137px;border-radius:9px 9px 0 0}.marquee .bookmark::after{border-left-width:22px;border-right-width:22px;border-bottom-width:22px}
</style></head><body><div class="grain"></div><main class="promo ${variant}"><div class="orbit"></div><div class="brand-icon">${iconSvg}</div><div class="bookmark"></div><div class="reader-card" aria-hidden="true"><i class="book-line accent"></i><i class="book-line"></i><i class="book-line"></i><i class="book-line accent"></i><i class="book-line"></i><i class="book-line"></i></div></main></body></html>`
}
