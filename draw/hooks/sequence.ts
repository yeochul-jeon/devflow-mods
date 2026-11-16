// /draw-seq 그림: 시퀀스 JSON 을 터미널 줄과 Svg 로 그린다. 모양은 사용자가 목업에서 골랐다 (T70 S4, 2026-11-15):
// 옆 패널은 생명선형, 좁으면 번호 목록형, 프롬프트 위 패널에서 넘치면 압축형, 데스크톱 앱은 Svg 생명선.
// 터미널 그림은 폭이 확실한 ASCII(| - . > < + ~)만 쓴다. … 같은 폭이 애매한 글자는 세로줄을 어긋나게 한다.

import type { SeqData } from '../types'
import { cells, clip, textPx, wrap, xml } from './diagram'

export type SeqLine = { text: string; kind?: 'head' | 'reply' | 'self' | 'dim' }

/** 이 폭보다 좁으면 생명선 대신 번호 목록. 목업에서 51칸은 생명선, 34칸은 이름이 여러 줄로 쪼개졌다. */
export const NARROW_CELLS = 40

const LET = ['A', 'B', 'C', 'D']

/** 터미널용 자르기: max 칸을 넘으면 끝을 ~ 로. */
function cut(text: string, max: number): string {
  if (max <= 0) return ''
  if (cells(text) <= max) return text
  let out = ''
  for (const ch of text) {
    if (cells(out + ch) > max - 1) break
    out += ch
  }
  return out + '~'
}

/** 칸 배열 한 줄. 넓은 글자는 다음 칸을 '' 로 채운다. 폭 밖에 놓이는 글자는 버린다. */
class Row {
  c: string[]
  constructor(w: number) {
    this.c = Array(Math.max(0, w)).fill(' ')
  }
  put(x: number, s: string) {
    for (const ch of s) {
      const w = cells(ch)
      // 0칸 글자(결합 문자 등)는 칸을 차지하지 않으므로 바로 앞 글자에 붙인다
      if (w === 0) {
        let p = x - 1
        while (p > 0 && this.c[p] === '') p--
        if (p >= 0 && p < this.c.length) this.c[p] += ch
        continue
      }
      if (x < 0 || x + w > this.c.length) {
        x += w
        continue
      }
      // 넓은 글자 반쪽을 덮으면 남은 반쪽을 공백으로
      if (this.c[x] === '' && x > 0) this.c[x - 1] = ' '
      this.c[x] = ch
      if (w === 2) this.c[x + 1] = ''
      if (this.c[x + w] === '') this.c[x + w] = ' '
      x += w
    }
  }
  text() {
    return this.c.join('').replace(/\s+$/, '')
  }
}

function index(d: SeqData, name: string): number {
  return Math.max(0, d.participants.indexOf(name))
}

/** 범례 "A 이름   B 이름": 폭을 넘으면 다음 줄로. */
function legend(d: SeqData, W: number): SeqLine[] {
  const lines: SeqLine[] = []
  let cur = ''
  for (const p of d.participants.map((p, i) => `${LET[i]} ${p}`)) {
    const next = cur ? `${cur}   ${p}` : p
    if (cells(next) <= W) cur = next
    else {
      if (cur) lines.push({ text: cur, kind: 'dim' })
      cur = cut(p, W)
    }
  }
  if (cur) lines.push({ text: cur, kind: 'dim' })
  return lines
}

