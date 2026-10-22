// 순수 함수만 둔다: $ 에 의존하지 않으므로 다른 도구로 옮기기 쉽다.

import type { Eli12Data } from '../types'

export const MAX_SOURCE_CHARS = 12_000
export const MAX_FLOWS = 2
export const MAX_STEPS = 6

// 모델은 한글 2칸 폭을 잘못 세어 상자를 어긋나게 그린다. 그림은 단계만 받아 diagram.ts 가 그린다
const FLOWS_RULE = `- flows 는 그림으로 그릴 흐름 ${MAX_FLOWS}개 이하, 각 steps 는 2~${MAX_STEPS}개의 짧은 단계 이름 (한글 10자 안팎). 상자나 화살표를 글자로 그리지 않는다.`

export function buildPrompt(source: string, focus: string): string {
  const trimmed = source.length > MAX_SOURCE_CHARS
    ? source.slice(0, MAX_SOURCE_CHARS) + '\n…(이하 생략)'
    : source
  const focusLine = focus.trim()
    ? `특히 "${focus.trim()}" 부분을 중심으로 설명해.`
    : '어려운 부분만 골라서 설명하고, 이미 쉬운 부분은 생략해.'

  return [
    '아래는 개발 도구가 방금 한 설명이야. 이걸 12살도 직관적으로 이해하게 다시 설명해줘.',
    focusLine,
    '',
    'JSON 하나만 답해. 다른 글이나 코드 블록 표시는 쓰지 마:',
    '{"summary": "한 줄 요약 (20자 안팎)", "analogy": "일상 비유 하나 (3~4문장)", "flows": [{"label": "흐름 이름", "steps": ["단계", "단계"]}], "remember": ["기억할 것 (한 줄)", "", ""]}',
    '',
    '규칙:',
    FLOWS_RULE,
    '- remember 는 3개.',
    '- 전문 용어는 처음 나올 때 괄호로 쉽게 풀어줘. 마크다운 기호는 쓰지 마.',
    '',
    '--- 원래 설명 ---',
    trimmed,
  ].join('\n')
}

/** 직전 답변 없이 주제만 있을 때: 주제 자체를 12살 버전으로 설명. */
export function buildTopicPrompt(topic: string): string {
  return [
    `"${topic.trim()}" 를 12살도 직관적으로 이해하게 설명해줘.`,
    '읽는 사람은 현업 개발자라 나중에 정확한 용어로 돌아올 수 있어야 해.',
    '',
    'JSON 하나만 답해. 다른 글이나 코드 블록 표시는 쓰지 마:',
    '{"summary": "한 줄 요약 (20자 안팎)", "analogy": "일상 비유 하나 (3~4문장)", "flows": [{"label": "흐름 이름", "steps": ["단계", "단계"]}], "mismatch": "비유가 맞지 않는 부분 (한 줄)", "real": "실제 용어로 다시 (2~3문장)"}',
    '',
    '규칙:',
    FLOWS_RULE,
    '- 마크다운 기호는 쓰지 마.',
  ].join('\n')
}

/** 모델 답에서 JSON 을 꺼낸다. 형식이 틀리거나 요약이 없으면 null. */
export function parseEli12(raw: string): Eli12Data | null {
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
  const str = (x: unknown) => (typeof x === 'string' ? stripMarkdown(x).trim() : '')
  const summary = str(o.summary)
  if (!summary) return null
  const flows = (Array.isArray(o.flows) ? o.flows : [])
    .map(f => {
      const r = (f ?? {}) as Record<string, unknown>
      const steps = Array.isArray(r.steps) ? r.steps.map(str).filter(Boolean).slice(0, MAX_STEPS) : []
      return { label: str(r.label), steps }
    })
    .filter(f => f.steps.length > 0)
    .slice(0, MAX_FLOWS)
  const remember = Array.isArray(o.remember) ? o.remember.map(str).filter(Boolean).slice(0, 3) : []
  return { summary, analogy: str(o.analogy), flows, remember, mismatch: str(o.mismatch), real: str(o.real) }
}

/** 마지막 assistant 메시지 중 글이 있는 것. 없으면 undefined. */
export function lastAnswer(messages: ReadonlyArray<{ role: string; text: string }>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.role === 'assistant' && m.text.trim()) return m.text
  }
  return undefined
}

/** 모델이 섞어 쓰는 마크다운 기호를 터미널 표시용으로 걷어낸다. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^```[^\n]*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
}
