// team-board/hooks/diagram.ts 의 cells·wrap 에서 시작 (plugin 끼리 의존하지 않는다). 그림은 단계 상자를 폭에 맞춰 여러 줄로 접고, 보이는 줄이 모자라면 흐름마다 칩 줄로 압축한다.
// 모델에게는 내용(JSON)만 받고, 그림은 여기서 한글 폭(2칸)을 계산해 직접 그려서 상자가 어긋나지 않게 한다.

import { MAX_STEPS } from './prompt'

/** 터미널에서 차지하는 칸 수: 한글·한자·전각은 2칸. */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (c === 0x200d || (c >= 0x300 && c <= 0x36f) || (c >= 0xfe00 && c <= 0xfe0f)) continue
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0x303e) ||
      (c >= 0x3041 && c <= 0x33ff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0xa960 && c <= 0xa97f) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff)
    n += wide ? 2 : 1
  }
  return n
}

/** max 칸을 넘으면 … 로 자른다. */
export function clip(text: string, max: number): string {
  if (cells(text) <= max) return text
  let out = ''
  for (const ch of text) {
    if (cells(out + ch) > max - 1) break
    out += ch
  }
  return out + '…'
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - cells(text)))
}

// ①②③④ 는 터미널에 따라 1칸·2칸으로 갈리는 문자라(East Asian Ambiguous) 칩 줄 들여쓰기가 어긋날 수 있어 폭이 확실한 숫자를 쓴다
export const NUMS = ['1.', '2.', '3.', '4.']

/** 접힌 상자 한 줄: 상자마다 이름 줄들, 다음 줄로 이어지면 more. */
export type BoxRow = { boxes: string[][]; more: boolean }

/**
 * 단계 상자를 패널 폭에 맞춰 여러 줄로 나눈다. 그리기는 엔진 Box 테두리가 하고, 줄 나누기는 여기서 한다
 * (엔진의 flexWrap 은 몇 줄이 됐는지 hook 에 알려 주지 않아 압축형으로 바꿀지 정할 수 없다).
 * 상자 폭은 이름 칸 + 4(테두리·안쪽 여백), 상자 사이 " → " 3칸, 다음 줄로 이어지면 끝에 " →" 2칸.
 * 이름이 상자 안 폭을 넘으면 자르지 않고 상자 안에서 줄을 바꾼다.
 */
export function packRows(steps: readonly string[], maxWidth: number): BoxRow[] {
  const labels = steps.map(s => s.trim()).filter(Boolean).slice(0, MAX_STEPS)
  const inner = Math.max(4, maxWidth - 6)
  const boxes = labels.map(l => (cells(l) <= inner ? [l] : wrap(l, inner)))
  const rows: string[][][] = []
  let cur: string[][] = []
  let used = 0
  boxes.forEach((b, i) => {
    const bw = Math.max(...b.map(cells)) + 4
    const isLast = i === boxes.length - 1
    if (cur.length && used + 3 + bw + (isLast ? 0 : 2) > maxWidth) {
      rows.push(cur)
      cur = []
      used = 0
    }
    used += (cur.length ? 3 : 0) + bw
    cur.push(b)
  })
  if (cur.length) rows.push(cur)
  return rows.map((r, i) => ({ boxes: r, more: i < rows.length - 1 }))
}

/** 상자 줄의 높이: 테두리 2줄 + 가장 긴 상자의 이름 줄 수. */
export function rowHeight(row: BoxRow): number {
  return 2 + Math.max(...row.boxes.map(b => b.length))
}

export type Segment = { text: string; kind: 'head' | 'pad' | 'chip' | 'arrow' }

/**
 * 압축형 흐름 한 개: "1. 이름  칩 → 칩 →" 을 폭에 맞춰 잇고, 넘치면 이름 뒤 위치로 들여 써서 다음 줄에 잇는다.
 * 칩은 이름 그대로(배경색은 그리는 쪽이 칠하고, 칩 사이는 " → " 가 띄운다). 칩 하나가 한 줄을 넘으면 칩을 나눠 줄마다 잇는다.
 * 칩 앞뒤에 여백을 두면 80×24 패널(74칸)에서 흐름 4개가 6줄을 넘었다.
 */
