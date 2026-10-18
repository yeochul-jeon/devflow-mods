// 순수 함수만 둔다: $ 에 의존하지 않으므로 측정 스크립트에서도 그대로 쓴다.

import type { DrawData } from '../types'

export const MAX_SOURCE_CHARS = 12_000
export const MAX_FLOWS = 4
export const MAX_STEPS = 6

export function buildPrompt(source: string, focus: string): string {
  const trimmed = source.length > MAX_SOURCE_CHARS
    ? source.slice(0, MAX_SOURCE_CHARS) + '\n…(이하 생략)'
    : source
  const focusLine = focus.trim()
    ? `"${focus.trim()}" 에 관한 흐름만 고른다.`
    : '설명의 중심이 되는 흐름부터 고른다.'

  return [
    '아래 설명에 들어 있는 흐름(순서·단계·데이터 경로)을 그림용 JSON 으로 옮긴다.',
    '설명을 쉽게 바꾸거나 요약해서 새 말로 쓰지 않는다. 상자 이름은 원문의 낱말·식별자를 그대로 쓴다.',
    focusLine,
    '',
    'JSON 하나만 답한다. 다른 글이나 코드 블록 표시는 쓰지 않는다:',
    `{"title": "그림 제목 (원문 낱말)", "flows": [{"label": "흐름 이름", "steps": ["단계", "단계"]}], "notes": ["그림에 담지 못한 갈래·조건 한 줄"]}`,
    '',
    '규칙:',
    `- flows 는 ${MAX_FLOWS}개 이하, 각 steps 는 2~${MAX_STEPS}개. 원문의 순서를 지키고 단계를 빼지 않는다.`,
    '- 단계 이름과 흐름 이름은 원문 낱말을 그대로 쓴다. 어미만 바꿀 수 있다. 한자어로 줄여 새 낱말을 만들지 않는다 (예: "설정하지 않으면" → "미설정" 은 안 된다).',
    '- 원문 식별자·경로·명령은 철자를 바꾸지 않는다.',
    '- 갈래는 갈래마다 흐름 하나로 나누고, 갈래 사이 공통 단계는 각 흐름에 다시 쓴다. 원문에 없는 연결(두 갈래를 한 줄로 잇기 등)을 만들지 않는다.',
    '- 원문의 단계를 notes 로 옮기지 않는다. notes 에는 그림에 담지 못한 조건·되돌아감·순서 없는 묶음만 적는다.',
    '- 흐름이 없는 설명이면 flows 를 빈 배열로 둔다.',
    '',
    '--- 원래 설명 ---',
    trimmed,
  ].join('\n')
}

/** 모델 답에서 JSON 을 꺼낸다. 형식이 틀리면 null. */
export function parseDraw(raw: string): DrawData | null {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let v: unknown
  try {
    v = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.flows)) return null
  const str = (x: unknown) => (typeof x === 'string' ? x.trim() : '')
  const flows = o.flows
    .map(f => {
      const r = (f ?? {}) as Record<string, unknown>
      const steps = Array.isArray(r.steps) ? r.steps.map(str).filter(Boolean).slice(0, MAX_STEPS) : []
      return { label: str(r.label), steps }
    })
    .filter(f => f.steps.length > 0)
    .slice(0, MAX_FLOWS)
  const notes = Array.isArray(o.notes) ? o.notes.map(str).filter(Boolean).slice(0, 4) : []
  return { title: str(o.title), flows, notes }
}

/** 마지막 assistant 메시지 중 글이 있는 것. 없으면 undefined. */
export function lastAnswer(messages: ReadonlyArray<{ role: string; text: string }>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.role === 'assistant' && m.text.trim()) return m.text
  }
  return undefined
}