/** 생명선형: 참여자마다 세로줄, 화살표 위에 번호와 이름, 응답은 점선, 자기 자신에게 하는 일은 고리. */
export function lifelineLines(d: SeqData, W: number): SeqLine[] {
  const n = d.participants.length
  if (n === 0) return []
  const x0 = 2
  const x1 = Math.max(x0, W - 3)
  const xs = d.participants.map((_, i) => (n === 1 ? x0 : Math.round(x0 + (i * (x1 - x0)) / (n - 1))))
  const lines: SeqLine[] = []

  // 머리: 이름마다 옆 세로줄과의 가운데까지만 쓴다 (이름 사이에 빈칸이 하나 이상 남는다)
  const head = new Row(W)
  d.participants.forEach((p, i) => {
    const lo = i === 0 ? 0 : Math.floor((xs[i - 1]! + xs[i]!) / 2) + 1
    const hi = i === n - 1 ? W - 1 : Math.floor((xs[i]! + xs[i + 1]!) / 2) - 1
    const name = cut(p, hi - lo + 1)
    if (!name) return
    const w = cells(name)
    head.put(Math.min(Math.max(lo, xs[i]! - Math.floor(w / 2)), hi - w + 1), name)
  })
  lines.push({ text: head.text(), kind: 'head' })
  const bars = () => {
    const r = new Row(W)
    xs.forEach(x => r.put(x, '|'))
    return r
  }
  lines.push({ text: bars().text() })

  d.messages.forEach((m, k) => {
    const a = index(d, m.from)
    const b = index(d, m.to)
    const label = `${k + 1} ${m.label}`
    if (a === b) {
      const x = xs[a]!
      // 오른쪽 세로줄 앞까지 8칸 이상 남거나 왼쪽보다 넓으면 오른쪽, 아니면 왼쪽으로 고리를 낸다
      // (첫 참여자는 왼쪽 칸이 없다: 참여자 4명, 40칸에서 이름이 화면 밖으로 나갔다)
      const right = (a + 1 < n ? xs[a + 1]! - 1 : W) - (x + 5)
      const left = x - 4 - (a > 0 ? xs[a - 1]! + 2 : 0)
      const toRight = right >= 8 || right >= left
      wrap(label, Math.max(2, toRight ? right : left)).forEach((t, j) => {
        const r = bars()
        if (toRight) {
          r.put(x + 1, j === 0 ? '--+ ' : '  | ')
          r.put(x + 5, t)
        } else {
          r.put(x - 4, j === 0 ? ' +--' : ' |  ')
          r.put(x - 4 - cells(t), t)
        }
        lines.push({ text: r.text(), kind: 'self' })
      })
      const r = bars()
      if (toRight) r.put(x + 1, '<-+')
      else r.put(x - 3, '+->')
      lines.push({ text: r.text(), kind: 'self' })
      return
    }
    const lo = Math.min(xs[a]!, xs[b]!)
    const hi = Math.max(xs[a]!, xs[b]!)
    const kind = m.reply ? 'reply' : undefined
    for (const t of wrap(label, Math.max(2, hi - lo - 3))) {
      const r = bars()
      r.put(lo + 2, t)
      lines.push({ text: r.text(), kind })
    }
    const r = bars()
    r.put(lo + 1, (m.reply ? '.' : '-').repeat(Math.max(0, hi - lo - 1)))
    if (xs[b]! > xs[a]!) r.put(hi - 1, '>')
    else r.put(lo + 1, '<')
    lines.push({ text: r.text(), kind })
  })
  // 세로줄이 겹칠 만큼 좁으면 이름이 폭을 넘는다. 넘는 줄은 자른다 (이 폭이면 목록형이 쓰인다)
  return lines.map(l => ({ ...l, text: cut(l.text, W) }))
}

/** 번호 목록형: 범례 뒤에 한 메시지 한 줄 " 1 A > B  이름", 넘치면 이름 칸에 맞춰 들여 써서 잇는다. */
export function listLines(d: SeqData, W: number): SeqLine[] {
  const lines = legend(d, W)
  d.messages.forEach((m, k) => {
    const a = LET[index(d, m.from)]!
    const b = LET[index(d, m.to)]!
    const pre = `${String(k + 1).padStart(2)} ${a === b ? `${a}    ` : `${a} > ${b}`}  `
    const kind = m.reply ? 'reply' : a === b ? 'self' : undefined
    wrap(m.label, Math.max(2, W - cells(pre))).forEach((t, j) => {
      // 머리(10칸)보다 좁은 패널에서는 줄 끝을 자른다
      lines.push({ text: cut((j === 0 ? pre : ' '.repeat(cells(pre))) + t, W), kind })
    })
  })
  return lines
}

