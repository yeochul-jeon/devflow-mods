// team-board/hooks/diagram.ts 에서 복사 (plugin 끼리 의존하지 않는다). 다른 점: 단계 상한 4 → 6, 넘치면 칩 줄바꿈 대신 세로 한 줄씩(긴 이름은 자르지 않고 이어 씀).
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

/**
 * 단계를 잇는 그림. 이름을 자르지 않고 한 줄에 다 들어가면 3줄 상자로, 아니면 한 단계에 한 줄씩 세로로 그린다
 * (team-board 의 칩 줄바꿈은 식별자를 18칸에서 잘라 원문 이름이 사라지므로 쓰지 않는다):
 *   ┌──────┐   ┌──────┐           ┌─ 단계
 *   │ 단계 │ → │ 단계 │    또는    ├→ 단계
 *   └──────┘   └──────┘           └→ 단계
 */
export function flowArt(steps: readonly string[], maxWidth: number): string[] {
  const labels = steps.map(s => s.trim()).filter(Boolean).slice(0, MAX_STEPS)
  if (labels.length === 0) return []
  const widths = labels.map(l => cells(l))

  const across = widths.reduce((a, w) => a + w + 4, 0) + (labels.length - 1) * 3
  if (across <= maxWidth && widths.every(w => w <= 18)) {
    const top = labels.map((_, i) => '┌' + '─'.repeat(widths[i]! + 2) + '┐').join('   ')
    const mid = labels.map((l, i) => '│ ' + pad(l, widths[i]!) + ' │').join(' → ')
    const bot = labels.map((_, i) => '└' + '─'.repeat(widths[i]! + 2) + '┘').join('   ')
    return [top, mid, bot]
  }

  // 긴 이름은 자르지 않고 다음 줄로 이어 쓴다 (원문 이름을 지키려고)
  const last = labels.length - 1
  return labels.flatMap((l, i) => {
    const [first, ...rest] = wrap(l, Math.max(4, maxWidth - 3))
    return [(i === 0 ? '┌─ ' : i === last ? '└→ ' : '├→ ') + first, ...rest.map(r => (i === last ? '   ' : '│  ') + r)]
  })
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