export function compactLines(head: string, steps: readonly string[], maxWidth: number): Segment[][] {
  const labels = steps.map(s => s.trim()).filter(Boolean).slice(0, MAX_STEPS)
  // 머리가 폭의 절반을 넘으면 머리만 한 줄에 두고 칩은 다음 줄에서 2칸 들여 시작한다
  const isLongHead = cells(head) + 2 > maxWidth / 2
  const indent = isLongHead ? 2 : cells(head) + 2
  const lines: Segment[][] = [isLongHead ? [{ text: head, kind: 'head' }] : [{ text: head, kind: 'head' }, { text: '  ', kind: 'pad' }]]
  let cur = lines[0]!
  let used = cells(head) + 2
  const newLine = () => {
    cur = [{ text: ' '.repeat(indent), kind: 'pad' }]
    lines.push(cur)
    used = indent
  }
  if (isLongHead) newLine()
  labels.forEach((l, i) => {
    const isLast = i === labels.length - 1
    const tail = isLast ? 0 : 2
    if (i > 0) {
      if (used + 3 + cells(l) + tail > maxWidth) {
        cur.push({ text: ' →', kind: 'arrow' })
        newLine()
      } else {
        cur.push({ text: ' → ', kind: 'arrow' })
        used += 3
      }
    }
    // 남은 칸에 안 들어가면 새 줄에서 시작한다 (머리가 길 때 칩이 몇 칸짜리 조각으로 갈리지 않게)
    if (used > indent && cells(l) > maxWidth - used - tail) {
      if (i > 0 && cur[cur.length - 1]?.kind === 'arrow') cur[cur.length - 1] = { text: ' →', kind: 'arrow' }
      newLine()
    }
    const pieces = wrap(l, Math.max(4, maxWidth - used - tail))
    pieces.forEach((piece, k) => {
      if (k > 0) newLine()
      cur.push({ text: piece, kind: 'chip' })
      used += cells(piece)
    })
  })
  return lines
}

type Drawable = { title: string; flows: ReadonlyArray<{ label: string; steps: readonly string[] }>; notes: readonly string[] }

export function flowHead(label: string, i: number): string {
  return label ? `${NUMS[i] ?? ''} ${label}` : (NUMS[i] ?? '')
}

/** 상자 그림 전체의 줄 수: 제목·초점(긴 줄은 접힘), 흐름마다 빈 줄 + 이름 + 상자 줄들, 메모(빈 줄 + 줄마다, 긴 줄은 접힘). */
export function fullHeight(d: Drawable, maxWidth: number, focus: string): number {
  const rows = (text: string) => Math.ceil(cells(text) / maxWidth)
  let h = (d.title ? rows(d.title) : 0) + (focus ? rows(`초점: ${focus}`) : 0)
  d.flows.forEach((f, i) => {
    // 흐름 이름이 폭을 넘으면 Text 가 줄을 바꾼다
    h += 1 + Math.ceil(cells(flowHead(f.label, i)) / maxWidth) + packRows(f.steps, maxWidth).reduce((a, r) => a + rowHeight(r), 0)
  })
  if (d.notes.length) h += 1 + d.notes.reduce((a, n) => a + Math.ceil(cells(`· ${n}`) / maxWidth), 0)
  return h
}

/** 압축형 줄 수: 제목·초점은 빼고 흐름마다 칩 줄들(머리만 있는 줄은 접힐 수 있음), 메모는 개수 한 줄. */
export function compactHeight(d: Drawable, maxWidth: number): number {
  const flows = d.flows.reduce((a, f, i) => {
    const head = flowHead(f.label, i)
    const lines = compactLines(head, f.steps, maxWidth)
    return a + lines.length + (lines[0]!.length === 1 ? Math.ceil(cells(head) / maxWidth) - 1 : 0)
  }, 0)
  return flows + (d.notes.length ? 1 : 0)
}

/**
 * 프롬프트 위 패널(inline)·데스크톱 위젯(widget)에서 제목과 흐름 상자가 보이는 줄 수를 넘으면 compact, 그 밖에는 full.
 * 옆에 붙은 패널(dock)은 늘 full: 줄이 넉넉하고 화살표로 스크롤된다 (사용자 결정 2026-11-15).
 * 메모는 세지 않는다: 맨 아래라 스크롤로 볼 수 있고, 압축형으로 바꿀 이유는 흐름이 가려질 때다.
 */
export function chooseLayout(
  d: Drawable,
  maxWidth: number,
  view: { placement?: string; bodyRows?: number },
  focus: string,
): 'full' | 'compact' {
  if (view.placement !== 'inline' && view.placement !== 'widget') return 'full'
  if (!view.bodyRows) return 'full'
  return fullHeight({ ...d, notes: [] }, maxWidth, focus) <= view.bodyRows ? 'full' : 'compact'
}

// Svg (데스크톱 앱·VS Code·모바일). 이미지로 그려져 앱 테마를 따르지 않으므로 상자 바탕을 직접 칠한다 (사용자 결정 2026-11-15)
const SVG_COLORS = [
  { stroke: '#2a9bb0', fill: '#e3f4f7', text: '#0f3d46' },
  { stroke: '#b58900', fill: '#fbf1d6', text: '#4a3800' },
  { stroke: '#b0469b', fill: '#f7e3f3', text: '#4a1440' },
  { stroke: '#3f9a4f', fill: '#e2f3e5', text: '#173d1e' },
] as const
/** 흐름 i 의 진한 색(Svg 테두리). 앱 바깥 글자(흐름 이름)도 이 색이면 밝은·어두운 테마 둘 다에서 읽힌다. */
export function flowStroke(i: number): string {
  return SVG_COLORS[i % SVG_COLORS.length]!.stroke
}
// 상자 밖(투명 바탕)이라 밝음·어두움 둘 다에서 보이는 중간 회색
const SVG_ARROW = '#8a8a8a'
const FONT_PX = 13
const LINE_PX = 18
const PAD_X = 10
const PAD_Y = 7
const ARROW_PX = 28
const MORE_PX = 22
const ROW_GAP = 10
// 단계 이름 상한(칸). 좁은 패널에서 아주 긴 이름은 줄마다 <text> 가 붙어 Svg 상한(131072자)을 넘는다
const SVG_LABEL_CELLS = 200