/**
 * 압축형 (프롬프트 위 패널처럼 줄이 적을 때): 범례 한 줄, 메시지 "1 A>B 이름" 을 이어 붙인 줄들.
 * rows 줄을 넘으면 마지막 줄에 남은 메시지 수와 메모 수. shown 은 보인 메시지 수.
 */
export function compactSeq(d: SeqData, W: number, rows: number): { lines: SeqLine[]; shown: number } {
  const lg = legend(d, W)
  const head: SeqLine = { text: cut(lg.map(l => l.text).join('   '), W), kind: 'dim' }
  const body: { text: string; count: number }[] = []
  let cur = { text: '', count: 0 }
  d.messages.forEach((m, k) => {
    const a = LET[index(d, m.from)]!
    const b = LET[index(d, m.to)]!
    const part = cut(`${k + 1} ${a === b ? a : `${a}>${b}`} ${m.label}`, W)
    const next = cur.text ? `${cur.text}  ${part}` : part
    if (cells(next) <= W) cur = { text: next, count: cur.count + 1 }
    else {
      if (cur.text) body.push(cur)
      cur = { text: part, count: 1 }
    }
  })
  if (cur.text) body.push(cur)
  const notes = d.notes.length ? `· 메모 ${d.notes.length}개는 패널을 키우면 보여요` : ''
  // 3줄보다 적으면 범례를 빼고 본문과 남은 수에 줄을 쓴다
  const top = rows >= 3 ? [head] : []
  const room = Math.max(1, rows) - top.length
  if (body.length + (notes ? 1 : 0) <= room) {
    return {
      lines: [...top, ...body.map(l => ({ text: l.text })), ...(notes ? [{ text: cut(notes, W), kind: 'dim' as const }] : [])],
      shown: d.messages.length,
    }
  }
  const kept = body.slice(0, room - 1)
  const shown = kept.reduce((s, l) => s + l.count, 0)
  const short = `... 메시지 ${d.messages.length - shown}개 더`
  const long = `${short}${d.notes.length ? `, 메모 ${d.notes.length}개` : ''} (패널을 키우면 보여요)`
  // 좁으면 짧은 꼴로: 개수가 잘려 나가지 않게
  const more = cells(long) <= W ? long : cut(short, W)
  return { lines: [...top, ...kept.map(l => ({ text: l.text })), { text: more, kind: 'dim' }], shown }
}

/**
 * 터미널 그림 모양. 옆 패널은 폭만 본다 (줄이 넉넉하고 스크롤된다).
 * 프롬프트 위 패널(inline)과 데스크톱 위젯(widget)에서 제목, 초점, 그림이 보이는 줄 수를 넘으면 압축형. 메모는 세지 않는다.
 */
export function chooseSeqLayout(
  d: SeqData,
  W: number,
  view: { placement?: string; bodyRows?: number },
  focus: string,
): 'lifeline' | 'list' | 'compact' {
  const base = W < NARROW_CELLS ? 'list' : 'lifeline'
  if (view.placement !== 'inline' && view.placement !== 'widget') return base
  if (!view.bodyRows) return base
  const rows = (text: string) => Math.ceil(cells(text) / W)
  // 1 은 그림 위 빈 줄 (register.tsx 의 marginTop)
  const full =
    (d.title ? rows(d.title) : 0) +
    (focus ? rows(`초점: ${focus}`) : 0) +
    1 +
    (base === 'list' ? listLines(d, W) : lifelineLines(d, W)).length
  return full <= view.bodyRows ? base : 'compact'
}

