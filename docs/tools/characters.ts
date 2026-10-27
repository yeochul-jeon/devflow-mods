// team-board 카드 캐릭터 표(docs/images/team-board-characters.webp)를 pixel.ts 의 character() 로 그린다.
// Raster 칸의 ▀ 글자색(위 픽셀)·바탕색(아래 픽셀)을 그대로 옮기므로 터미널에 칠해지는 색과 같다. 색은 night 팔레트.
// 다시 그리기 (캐릭터·색을 바꾼 뒤):
//   bun docs/tools/characters.ts /tmp/x/characters.html
//   "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
//     --force-device-scale-factor=2 --window-size=760,660 --screenshot=/tmp/x/characters.png file:///tmp/x/characters.html
//   cwebp -q 90 /tmp/x/characters.png -o docs/images/team-board-characters.webp
import { paletteOf } from '../../team-board/hooks/palette.ts'
import { character, HUES, mixHex, snapHex, type Pose, type Species } from '../../team-board/hooks/pixel.ts'

const P = paletteOf('night')
const bgOf = (p: Pose) => snapHex(p === 'fail' ? P.bad : p === 'ask' ? P.ask : p === 'work' ? mixHex(P.work, P.card, 0.72) : p === 'idle' ? P.frame : P.card)
const PX = 9

function tile(o: { species: Species; pose: Pose; hue: string; leader?: boolean; rows?: 3 | 4; frame?: number }) {
  const bg = bgOf(o.pose)
  const r = character({ species: o.species, pose: o.pose, frame: o.frame ?? 0, hue: o.hue, leader: !!o.leader, rows: o.rows ?? 4, bg, dark: P.onBadge, dim: P.dim })
  const bytes = Uint8Array.from(atob(r.cells), c => c.charCodeAt(0))
  const w = new Uint32Array(bytes.buffer)
  const hex = (n: number) => '#' + (n & 0xffffff).toString(16).padStart(6, '0')
  let rects = ''
  for (let y = 0; y < r.rows; y++) for (let x = 0; x < r.columns; x++) {
    const i = (y * r.columns + x) * 3
    rects += `<rect x="${x}" y="${y * 2}" width="1" height="1" fill="${hex(w[i + 1]!)}"/><rect x="${x}" y="${y * 2 + 1}" width="1" height="1" fill="${hex(w[i + 2]!)}"/>`
  }
  // 상자 여백(좌우 1칸)까지 같은 바탕
  return `<div class="t" style="background:${bg}"><svg viewBox="0 0 8 ${r.rows * 2}" width="${8 * PX}" height="${r.rows * 2 * PX}" shape-rendering="crispEdges">${rects}</svg></div>`
}

const SP: [Species, string][] = [['blob', '말랑이 (기본)'], ['bot', '삐삐'], ['ghost', '둥실']]
const ST: [Pose, string][] = [['work', '작업중'], ['ask', '결정 대기'], ['fail', '숨은 실패'], ['idle', '대기'], ['stale', '소식없음']]
let html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#111827;color:${P.text};font:15px "D2Coding ligature","D2Coding",monospace;padding:22px}
table{border-collapse:collapse}td,th{padding:7px 10px;text-align:center;vertical-align:middle}th{color:${P.dim};font-weight:400}
td.n{text-align:left;color:${P.text};white-space:nowrap}.t{display:inline-block;padding:0 9px;line-height:0}
h3{margin:18px 0 8px;font-size:15px;color:${P.dim};font-weight:400}.row{display:flex;gap:18px;align-items:flex-end}.c{display:grid;gap:6px;justify-items:center;color:${P.dim};font-size:13px}
</style><table><tr><th></th>${ST.map(s => `<th>${s[1]}</th>`).join('')}</tr>`
for (const [sp, name] of SP) html += `<tr><td class="n">${name}</td>${ST.map(([p]) => `<td>${tile({ species: sp, pose: p, hue: HUES[0] })}</td>`).join('')}</tr>`
html += `</table><h3>리더 왕관 · 짧은 머리 3행 · 작업중 두 프레임 (0.8초마다)</h3><div class="row">`
html += `<div class="c">${tile({ species: 'blob', pose: 'work', hue: HUES[2], leader: true })}리더</div>`
html += `<div class="c">${tile({ species: 'blob', pose: 'idle', hue: HUES[3], rows: 3 })}짧은 머리</div>`
html += `<div class="c">${tile({ species: 'blob', pose: 'work', hue: HUES[0], frame: 0 })}프레임 1</div><div class="c">${tile({ species: 'blob', pose: 'work', hue: HUES[0], frame: 1 })}프레임 2</div>`
html += `</div><h3>세션 색 6가지 (세션 이름으로 정해짐)</h3><div class="row">`
html += HUES.map(h => `<div class="c">${tile({ species: 'blob', pose: 'idle', hue: h, rows: 3 })}</div>`).join('')
html += `</div>`
await Bun.write(process.argv[2]!, html)
