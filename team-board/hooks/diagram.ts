// 12살 설명을 ASCII 그림으로 그린다. 모델에게는 내용(JSON)만 받고,
// 그림은 여기서 한글 폭(2칸)을 계산해 직접 그려서 상자가 어긋나지 않게 한다.

import type { ExplainData, ExplainItem } from '../types'

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
 * 단계를 → 로 잇는 그림. 한 줄에 다 들어가면 3줄 상자로, 아니면 짧은 칩을 화살표에서 줄바꿈한다:
 *   ┌──────┐   ┌──────┐           [ 단계 ] → [ 단계 ]
 *   │ 단계 │ → │ 단계 │    또는    → [ 단계 ]
 *   └──────┘   └──────┘
 */
export function flowArt(steps: readonly string[], maxWidth: number): string[] {
  const labels = steps.filter(s => s.trim()).slice(0, 4).map(s => clip(s.trim(), Math.max(4, Math.min(18, maxWidth - 6))))
  if (labels.length === 0) return []
  const widths = labels.map(l => cells(l))

  const across = widths.reduce((a, w) => a + w + 4, 0) + (labels.length - 1) * 3
  if (across <= maxWidth) {
    const top = labels.map((_, i) => '┌' + '─'.repeat(widths[i]! + 2) + '┐').join('   ')
    const mid = labels.map((l, i) => '│ ' + pad(l, widths[i]!) + ' │').join(' → ')
    const bot = labels.map((_, i) => '└' + '─'.repeat(widths[i]! + 2) + '┘').join('   ')
    return [top, mid, bot]
  }

  const chips = labels.map(l => `[ ${l} ]`)
  const out: string[] = []
  let line = ''
  for (const chip of chips) {
    const piece = line ? ` → ${chip}` : chip
    if (line && cells(line + piece) > maxWidth) {
      out.push(line)
      line = `→ ${chip}`
    } else {
      line += piece
    }
  }
  if (line) out.push(line)
  return out.map(l => clip(l, maxWidth))
}

/** 모델 답에서 JSON 을 꺼낸다. 형식이 틀리면 null (그때는 글로 보여준다). */
export function parseExplain(raw: string): ExplainData | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let obj: unknown
  try {
    obj = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  const o = obj as { items?: unknown; first?: unknown }
  if (!Array.isArray(o.items)) return null
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const items: ExplainItem[] = o.items.slice(0, 6).flatMap(it => {
    if (!it || typeof it !== 'object') return []
    const r = it as Record<string, unknown>
    const options = Array.isArray(r.options)
      ? r.options.slice(0, 4).flatMap(op => {
          if (!op || typeof op !== 'object') return []
          const p = op as Record<string, unknown>
          const flow = Array.isArray(p.flow) ? p.flow.map(str).filter(Boolean) : []
          return str(p.label) ? [{ label: str(p.label), flow, result: str(p.result) }] : []
        })
      : []
    return str(r.title) ? [{ title: str(r.title), analogy: str(r.analogy), options, link: str(r.link), suggest: str(r.suggest) }] : []
  })
  return items.length ? { items, first: str(o.first) } : null
}

export const EXPLAIN_JSON_SPEC = [
  '반드시 아래 모양의 JSON 하나만 출력해. 앞뒤에 설명 문장, 코드블록 표시, 주석을 붙이지 마.',
  '{"items":[{"title":"","analogy":"","options":[{"label":"","flow":["",""],"result":""}],"link":"","suggest":""}],"first":""}',
  '규칙:',
  '- items: 결정 항목마다 하나 (최대 6개).',
  '- title: 무엇을 정하는지 한 줄, 25자 이내.',
  '- analogy: 12살이 겪는 일상 비유 한두 문장.',
  '- options: 선택지마다 하나 (2~4개). label 은 10자 이내.',
  '- flow: 그 선택지를 고르면 일어나는 일을 2~3단계로. 단계마다 12자 이내의 짧은 명사구 (그림의 상자 안에 들어감).',
  '- result: 그 선택의 결과 한 줄 (좋은 점이나 주의할 점).',
  '- link: 앞선 결정이나 진행 상황과 이어지는 점 한 줄. 없으면 "".',
  '- suggest: 세션이 제안한 것과 이유 한 줄. 없으면 "".',
  '- first: 먼저 정할 것 한 줄.',
].join('\n')