// Svg (데스크톱 앱, VS Code, 모바일). 앱 테마를 따르지 않는 이미지라 글자마다 옅은 바탕을 깔아 밝은 테마와 어두운 테마 둘 다에서 읽히게 한다.
const PX_PER_CELL = 6.5
const MARGIN = 64
const HEAD_H = 26
const LINE_PX = 16
const CHIP_PAD_X = 6
const CHIP_PAD_Y = 3
const GRAY = '#8a8a8a'
const PART = { fill: '#e9eefc', stroke: '#5b79d6', text: '#1c2230' }
const CHIP = { fill: '#eef0f4', text: '#2b3142' }
const REPLY_CHIP = { fill: '#f4f4f4', text: '#5d6573' }
const SELF_CHIP = { fill: '#fbf1d6', text: '#4a3800' }
// 메시지 이름 상한(칸). 좁은 패널에서 아주 긴 이름은 줄마다 <text> 가 붙어 Svg 상한(131072자)을 넘는다
const SEQ_LABEL_CELLS = 120
// 글자 수 상한도 둔다: 결합 문자는 0칸이라 칸 상한만으로는 길이가 막히지 않는다
const SEQ_LABEL_CHARS = 2 * SEQ_LABEL_CELLS

function chars(text: string): string {
  return [...text].slice(0, SEQ_LABEL_CHARS).join('')
}

/** maxPx 안에 드는 앞부분, 넘치면 … */
function clipPx(text: string, maxPx: number): string {
  if (textPx(text) <= maxPx) return text
  let out = ''
  for (const ch of text) {
    if (textPx(out + ch + '…') > maxPx) break
    out += ch
  }
  return out + '…'
}

function chip(x: number, y: number, lines: string[], c: { fill: string; text: string }): string {
  const w = Math.max(...lines.map(textPx)) + CHIP_PAD_X * 2
  const h = lines.length * LINE_PX + CHIP_PAD_Y * 2
  const texts = lines
    .map((l, i) => `<text x="${x + CHIP_PAD_X}" y="${y + CHIP_PAD_Y + i * LINE_PX + 12}" textLength="${textPx(l)}" lengthAdjust="spacingAndGlyphs" fill="${c.text}">${xml(l)}</text>`)
    .join('')
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${c.fill}"/>${texts}`
}

function chipWidth(lines: string[]): number {
  return Math.max(...lines.map(textPx)) + CHIP_PAD_X * 2
}

function head(x: number, y: number, toRight: boolean): string {
  const d = toRight ? -6 : 6
  return `<path d="M${x + d} ${y - 4}L${x} ${y}L${x + d} ${y + 4}" stroke="${GRAY}" stroke-width="1.5" fill="none"/>`
}

