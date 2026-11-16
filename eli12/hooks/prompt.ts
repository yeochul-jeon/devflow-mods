// 순수 함수만 둔다: $ 에 의존하지 않으므로 다른 도구로 옮기기 쉽다.

import type { Eli12Data, SeqData, SeqMessage } from '../types'

export const MAX_SOURCE_CHARS = 12_000
export const MAX_FLOWS = 2
export const MAX_STEPS = 6
// 시퀀스 상한은 draw /draw-seq 와 같다
export const MAX_PARTICIPANTS = 4
export const MAX_MESSAGES = 10

// 모델은 한글 2칸 폭을 잘못 세어 상자를 어긋나게 그린다. 그림은 단계만 받아 diagram.ts 가 그린다
const FLOWS_RULE = `- flows 는 그림으로 그릴 흐름 ${MAX_FLOWS}개 이하, 각 steps 는 2~${MAX_STEPS}개의 짧은 단계 이름 (한글 10자 안팎). 상자나 화살표를 글자로 그리지 않는다.`

// 주고받음 설명은 흐름 대신 시퀀스로 (0.4.0). 판정 문장과 예는 2026-11-16 Haiku 측정에서 고른 것:
// 판정 문장 전에는 주고받음이 뚜렷한 표본에서 시퀀스를 4/6 골랐고, 넣은 뒤 6/9. effort high 는 7/9 였지만 JSON 깨짐 1회에 더 느려 쓰지 않는다
const SEQUENCE_CHOICE = [
  '- 그림은 flows 와 sequence 중 하나만 쓴다. 먼저 원래 설명에서 "A 가 B 에게 보낸다", "B 가 A 에게 돌려준다", "다시 보낸다" 같은 주고받음을 찾는다.',
  '- 서로 다른 참여자(사람, 장비, 서버, 프로그램) 사이의 주고받음이 2번 이상 나오면 반드시 sequence 를 쓰고 flows 는 빈 배열로 둔다. 장애, 재시도, 응답 지연을 설명하는 글도 주고받음이 나오면 sequence 다.',
  '- 주고받음이 없거나 1번뿐이면(혼자 하는 작업 순서, 목록, 보고, 구성 설명) sequence 를 빼고 flows 를 쓴다.',
  '- 예: "앱이 서버에 로그인 요청을 보내고, 서버가 토큰을 돌려준다" → sequence {"participants": ["앱", "서버"], "messages": [{"from": "앱", "to": "서버", "label": "로그인 요청", "reply": false}, {"from": "서버", "to": "앱", "label": "토큰 돌려줌", "reply": true}]}',
]
const SEQUENCE_SHAPE = [
  `- sequence 의 participants 는 ${MAX_PARTICIPANTS}개 이하, 쉬운 말로 짧게 (한글 8자 안팎). messages 는 일어난 순서대로 ${MAX_MESSAGES}개 이하.`,
  '- messages 의 from 과 to 는 participants 에 적은 이름을 한 글자도 바꾸지 않고 그대로 쓴다. 자기 자신에게 하는 일은 from 과 to 를 같게 쓴다.',
  '- 앞 메시지를 받은 쪽이 결과를 돌려주는 메시지면 reply 를 true 로 둔다. label 은 쉬운 말로 짧게 (한글 12자 안팎).',
]

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
    '{"summary": "한 줄 요약 (20자 안팎)", "analogy": "일상 비유 하나 (3~4문장)", "flows": [{"label": "흐름 이름", "steps": ["단계", "단계"]}], "sequence": {"participants": ["참여자", "참여자"], "messages": [{"from": "참여자", "to": "참여자", "label": "주고받는 것", "reply": false}]}, "remember": ["기억할 것 (한 줄)", "", ""]}',
    '',
    '규칙:',
    ...SEQUENCE_CHOICE,
    FLOWS_RULE,
    ...SEQUENCE_SHAPE,
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
  // 시퀀스가 쓸 만하면 흐름 대신 그린다. 모델이 둘 다 주기도 했다 (2026-11-16 측정 20회 중 2회)
  const sequence = parseSequence(o.sequence)
  return { summary, analogy: str(o.analogy), flows: sequence ? [] : flows, sequence, remember, mismatch: str(o.mismatch), real: str(o.real) }
}

/**
 * sequence 값을 읽는다 (draw parseSeq 와 같은 규칙). 참여자가 2명 미만이거나 남은 메시지가 없으면 null: 그때는 흐름을 그린다.
 * 모르는 이름이 든 메시지는 빼고 개수를, 상한을 넘으면 더 있음을 notes 에 남긴다.
 */
export function parseSequence(v: unknown): SeqData | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.participants) || !Array.isArray(o.messages)) return null
  // 줄바꿈과 탭은 빈칸 하나로: 그대로 두면 터미널 그림 한 줄이 두 줄로 갈라져 세로줄이 어긋난다
  const str = (x: unknown) => (typeof x === 'string' ? stripMarkdown(x).replace(/\s+/g, ' ').trim() : '')
  const participants = [...new Set(o.participants.map(str).filter(Boolean))].slice(0, MAX_PARTICIPANTS)
  const known = new Set(participants)
  let unknown = 0
  const messages: SeqMessage[] = []
  for (const m of o.messages) {
    const r = (m ?? {}) as Record<string, unknown>
    const msg = { from: str(r.from), to: str(r.to), label: str(r.label), reply: r.reply === true || r.reply === 'true' }
    if (!msg.label) continue
    if (!known.has(msg.from) || !known.has(msg.to)) {
      unknown++
      continue
    }
    messages.push(msg)
  }
  if (participants.length < 2 || messages.length === 0) return null
  const notes: string[] = []
  if (unknown) notes.push(`참여자 목록에 없는 이름이 든 메시지 ${unknown}개는 뺐어요`)
  if (messages.length > MAX_MESSAGES) notes.push(`메시지 ${messages.length - MAX_MESSAGES}개 더 있음 (${MAX_MESSAGES}개까지 그림)`)
  return { title: '', participants, messages: messages.slice(0, MAX_MESSAGES), notes }
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
