// 순수 함수만 둔다. $ 에 의존하지 않아 테스트하기 쉽다.

export const MAX_ITEMS = 3
/** 이보다 긴 제안은 자르지 않고 버린다. 잘린 초안은 반쪽짜리 요청이 된다. */
export const MAX_KEPT = 120
/** 이보다 짧은 답 뒤에는 모델을 부르지 않는다. */
export const MIN_ANSWER = 20
/** Haiku 출력 상한. 여기에 닿으면 마지막 줄이 잘렸을 수 있다. */
export const MAX_TOKENS = 200
const HISTORY = 6
const PER_MESSAGE = 800
const ANSWER_CHARS = 2000
const OMITTED = '\n[... middle omitted ...]\n'

type Message = { role: 'user' | 'assistant'; text: string }

/** 앞과 끝을 절반씩 남기고 가운데를 뺀다. 표시까지 max 글자 안이다. 긴 답의 질문·다음 단계는 끝에 있다 (T56: 끝 1000자가 그중 80%를 담는다). */
export function excerpt(text: string, max: number): string {
  const chars = Array.from(text)
  if (chars.length <= max) return text
  const room = max - OMITTED.length
  const head = Math.floor(room / 2)
  return chars.slice(0, head).join('') + OMITTED + chars.slice(chars.length - (room - head)).join('')
}

/** 최근 대화 6개(각 800자)와 최신 답(앞뒤 합쳐 2000자)으로 Haiku 요청을 만든다. 대화 기록 전체는 보내지 않는다. */
export function buildRequest(history: readonly Message[], answer: string): { system: string; prompt: string } {
  const recent = history.filter(m => m.text.trim() !== '').slice(-HISTORY)
  const system = [
    'You read the end of a coding session and predict what the person will type next to their coding assistant.',
    'Give 2 or 3 short, concrete follow-up requests, each an instruction under 60 characters, specific to what just happened (name the file, test or feature).',
    'Write them in the same language the person writes in. Keep file names, commands and code identifiers as they are.',
    'One per line, no numbering, no quotes, nothing else. Plain text, no Markdown or backticks. If nothing sensible follows, reply with the single word NONE.',
    'A bracketed marker such as [... middle omitted ...] means text was left out, and excerpts may start or end inside code. Never comment on or continue the excerpt: only predict requests.',
  ].join('\n')
  const prompt = [
    `<transcript>\n${recent.map(m => `[${m.role === 'user' ? 'person' : 'assistant'}] ${m.text.slice(0, PER_MESSAGE)}`).join('\n')}\n</transcript>`,
    `<latest_reply>\n${excerpt(answer, ANSWER_CHARS)}\n</latest_reply>`,
    'Write the follow-up requests the person is likely to send next: the lines only.',
  ].join('\n\n')
  return { system, prompt }
}

/**
 * 모델 답을 제안 목록으로. 번호·글머리·감싼 따옴표·인라인 코드 백틱을 걷고, NONE·빈 줄·코드 울타리 줄·너무 긴 줄·같은 줄은 버린다.
 * 출력 상한에 닿아 끝났으면(truncated) 마지막 줄은 잘렸을 수 있어 버린다. 잘린 초안은 반쪽짜리 요청이 된다.
 */
export function parseSteps(text: string, truncated = false): string[] {
  const lines = text.trim().split('\n')
  if (truncated) lines.pop()
  const items = lines
    .filter(line => !line.trim().startsWith('```'))
    .map(line => line.trim().replace(/^(\d+[.)]|[-*•])\s+/, '').replace(/^["“](.*)["”]$/, '$1').replace(/(^|[^\w$`])`([^`]+)`(?![\w$`])/g, '$1$2').trim())
    .filter(line => line !== '' && line !== 'NONE' && line.length <= MAX_KEPT)
  return [...new Set(items)].slice(0, MAX_ITEMS)
}
