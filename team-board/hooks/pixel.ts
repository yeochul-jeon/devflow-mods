// 픽셀 그림: 한 칸에 ▀ 하나로 위아래 두 픽셀을 칠해 Raster 셀을 만든다.

export type RasterCells = { columns: number; rows: number; cells: string }

function base64(bytes: Uint8Array): string {
  const native = bytes as Uint8Array & { toBase64?: () => string }
  if (native.toBase64) return native.toBase64()
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/** 카드 타일 캐릭터 (T43). 몸 색은 세션, 바탕색은 상태가 말한다. */
export type Species = 'blob' | 'bot' | 'ghost'
/** 고른 모양: 한 캐릭터, 또는 세션 이름으로 섞기 */
export type Look = Species | 'mix'
export type Pose = 'work' | 'ask' | 'fail' | 'idle' | 'stale'

export const SPECIES_NAME: Record<Species, string> = { blob: '말랑이', bot: '삐삐', ghost: '둥실' }

/** 세션 몸 색 6가지. 어두운 카드 바탕과 작업 중 바탕 위에서 읽힌다 */
export const HUES = ['#fb923c', '#34d399', '#a78bfa', '#f472b6', '#7dd3fc', '#bef264'] as const

// 몸: 8×6 픽셀 두 프레임 (B 몸, b 그늘, E 눈, M 입, A 안테나). 작업 중에만 두 번째 프레임
const BODY: Record<Species, readonly [readonly string[], readonly string[]]> = {
  blob: [
    ['..BBBB..', '.BBBBBB.', '.BEBBEB.', 'BBBBBBBB', 'bBBBBBBb', '.bb..bb.'],
    ['........', '..BBBB..', '.BEBBEB.', 'BBBBBBBB', 'bBBBBBBb', 'bbbbbbbb'],
  ],
  bot: [
    ['...A....', '.BBBBBB.', '.BEBBEB.', '.BBMMBB.', '..bBBb..', '..b..b..'],
    ['....A...', '.BBBBBB.', '.BEBBEB.', '.BBMMBB.', '..bBBb..', '.b....b.'],
  ],
  ghost: [
    ['..BBBB..', '.BBBBBB.', '.BEBBEB.', '.BBBBBB.', '.BBBBBB.', '.B.BB.B.'],
    ['..BBBB..', '.BBBBBB.', '.BEBBEB.', '.BBBBBB.', '.BBBBBB.', '..B..B.B'],
  ],
}
// 보조를 부리는 세션의 왕관: 몸 위 2픽셀
const CROWN = ['..H..H..', '..HHHH..']
const CROWN_COLOR = '#fde047'
const ZZ_COLOR = '#cbd5e1'
const EYE_COLOR = '#0b1220'

function hash(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.codePointAt(0)!) >>> 0
  return h
}

/** 세션 이름으로 캐릭터와 몸 색을 고정한다. 섞기면 3 × 6 = 18 조합 */
export function characterOf(look: Look, name: string): { species: Species; hue: string } {
  const h = hash(name)
  const species: Species = look === 'mix' ? (['blob', 'bot', 'ghost'] as const)[h % 3]! : look
  return { species, hue: HUES[(look === 'mix' ? Math.floor(h / 3) : h) % HUES.length]! }
}

/**
 * 채널마다 16단계(0x00, 0x11, … 0xff)로 맞춘 색. 터미널 Raster 는 이 단계로 칠한다 (2.1.311 실측: #0f1730 → #111133).
 * 타일을 감싼 Box 바탕도 같은 값으로 칠해야 그림과 여백 색이 갈라지지 않는다
 */
export function snapHex(color: string): string {
  const c = hex(color)
  return '#' + [16, 8, 0].map(s => (Math.round(((c >> s) & 0xff) / 17) * 17).toString(16).padStart(2, '0')).join('')
}

export function mixHex(a: string, b: string, t: number): string {
  const [x, y] = [hex(a), hex(b)]
  const ch = (v: number, s: number) => (v >> s) & 0xff
  const out = [16, 8, 0].map(s => Math.round(ch(x, s) * (1 - t) + ch(y, s) * t))
  return '#' + out.map(v => v.toString(16).padStart(2, '0')).join('')
}

/**
 * 캐릭터 한 프레임을 8칸 × 4행(왕관 자리 포함) 또는 3행(몸만) Raster 로. 칸마다 ▀ 하나: 글자색 = 위 픽셀, 바탕색 = 아래 픽셀.
 * 결정 대기·숨은 실패는 어두운 실루엣에 바탕색 눈 (노랑·빨강 바탕에서 경고가 먼저 보이게).
 */
export function character(o: { species: Species; pose: Pose; frame: number; hue: string; leader: boolean; rows: 3 | 4; bg: string; dark: string; dim: string }): RasterCells {
  const art = BODY[o.species][o.pose === 'work' && o.frame % 2 ? 1 : 0]
  const dark = o.pose === 'ask' || o.pose === 'fail'
  const body = dark ? o.dark : o.pose === 'stale' ? o.dim : o.hue
  const shade = dark ? o.dark : mixHex(body, '#000000', 0.32)
  const closed = o.pose === 'idle' || o.pose === 'stale'
  const top = o.rows === 4 ? 2 : 0
  const px: (string | null)[][] = Array.from({ length: o.rows * 2 }, () => Array<string | null>(8).fill(null))
  art.forEach((row, y) =>
    [...row].forEach((c, x) => {
      const color =
        c === 'B' ? body
        : c === 'b' ? shade
        : c === 'E' ? (closed ? shade : dark ? o.bg : EYE_COLOR)
        : c === 'M' ? (dark ? o.bg : EYE_COLOR)
        : c === 'A' ? (dark ? o.dark : mixHex(o.hue, '#ffffff', 0.45))
        : null
      if (color) px[y + top]![x] = color
    }),
  )
  if (o.leader && top) CROWN.forEach((row, y) => [...row].forEach((c, x) => { if (c === 'H') px[y]![x] = dark ? o.dark : CROWN_COLOR }))
  if (o.pose === 'stale') px[0]![6] = px[0]![7] = px[1]![7] = ZZ_COLOR
  const bg = hex(o.bg)
  const words: number[] = []
  for (let y = 0; y < o.rows * 2; y += 2) {
    for (let x = 0; x < 8; x++) {
      const top = px[y]![x]
      const bottom = px[y + 1]![x]
      words.push(0x2580, top ? hex(top) : bg, bottom ? hex(bottom) : bg)
    }
  }
  return { columns: 8, rows: o.rows, cells: base64(new Uint8Array(Uint32Array.from(words).buffer)) }
}

export function hex(color: string): number {
  return parseInt(color.replace('#', ''), 16) & 0xffffff
}

/** /board 캐릭터 인자: 한글 이름(말랑이·삐삐·둥실·섞기) 또는 영문(blob·bot·ghost·mix). 모르면 null */
export function parseLook(arg: string): Look | null {
  const a = arg.trim().toLowerCase()
  if (a === 'mix' || a === '섞기') return 'mix'
  for (const s of ['blob', 'bot', 'ghost'] as const) if (a === s || a === SPECIES_NAME[s]) return s
  return null
}
