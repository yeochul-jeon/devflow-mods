// 순수 함수만 둔다: $ 에 의존하지 않으므로 측정 스크립트에서도 그대로 쓴다.

import type { DrawData, SeqData, SeqMessage } from '../types'

export const MAX_SOURCE_CHARS = 12_000
export const MAX_FLOWS = 4
export const MAX_STEPS = 6
export const MAX_PARTICIPANTS = 4
export const MAX_MESSAGES = 10

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

/**
 * /draw-seq: 주고받음(누가 누구에게 무엇을)을 시퀀스 다이어그램 JSON 으로. T70 측정(2026-11-15~16)의 seq2 프롬프트 그대로.
 * 측정에서 바꾼 규칙 3개: 중심 참여자를 고른 뒤 처음 나오는 순서로, 처음 요청부터 빠짐없이, 재시도·조회는 notes 가 아니라 메시지.
 */
export function buildSeqPrompt(source: string, focus: string): string {
  const trimmed = source.length > MAX_SOURCE_CHARS
    ? source.slice(0, MAX_SOURCE_CHARS) + '\n…(이하 생략)'
    : source
  const focusLine = focus.trim()
    ? `"${focus.trim()}" 에 관한 주고받음만 고른다.`
    : '설명의 중심이 되는 주고받음부터 고른다.'

  return [
    '아래 설명에 들어 있는 주고받음(누가 누구에게 무엇을 보내고 무엇을 돌려받는지)을 시퀀스 다이어그램용 JSON 으로 옮긴다.',
    '설명을 쉽게 바꾸거나 요약해서 새 말로 쓰지 않는다. 참여자 이름과 메시지 이름은 원문의 낱말과 식별자를 그대로 쓴다.',
    focusLine,
    '',
    'JSON 하나만 답한다. 다른 글이나 코드 블록 표시는 쓰지 않는다:',
    `{"title": "그림 제목 (원문 낱말)", "participants": ["참여자", "참여자"], "messages": [{"from": "참여자", "to": "참여자", "label": "보내거나 돌려주는 것", "reply": false}], "notes": ["그림에 담지 못한 조건·갈래 한 줄"]}`,
    '',
    '규칙:',
    `- participants 는 메시지를 보내거나 받는 사람, 시스템, 프로그램, 함수다. ${MAX_PARTICIPANTS}개 이하. 중심 주고받음에 드는 참여자를 먼저 고르고, 고른 참여자를 원문에 처음 나오는 순서로 적는다.`,
    `- messages 는 처음 요청부터 빠짐없이 원문의 순서를 지키고 ${MAX_MESSAGES}개 이하. from 과 to 는 participants 에 적은 이름을 그대로 쓴다. 자기 자신에게 하는 일은 from 과 to 를 같게 쓴다.`,
    '- 앞 메시지를 받은 쪽이 응답이나 결과를 돌려주는 메시지면 reply 를 true 로 둔다. 원문이 응답을 말하지 않으면 응답 메시지를 만들지 않는다.',
    '- label 은 원문 낱말을 그대로 쓴다. 어미만 바꿀 수 있다. 한자어로 줄여 새 낱말을 만들지 않는다 (예: "설정하지 않으면" → "미설정" 은 안 된다).',
    '- 원문 식별자, 경로, 명령은 철자를 바꾸지 않는다.',
    '- 원문에 없는 참여자나 메시지를 지어내지 않는다.',
    '- 조건에 따라 일어나는 메시지는 label 뒤에 원문의 조건을 괄호로 붙인다 (예: "같은 요청 다시 보냄 (에러일 때)").',
    `- 참여자가 ${MAX_PARTICIPANTS}개를 넘으면 중심 주고받음에 드는 ${MAX_PARTICIPANTS}개만 고르고, 뺀 참여자는 notes 에 한 줄로 적는다.`,
    '- 같은 상대에게 다시 보내는 것(재시도, 조회)도 메시지다. notes 로 옮기지 않는다. 원문의 메시지를 notes 로 옮기지 않는다. notes 에는 그림에 담지 못한 조건, 되풀이 횟수, 갈래만 적는다.',
    '- 주고받음이 없는 설명(혼자 하는 작업 순서, 목록, 보고)이면 participants 와 messages 를 빈 배열로 둔다.',
    '',
    '--- 원래 설명 ---',
    trimmed,
  ].join('\n')
}

/**
 * 모델 답에서 시퀀스 JSON 을 꺼낸다. 형식이 틀리면 null.
 * 참여자 목록에 없는 이름이 든 메시지와 상한을 넘은 메시지는 그림에서 빼고, 뺀 개수를 notes 끝에 적는다.
 */
export function parseSeq(raw: string): SeqData | null {
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
  if (!Array.isArray(o.participants) || !Array.isArray(o.messages)) return null
  // 줄바꿈과 탭은 빈칸 하나로: 그대로 두면 터미널 그림 한 줄이 두 줄로 갈라져 세로줄이 어긋난다
  const str = (x: unknown) => (typeof x === 'string' ? x.replace(/\s+/g, ' ').trim() : '')
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
  const notes = Array.isArray(o.notes) ? o.notes.map(str).filter(Boolean).slice(0, 4) : []
  if (unknown) notes.push(`참여자 목록에 없는 이름이 든 메시지 ${unknown}개는 뺐어요`)
  if (messages.length > MAX_MESSAGES) notes.push(`메시지 ${messages.length - MAX_MESSAGES}개 더 있음 (${MAX_MESSAGES}개까지 그림)`)
  return { title: str(o.title), participants, messages: messages.slice(0, MAX_MESSAGES), notes }
}

/** 마지막 assistant 메시지 중 글이 있는 것. 없으면 undefined. */
export function lastAnswer(messages: ReadonlyArray<{ role: string; text: string }>): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m && m.role === 'assistant' && m.text.trim()) return m.text
  }
  return undefined
}
