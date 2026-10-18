import { atom, read, update } from 'claude-code'
import type { ModelCompleteResult, Register } from 'claude-code'

import type { DrawView } from '../types'
import { flowArt } from './diagram'
import { buildPrompt, lastAnswer, parseDraw } from './prompt'

const PANE = 'draw'
const IDLE: DrawView = { status: 'idle', data: null, text: '', focus: '' }
// $.state 에 두어 핫 리로드에도 내용이 유지된다.
const view = atom({ plugin: 'draw', key: 'view' } as const, IDLE)

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'draw',
      description: '직전 답변의 흐름을 원문 낱말 그대로 옆 패널에 그림으로',
      argumentHint: '[그릴 부분]',
    })
    return next(e)
  })

  on('command.run', { command: 'draw' }, async ($, e) => {
    const focus = e.args.trim()
    const source = lastAnswer(await $.session.messages())
    if (!source) return { text: '그릴 답변이 없어요.' }

    await update($, view, (): DrawView => ({ ...IDLE, status: 'loading', focus }))
    await $.ui.open({ id: PANE, title: '그림', closeOnEscape: true })

    const fail = async (why: string) => {
      await update($, view, (v): DrawView => ({ ...v, status: 'error', text: why }))
      return { text: `/draw: ${why}` }
    }

    let r: ModelCompleteResult
    try {
      // 측정(claude -p, Haiku)에서 생각 토큰을 포함한 출력이 1.5천~5.5천이었다. 2000 이면 잘린다
      r = await $.model.complete({ model: 'haiku', prompt: buildPrompt(source, focus), maxTokens: 8000, timeoutMs: 90_000 })
    } catch (err) {
      // 엔진이 보내기를 거부한 요청(막힌 모델 등)은 reject 된다. 로딩에 머물지 않게 이유를 보여준다
      return fail(`모델 호출 실패 (${err instanceof Error ? err.message : String(err)})`)
    }
    if (!r.isAnswered) return fail(r.reason === 'aborted' ? '시간이 초과되었거나 취소됐어요.' : `모델 호출 실패 (${r.reason})`)

    const data = parseDraw(r.text)
    if (!data) return fail('모델 답이 그림 형식(JSON)이 아니에요. 다시 /draw 해 주세요.')
    if (data.flows.length === 0) return fail('직전 답변에서 그릴 흐름을 찾지 못했어요.')

    await update($, view, (v): DrawView => ({ ...v, status: 'done', data }))
    // 이 줄은 모델도 읽으므로 짧게 둔다. 그림은 패널에만.
    return { text: '그림을 옆 패널에 띄웠어요. (Esc로 닫기)' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, view)
    const width = Math.max(20, (e.props.bodyColumns ?? 60) - 2)

    if (v.status === 'loading') {
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color="cyan">그리는 중…</Text>
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
          <Text dimColor>/draw 를 입력하면 직전 답변의 흐름이 여기에 그림으로 나와요.</Text>
        </Box>
      )
    }
    const d = v.data
    return (
      <Box flexDirection="column" paddingX={1}>
        {d.title ? <Text bold>{d.title}</Text> : null}
        {v.focus ? <Text dimColor>초점: {v.focus}</Text> : null}
        {d.flows.map((f, i) => (
          <Box key={`f${i}`} flexDirection="column" marginTop={1}>
            {f.label ? <Text color="cyan">{f.label}</Text> : null}
            {flowArt(f.steps, width).map((line, j) => <Text key={`l${j}`}>{line}</Text>)}
          </Box>
        ))}
        {d.notes.length > 0 ? (
          <Box flexDirection="column" marginTop={1}>
            {d.notes.map((n, i) => <Text key={`n${i}`} dimColor>· {n}</Text>)}
          </Box>
        ) : null}
      </Box>
    )
  })
}
