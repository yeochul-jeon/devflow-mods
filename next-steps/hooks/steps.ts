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

type Message = { role: 'user' | 'assistant'; text: string }

/** 최근 대화 6개(각 800자)와 최신 답(2000자)으로 Haiku 요청을 만든다. 대화 기록 전체는 보내지 않는다. */
export function buildRequest(history: readonly Message[], answer: string): { system: string; prompt: string } {
  const recent = history.filter(m => m.text.trim() !== '').slice(-HISTORY)
  const system = [
    'You read the end of a coding session and predict what the person will type next to their coding assistant.',
    'Give 2 or 3 short, concrete follow-up requests, each an instruction under 60 characters, specific to what just happened (name the file, test or feature).',
    'Write them in the same language the person writes in. Keep file names, commands and code identifiers as they are.',
    'One per line, no numbering, no quotes, nothing else. If nothing sensible follows, reply with the single word NONE.',
  ].join('\n')
  const prompt = [
    `<transcript>\n${recent.map(m => `[${m.role === 'user' ? 'person' : 'assistant'}] ${m.text.slice(0, PER_MESSAGE)}`).join('\n')}\n</transcript>`,
    `<latest_reply>\n${answer.slice(0, ANSWER_CHARS)}\n</latest_reply>`,
    'Write the follow-up requests the person is likely to send next: the lines only.',
  ].join('\n\n')
  return { system, prompt }
}

/**
 * 모델 답을 제안 목록으로. 번호·글머리·감싼 따옴표를 걷고, NONE·빈 줄·너무 긴 줄은 버린다.
 * 출력 상한에 닿아 끝났으면(truncated) 마지막 줄은 잘렸을 수 있어 버린다. 잘린 초안은 반쪽짜리 요청이 된다.
 */
export function parseSteps(text: string, truncated = false): string[] {
  const lines = text.trim().split('\n')
  if (truncated) lines.pop()
  return lines
    .map(line => line.trim().replace(/^(\d+[.)]|[-*•])\s+/, '').replace(/^["“](.*)["”]$/, '$1').trim())
    .filter(line => line !== '' && line !== 'NONE' && line.length <= MAX_KEPT)
    .slice(0, MAX_ITEMS)
}
