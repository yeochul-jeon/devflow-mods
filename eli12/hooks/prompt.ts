// 순수 함수만 둔다: $ 에 의존하지 않으므로 다른 도구로 옮기기 쉽다.

export const MAX_SOURCE_CHARS = 12_000

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
    '형식:',
    '1. 한 줄 요약 (20자 안팎)',
    '2. 일상 비유 하나 (3~4문장)',
    '3. 텍스트 그림 하나: 상자 ┌─┐ 와 화살표 → 로 그린 흐름도.',
    '   한 줄은 한글 기준 30자 이내, 최대 12줄.',
    '4. 기억할 것 3가지 (각 한 줄)',
    '',
    '규칙: 전문 용어는 처음 나올 때 괄호로 쉽게 풀어줘. 마크다운 표나 코드 블록은 쓰지 마.',
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
    '형식:',
    '1. 한 줄 요약 (20자 안팎)',
    '2. 일상 비유 하나 (3~4문장)',
    '3. 텍스트 그림 하나: 상자 ┌─┐ 와 화살표 → 로 그린 흐름도.',
    '   한 줄은 한글 기준 30자 이내, 최대 12줄.',
    '4. 비유가 맞지 않는 부분 (한 줄)',
    '5. 실제 용어로 다시 (2~3문장)',
    '',
    '규칙: 마크다운 표나 코드 블록은 쓰지 마.',
  ].join('\n')
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
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
}
