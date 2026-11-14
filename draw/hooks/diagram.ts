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