/** 시퀀스 전체를 Svg 문서 하나로. 폭은 패널 칸 수에서 어림하고, 폭과 높이는 마크업과 prop 둘 다에 넣는다. */
export function seqSvg(d: SeqData, maxCells: number): { source: string; width: number; height: number } {
  const n = Math.max(1, d.participants.length)
  const W = Math.max(260, Math.ceil(maxCells * PX_PER_CELL))
  const xs = d.participants.map((_, i) => (n === 1 ? W / 2 : MARGIN + (i * (W - 2 * MARGIN)) / (n - 1)))
  const gap = n > 1 ? (W - 2 * MARGIN) / (n - 1) : W
  const boxMax = Math.min(gap - 8, MARGIN * 2 - 4)
  const parts: string[] = []
  // 이름표는 칸으로 접지만 대문자, M, W 는 칸 어림(6.5px)보다 넓게 그려진다. 그린 범위를 재어 그림 폭을 넓힌다
  let minX = 0
  let maxX = W
  const span = (x: number, w: number) => {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x + w)
  }

  d.participants.forEach((p, i) => {
    const name = clipPx(chars(p), boxMax - 12)
    const w = textPx(name) + 12
    span(xs[i]! - w / 2, w)
    parts.push(`<rect x="${xs[i]! - w / 2}" y="1" width="${w}" height="${HEAD_H}" rx="6" fill="${PART.fill}" stroke="${PART.stroke}" stroke-width="1.5"/>`)
    parts.push(`<text x="${xs[i]}" y="${HEAD_H / 2 + 5.5}" text-anchor="middle" textLength="${textPx(name)}" lengthAdjust="spacingAndGlyphs" fill="${PART.text}">${xml(name)}</text>`)
  })

  let y = HEAD_H + 12
  const roomCells = (px: number) => Math.max(8, Math.floor(px / PX_PER_CELL))
  d.messages.forEach((m, k) => {
    const a = index(d, m.from)
    const b = index(d, m.to)
    const label = clip(chars(`${k + 1} ${m.label}`), SEQ_LABEL_CELLS)
    const x = xs[a]!
    if (a === b) {
      const toRight = a < n - 1 || n === 1
      // 이름표는 옆 생명선을 덮어도 바탕이 있어 읽힌다. 간격만으로는 4명일 때 한 줄에 몇 글자밖에 안 들어갔다 (T70 s03)
      const room = Math.min(toRight ? W - x - 34 : x - 34, gap * 1.6)
      const lines = wrap(label, roomCells(room))
      const h = lines.length * LINE_PX + CHIP_PAD_Y * 2
      const cx = toRight ? x + 30 : x - 30 - chipWidth(lines)
      span(cx, chipWidth(lines))
      parts.push(chip(cx, y, lines, SELF_CHIP))
      const top = y + 4
      const bottom = y + h + 6
      const out = toRight ? x + 22 : x - 22
      const back = toRight ? x + 2 : x - 2
      parts.push(`<path d="M${x} ${top}H${out}V${bottom}H${back}" stroke="${GRAY}" stroke-width="1.5" fill="none"/>`)
      parts.push(head(back, bottom, !toRight))
      y = bottom + 14
      return
    }
    const xb = xs[b]!
    // 이름표는 생명선 위에 겹쳐도 바탕이 있어 읽힌다. 화살표 양 끝보다 조금 넓게 둔다
    const lines = wrap(label, roomCells(Math.min(Math.abs(xb - x) + 16, W - 8)))
    const h = lines.length * LINE_PX + CHIP_PAD_Y * 2
    span((x + xb) / 2 - chipWidth(lines) / 2, chipWidth(lines))
    parts.push(chip((x + xb) / 2 - chipWidth(lines) / 2, y, lines, m.reply ? REPLY_CHIP : CHIP))
    const ay = y + h + 7
    const toRight = xb > x
    const end = toRight ? xb - 2 : xb + 2
    parts.push(`<path d="M${x} ${ay}H${end}" stroke="${GRAY}" stroke-width="1.5"${m.reply ? ' stroke-dasharray="5 4"' : ''} fill="none"/>`)
    parts.push(head(end, ay, toRight))
    y = ay + 14
  })

  const height = Math.ceil(y)
  // 생명선은 맨 뒤가 아니라 맨 앞에 그려 이름표와 화살표 아래에 깔리게 한다
  const lifelines = xs.map(x => `<line x1="${x}" y1="${HEAD_H + 1}" x2="${x}" y2="${height}" stroke="${GRAY}" stroke-width="1" stroke-dasharray="3 4"/>`)
  const font = `-apple-system, 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'Segoe UI', sans-serif`
  const left = minX < 0 ? Math.floor(minX - 2) : 0
  const width = Math.ceil((maxX > W ? maxX + 2 : W) - left)
  const body = lifelines.join('') + parts.join('')
  const source =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="${font}" font-size="12">` +
    (left < 0 ? `<g transform="translate(${-left} 0)">${body}</g>` : body) +
    '</svg>'
  return { source, width, height }
}

/** Svg 의 alt: 제목과 메시지마다 "번호 보낸 쪽 → 받는 쪽: 이름". */
export function seqAlt(d: SeqData): string {
  const msgs = d.messages.map((m, k) => `${k + 1} ${m.from} → ${m.to}: ${m.label}`).join(', ')
  return d.title ? `${d.title}: ${msgs}` : msgs
}