/**
 * 13px 글꼴에서 글자 폭 어림(px). 그리는 쪽 글꼴을 잴 수 없어 macOS Chrome 에서 잰 평균(한글 11.2, 소문자 6.2,
 * 대문자 7.6, W·M 10.7, 좁은 글자 3.2)보다 5% 남짓 넓게 잡는다. 글자는 이 폭에 맞춰 늘이거나 줄여 그린다.
 */
export function textPx(text: string): number {
  let w = 0
  for (const ch of text) {
    if (cells(ch) === 2) w += 11.8
    else if (ch === ' ') w += 3.5
    else if (ch === 'W' || ch === 'M') w += 11.2
    else if (ch === 'm' || ch === 'w') w += 10.4
    else if ('iljI.,:;\'|!'.includes(ch)) w += 3.4
    else if (ch >= 'A' && ch <= 'Z') w += 8
    else w += 6.5
  }
  return Math.ceil(w)
}

function xml(text: string): string {
  return text
    // XML 1.0 이 허용하지 않는 글자(탭·줄바꿈 외 제어문자, U+FFFE·U+FFFF, 짝 없는 서로게이트)는 문서 전체를 깨뜨린다
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function arrow(x1: number, x2: number, y: number): string {
  return `<path d="M${x1} ${y}H${x2}M${x2 - 6} ${y - 4}L${x2} ${y}L${x2 - 6} ${y + 4}" stroke="${SVG_ARROW}" stroke-width="1.5" fill="none"/>`
}

/**
 * 흐름 하나의 단계 상자를 Svg 문서로. 줄 나누기는 터미널과 같은 packRows(maxCells 칸 기준)를 쓴다.
 * 폭·높이는 마크업에 넣고 Svg prop 으로는 주지 않는다: 칸보다 넓으면 엔진이 줄여 그린다.
 */
export function flowSvg(steps: readonly string[], maxCells: number, colorIndex: number): { source: string; width: number; height: number } {
  const c = SVG_COLORS[colorIndex % SVG_COLORS.length]!
  const parts: string[] = []
  let y = 0
  let width = 0
  packRows(steps.map(s => clip(s.trim(), SVG_LABEL_CELLS)), maxCells).forEach((row, r) => {
    if (r > 0) y += ROW_GAP
    const boxes = row.boxes.map(lines => ({
      lines,
      w: Math.max(...lines.map(textPx)) + PAD_X * 2,
      h: lines.length * LINE_PX + PAD_Y * 2,
    }))
    const rowH = Math.max(...boxes.map(b => b.h))
    const mid = y + rowH / 2
    let x = 0
    boxes.forEach((b, k) => {
      if (k > 0) {
        parts.push(arrow(x + 4, x + ARROW_PX - 4, mid))
        x += ARROW_PX
      }
      const top = y + (rowH - b.h) / 2
      parts.push(`<rect x="${x + 0.75}" y="${top + 0.75}" width="${b.w - 1.5}" height="${b.h - 1.5}" rx="6" fill="${c.fill}" stroke="${c.stroke}" stroke-width="1.5"/>`)
      b.lines.forEach((l, m) => {
        const tw = textPx(l)
        // 가운데 정렬로 어림 오차를 양쪽에 나누고, 어림 폭에 맞춰 늘이거나 줄여 상자 밖으로 넘치지 않게 한다
        parts.push(`<text x="${x + b.w / 2}" y="${top + PAD_Y + m * LINE_PX + 13.5}" text-anchor="middle" textLength="${tw}" lengthAdjust="spacingAndGlyphs" fill="${c.text}">${xml(l)}</text>`)
      })
      x += b.w
    })
    if (row.more) {
      parts.push(arrow(x + 4, x + MORE_PX - 2, mid))
      x += MORE_PX
    }
    width = Math.max(width, x)
    y += rowH
  })
  const height = Math.ceil(y)
  width = Math.ceil(width)
  const font = `-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'Segoe UI', sans-serif`
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${font}" font-size="${FONT_PX}">` +
    parts.join('') +
    '</svg>'
  return { source, width, height }
}

/** 그리는 동안 막대: 평소 걸리는 시간(expected 초) 대비로 채우고, 넘으면 가득 찬 채로 둔다. */
export function progressBar(seconds: number, expected: number, width: number): string {
  const filled = Math.min(width, Math.round((seconds / expected) * width))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

/** max 칸 단위로 나눈다. 띄어쓰기에서 나누고, 한 낱말이 max 를 넘으면 글자에서 나눈다. */
function wrap(text: string, max: number): string[] {
  const out: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word
    if (cells(next) <= max) {
      line = next
      continue
    }
    if (line) out.push(line)
    line = ''
    for (const ch of word) {
      if (cells(line + ch) > max) {
        out.push(line)
        line = ''
      }
      line += ch
    }
  }
  if (line) out.push(line)
  return out
}
