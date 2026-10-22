import { atom, read, update } from 'claude-code'
import type { ModelCompleteResult, Register } from 'claude-code'

import type { Eli12View } from '../types'
import { flowArt } from './diagram'
import { buildPrompt, buildTopicPrompt, lastAnswer, parseEli12 } from './prompt'

const PANE = 'eli12'
const IDLE: Eli12View = { status: 'idle', data: null, text: '', focus: '' }
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

    await update($, view, (): Eli12View => ({ ...IDLE, status: 'loading', focus }))
    await $.ui.open({ id: PANE, title: '12살 버전', closeOnEscape: true })

    let r: ModelCompleteResult
    try {
      r = await $.model.complete({
        model: 'haiku',
        prompt,
        // 실측(claude -p, Haiku, 원문 1.1만 자 5회)에서 1회가 생각 토큰만 2309였다. 2000 이면 글 없이 끝나 empty-reply
        maxTokens: 8000,
        timeoutMs: 90_000,
      })
    } catch (err) {
      // 엔진이 보내기를 거부한 요청(막힌 모델 등)은 reject 된다. 로딩에 머물지 않게 이유를 보여준다
      const why = `모델 호출 실패 (${err instanceof Error ? err.message : String(err)})`
      await update($, view, (v): Eli12View => ({ ...v, status: 'error', text: why }))
      return { text: `/eli12: ${why}` }
    }

    if (!r.isAnswered) {
      const why = r.reason === 'aborted' ? '시간이 초과되었거나 취소됐어요.' : `모델 호출 실패 (${r.reason})`
      await update($, view, (v): Eli12View => ({ ...v, status: 'error', text: why }))
      return { text: `/eli12: ${why}` }
    }

    const data = parseEli12(r.text)
    if (!data) {
      const why = '모델 답이 형식(JSON)이 아니에요. 다시 /eli12 해 주세요.'
      await update($, view, (v): Eli12View => ({ ...v, status: 'error', text: why }))
      return { text: `/eli12: ${why}` }
    }

    await update($, view, (v): Eli12View => ({ ...v, status: 'done', data }))
    // 이 줄은 모델도 읽으므로 짧게 둔다. 본문은 패널에만.
    return { text: '12살 버전을 옆 패널에 띄웠어요. (Esc로 닫기)' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, view)
    const width = Math.max(20, (e.props.bodyColumns ?? 60) - 4)

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
    if (v.status === 'idle' || !v.data) {
      return (
        <Box paddingX={1}>
          <Text dimColor>/eli12 를 입력하면 직전 답변의 쉬운 버전이 여기에 나와요.</Text>
        </Box>
      )
    }
    const d = v.data
    const section = (title: string, body: JSX.Element[]) => (
      <Box flexDirection="column" marginTop={1}>
        <Text color="cyan" bold>{title}</Text>
        <Box flexDirection="column" paddingLeft={2}>{body}</Box>
      </Box>
    )
    return (
      <Box flexDirection="column" paddingX={1}>
        {v.focus ? <Text dimColor>초점: {v.focus}</Text> : null}
        {section('한 줄 요약', [<Text key="s">{d.summary}</Text>])}
        {d.analogy ? section('비유', [<Text key="a">{d.analogy}</Text>]) : null}
        {d.flows.length > 0
          ? section('그림', d.flows.map((f, i) => (
            <Box key={`f${i}`} flexDirection="column" marginTop={i > 0 ? 1 : 0}>
              {f.label ? <Text dimColor>{f.label}</Text> : null}
              {flowArt(f.steps, width).map((line, j) => <Text key={`l${j}`}>{line}</Text>)}
            </Box>
          )))
          : null}
        {d.remember.length > 0 ? section('기억할 것', d.remember.map((r, i) => (
          // 줄이 넘어가도 · 뒤에 맞춰 이어지게 둘로 나눈다
          <Box key={`r${i}`}><Text>· </Text><Text>{r}</Text></Box>
        ))) : null}
        {d.mismatch ? section('비유가 안 맞는 곳', [<Text key="m">{d.mismatch}</Text>]) : null}
        {d.real ? section('실제 용어로', [<Text key="r">{d.real}</Text>]) : null}
      </Box>
    )
  })
}
