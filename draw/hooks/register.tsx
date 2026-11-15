import { atom, read, update } from 'claude-code'
import type { ModelCompleteResult, Register, Timer } from 'claude-code'

import type { DrawView } from '../types'
import { chooseLayout, compactLines, flowHead, flowSvg, packRows, progressBar } from './diagram'
import { buildPrompt, lastAnswer, parseDraw } from './prompt'

const PANE = 'draw'
const IDLE: DrawView = { status: 'idle', data: null, text: '', focus: '' }
// $.state 에 두어 핫 리로드에도 내용이 유지된다.
const view = atom({ plugin: 'draw', key: 'view' } as const, IDLE)
// 그리는 동안 1초마다 올라가는 경과 초. 패널은 이 값이 바뀔 때 다시 그려진다.
const elapsed = atom({ plugin: 'draw', key: 'elapsed' } as const, 0)
let ticker: Timer | null = null
// 측정(README)에서 6~22초가 걸렸다. 막대는 15초에 가득 차고 그 뒤로는 가득 찬 채 초만 올라간다
const EXPECTED_SECONDS = 15
// 흐름마다 이름·테두리·칩 색
const COLORS = ['cyan', 'yellow', 'magenta', 'green'] as const
const CHIP_BG = ['#24434a', '#4a3a22', '#43284a', '#28452e'] as const

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
    await update($, elapsed, () => 0)
    ticker?.cancel()
    // 틱이 mod 다시 읽기(핫 리로드) 뒤에 오면 update 가 거절된다. 그 틱은 버려도 되므로 삼킨다
    const tick = $.clock.every(1000, () => void update($, elapsed, n => n + 1).catch(() => {}))
    ticker = tick
    try {
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
    } finally {
      // 끝·실패·예외 어느 쪽이든 이 실행의 시계를 멈춘다 (뒤에 시작한 /draw 의 시계는 두고)
      tick.cancel()
      if (ticker === tick) ticker = null
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const v = await read($, view)
    // 상자는 줄어들지 않으므로(flexShrink 0) 실제 안쪽 폭으로 나눈다. 8칸 아래는 상자 안 폭(4)도 안 남는다
    const width = Math.max(8, (e.props.bodyColumns ?? 60) - 2)

    if (v.status === 'loading') {
      const seconds = await read($, elapsed)
      return (
        <Box flexDirection="column" paddingX={1}>
          <Text color="cyan">그리는 중… {seconds}초</Text>
          <Text color="cyan">{progressBar(seconds, EXPECTED_SECONDS, Math.min(20, width))}</Text>
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
    const color = (i: number) => COLORS[i % COLORS.length]!
    // 터미널(Ink)에는 Svg 가 없다. surface 로 좁힌 뒤에 resolve 해야 Svg 가 보인다
    const Svg = e.surface === 'terminal' ? null : $.ui.resolve(e).Svg

    if (chooseLayout(d, width, { placement: e.props.placement, bodyRows: e.props.scroll?.bodyRows }, v.focus) === 'compact') {
      // 보이는 줄이 모자라면 제목·초점을 빼고 흐름마다 칩 줄로. 메모는 개수만
      return (
        <Box flexDirection="column" paddingX={1}>
          {d.flows.flatMap((f, i) =>
            compactLines(flowHead(f.label, i), f.steps, width).map((line, j) => (
              <Box key={`f${i}-${j}`} flexDirection="row">
                {line.map((s, k) =>
                  s.kind === 'chip' ? (
                    <Text key={`s${k}`} backgroundColor={CHIP_BG[i % CHIP_BG.length]} color="white">{s.text}</Text>
                  ) : s.kind === 'head' ? (
                    <Text key={`s${k}`} color={color(i)}>{s.text}</Text>
                  ) : s.kind === 'arrow' ? (
                    <Text key={`s${k}`} dimColor>{s.text}</Text>
                  ) : (
                    <Text key={`s${k}`}>{s.text}</Text>
                  ),
                )}
              </Box>
            )),
          )}
          {d.notes.length > 0 ? <Text dimColor>· 메모 {d.notes.length}개는 패널을 키우면 보여요</Text> : null}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {d.title ? <Text bold>{d.title}</Text> : null}
        {v.focus ? <Text dimColor>초점: {v.focus}</Text> : null}
        {d.flows.map((f, i) => (
          <Box key={`f${i}`} flexDirection="column" marginTop={1}>
            <Text color={color(i)}>{flowHead(f.label, i)}</Text>
            {Svg ? (
              // 데스크톱 앱·VS Code·모바일: 상자 줄을 그림 하나로 (E3). 엔진이 칸에 맞춰 줄여 그린다
              <Svg source={flowSvg(f.steps, width, i).source} alt={`${flowHead(f.label, i)}: ${f.steps.join(' → ')}`} />
            ) : packRows(f.steps, width).map((row, j) => (
              // 줄 나누기는 packRows 가 했으므로 엔진이 상자를 줄이거나 넘기지 않게 flexShrink 0
              <Box key={`r${j}`} flexDirection="row" alignItems="center">
                {row.boxes.flatMap((lines, k) => [
                  ...(k ? [<Box key={`a${k}`} flexShrink={0}><Text dimColor> → </Text></Box>] : []),
                  <Box key={`b${k}`} flexDirection="column" borderStyle="round" borderColor={color(i)} paddingX={1} flexShrink={0}>
                    {lines.map((l, m) => <Text key={`l${m}`}>{l}</Text>)}
                  </Box>,
                ])}
                {row.more ? <Box flexShrink={0}><Text dimColor> →</Text></Box> : null}
              </Box>
            ))}
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
