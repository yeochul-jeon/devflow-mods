import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Eli12View } from '../types'
import { buildPrompt, buildTopicPrompt, lastAnswer, stripMarkdown } from './prompt'

const PANE = 'eli12'
const IDLE: Eli12View = { status: 'idle', text: '', focus: '' }
// $.state 에 두어 핫 리로드에도 내용이 유지된다.
const view = atom({ plugin: 'eli12', key: 'view' } as const, IDLE)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'eli12',
      description: '직전 답변을 12살도 이해하게 (비유 + 그림) 옆 패널에 다시 설명',
      argumentHint: '[어려운 부분]',
    })
    return next(e)
  })

  on('command.run', { command: 'eli12' }, async ($, e) => {
    const focus = e.args.trim()
    const source = lastAnswer(await $.session.messages())
    // 직전 답변이 있으면 그 답변을, 없으면 적은 주제 자체를 설명한다.
    const prompt = source ? buildPrompt(source, focus) : focus ? buildTopicPrompt(focus) : undefined
    if (!prompt) return { text: '설명할 답변이 없어요. /eli12 <주제> 처럼 주제를 적어 주세요.' }

    await update($, view, (): Eli12View => ({ status: 'loading', text: '', focus }))
    await $.ui.open({ id: PANE, title: '12살 버전', closeOnEscape: true })

    const r = await $.model.complete({
      model: 'haiku',
      prompt,
      maxTokens: 2000,
      timeoutMs: 90_000,
    })

    if (!r.isAnswered) {
      const why = r.reason === 'aborted' ? '시간이 초과되었거나 취소됐어요.' : `모델 호출 실패 (${r.reason})`
      await update($, view, (v): Eli12View => ({ ...v, status: 'error', text: why }))
      return { text: `/eli12: ${why}` }
    }

    await update($, view, (v): Eli12View => ({ ...v, status: 'done', text: stripMarkdown(r.text).trim() }))
    // 이 줄은 모델도 읽으므로 짧게 둔다. 본문은 패널에만.
    return { text: '12살 버전을 옆 패널에 띄웠어요. (Esc로 닫기)' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, view)

    if (v.status === 'loading') {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color="cyan">쉽게 바꾸는 중…</Text>
          {v.focus ? <Text dimColor>초점: {v.focus}</Text> : null}
        </Box>
      )
    }
    if (v.status === 'error') {
      return (
        <Box paddingX={1}>
          <Text color="red">{v.text}</Text>
        </Box>
      )
    }
    if (v.status === 'idle') {
      return (
        <Box paddingX={1}>
          <Text dimColor>/eli12 를 입력하면 직전 답변의 쉬운 버전이 여기에 나와요.</Text>
        </Box>
      )
    }
    return (
      <Box flexDirection="column" paddingX={1}>
        {v.focus ? <Text dimColor>초점: {v.focus}</Text> : null}
        {v.text.split('\n').map(line => <Text>{line || ' '}</Text>)}
      </Box>
    )
  })
}
