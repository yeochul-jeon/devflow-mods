import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, ModelEffort, PluginOptions, Register, Timer } from 'claude-code'

import type { DrawView, SeqData } from '../types'
import { chooseLayout, compactLines, flowHead, flowStroke, flowSvg, packRows, progressBar } from './diagram'
import { buildPrompt, buildSeqPrompt, lastAnswer, parseDraw, parseSeq } from './prompt'
import { chooseSeqLayout, compactSeq, lifelineLines, listLines, seqAlt, seqSvg } from './sequence'
import type { SeqLine } from './sequence'

const PANE = 'draw'
const IDLE: DrawView = { status: 'idle', kind: 'flow', data: null, seq: null, text: '', focus: '' }
// $.state 에 두어 핫 리로드에도 내용이 유지된다.
const view = atom({ plugin: 'draw', key: 'view' } as const, IDLE)
// 그리는 동안 1초마다 올라가는 경과 초. 패널은 이 값이 바뀔 때 다시 그려진다.
const elapsed = atom({ plugin: 'draw', key: 'elapsed' } as const, 0)
let ticker: Timer | null = null
// 측정(README)에서 6~22초가 걸렸다. 막대는 15초에 가득 차고 그 뒤로는 가득 찬 채 초만 올라간다
const EXPECTED_SECONDS = 15
// /draw-seq 는 Haiku + effort high 측정(T70)에서 중앙 18초
const SEQ_EXPECTED_SECONDS = 20
// 흐름마다 이름·테두리·칩 색
const COLORS = ['cyan', 'yellow', 'magenta', 'green'] as const
const CHIP_BG = ['#24434a', '#4a3a22', '#43284a', '#28452e'] as const

const SEQ_COLOR: Record<NonNullable<SeqLine['kind']>, { color?: string; dimColor?: boolean; bold?: boolean }> = {
  head: { bold: true, color: 'cyan' },
  reply: { dimColor: true },
  self: { color: 'yellow' },
  dim: { dimColor: true },
}

/** /draw-seq 그림: 데스크톱 앱 등은 Svg 생명선, 터미널은 생명선형이나 번호 목록형, 줄이 모자란 패널은 압축형. */
function seqView(d: SeqData, focus: string, width: number, e: any, Box: any, Text: any, $: EngineInterface) {
  const layout = chooseSeqLayout(d, width, { placement: e.props.placement, bodyRows: e.props.scroll?.bodyRows }, focus)
  const line = (l: SeqLine, i: number) => <Text key={`l${i}`} {...(l.kind ? SEQ_COLOR[l.kind] : {})}>{l.text}</Text>
  if (layout === 'compact') {
    return (
      <Box flexDirection="column" paddingX={1}>
        {compactSeq(d, width, e.props.scroll?.bodyRows ?? 6).lines.map(line)}
      </Box>
    )
  }
  // 터미널(Ink)에는 Svg 가 없다. surface 로 좁힌 뒤에 resolve 해야 Svg 가 보인다
  const Svg = e.surface === 'terminal' ? null : $.ui.resolve(e).Svg
  const svg = Svg ? seqSvg(d, width) : null
  return (
    <Box flexDirection="column" paddingX={1}>
      {d.title ? <Text bold>{d.title}</Text> : null}
      {focus ? <Text dimColor>초점: {focus}</Text> : null}
      <Box flexDirection="column" marginTop={1}>
        {Svg && svg ? (
          // 폭과 높이를 주지 않으면 데스크톱 앱이 패널 폭까지 늘린다 (draw 0.3.1). 그림 자신의 크기로 고정한다
          <Svg source={svg.source} width={svg.width} height={svg.height} alt={seqAlt(d)} />
        ) : (layout === 'list' ? listLines(d, width) : lifelineLines(d, width)).map(line)}
      </Box>
      {d.notes.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {d.notes.map((n, i) => <Text key={`n${i}`} dimColor>· {n}</Text>)}
        </Box>
      ) : null}
    </Box>
  )
}

// /draw 와 /draw-seq 는 같은 패널을 쓴다. 다른 점은 프롬프트, 모델 설정, 답 읽기뿐이다
async function run($: EngineInterface, args: string, kind: 'flow' | 'seq', options: PluginOptions) {
  const focus = args.trim()
  const cmd = kind === 'seq' ? '/draw-seq' : '/draw'
  const source = lastAnswer(await $.session.messages())
  if (!source) return { text: '그릴 답변이 없어요.' }
  // 설정 화면은 plugin.json 의 options(low, medium, high)만 받고, 목록 밖 값은 엔진이 지워 기본값 high 가 된다. max 는 측정 1회에 6분, 생각 토큰 9만 개라 목록에 넣지 않았다
  const effort = String(options.seqEffort ?? 'high') as ModelEffort

  await update($, view, (): DrawView => ({ ...IDLE, status: 'loading', kind, focus }))
  await update($, elapsed, () => 0)
  ticker?.cancel()
  // 틱이 mod 다시 읽기(핫 리로드) 뒤에 오면 update 가 거절된다. 그 틱은 버려도 되므로 삼킨다
  const tick = $.clock.every(1000, () => void update($, elapsed, n => n + 1).catch(() => {}))
  ticker = tick
  try {
    await $.ui.open({ id: PANE, title: '그림', closeOnEscape: true })

    const fail = async (why: string) => {
      await update($, view, (v): DrawView => ({ ...v, status: 'error', text: why }))
      return { text: `${cmd}: ${why}` }
    }

    let r: ModelCompleteResult
    try {
      r = kind === 'seq'
        // effort high 측정(T70)에서 생각 토큰을 포함한 출력이 5.5천까지 나왔다. 설정으로 모델을 바꿔도 넉넉하게
        ? await $.model.complete({ model: String(options.seqModel ?? 'haiku') || 'haiku', effort, prompt: buildSeqPrompt(source, focus), maxTokens: 16_000, timeoutMs: 90_000 })
        // 측정(claude -p, Haiku)에서 생각 토큰을 포함한 출력이 1.5천~5.5천이었다. 2000 이면 잘린다
        : await $.model.complete({ model: 'haiku', prompt: buildPrompt(source, focus), maxTokens: 8000, timeoutMs: 90_000 })
    } catch (err) {
      // 엔진이 보내기를 거부한 요청(막힌 모델 등)은 reject 된다. 로딩에 머물지 않게 이유를 보여준다
      return fail(`모델 호출 실패 (${err instanceof Error ? err.message : String(err)})`)
    }
    if (!r.isAnswered) return fail(r.reason === 'aborted' ? '시간이 초과되었거나 취소됐어요.' : `모델 호출 실패 (${r.reason})`)

    if (kind === 'seq') {
      const seq = parseSeq(r.text)
      if (!seq) return fail('모델 답이 그림 형식(JSON)이 아니에요. 다시 /draw-seq 해 주세요.')
      if (seq.messages.length === 0) return fail('직전 답변에서 그릴 주고받음을 찾지 못했어요. 순서만 있는 설명이면 /draw 를 써 보세요.')
      await update($, view, (v): DrawView => ({ ...v, status: 'done', seq }))
    } else {
      const data = parseDraw(r.text)
      if (!data) return fail('모델 답이 그림 형식(JSON)이 아니에요. 다시 /draw 해 주세요.')
      if (data.flows.length === 0) return fail('직전 답변에서 그릴 흐름을 찾지 못했어요.')
      await update($, view, (v): DrawView => ({ ...v, status: 'done', data }))
    }
    // 이 줄은 모델도 읽으므로 짧게 둔다. 그림은 패널에만.
    return { text: '그림을 옆 패널에 띄웠어요. (Esc로 닫기)' }
  } finally {
    // 끝·실패·예외 어느 쪽이든 이 실행의 시계를 멈춘다 (뒤에 시작한 /draw 의 시계는 두고)
    tick.cancel()
    if (ticker === tick) ticker = null
  }
}

export const register: Register = (on, options) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'draw',
      description: '직전 답변의 흐름을 원문 낱말 그대로 옆 패널에 그림으로',
      argumentHint: '[그릴 부분]',
    })
    await $.command.register({
      name: 'draw-seq',
      description: '(실험) 직전 답변의 주고받음을 옆 패널에 시퀀스 다이어그램으로',
      argumentHint: '[그릴 부분]',
    })
    return next(e)
  })

  on('command.run', { command: 'draw' }, async ($, e) => run($, e.args, 'flow', options))
  on('command.run', { command: 'draw-seq' }, async ($, e) => run($, e.args, 'seq', options))

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
          <Text color="cyan">{progressBar(seconds, v.kind === 'seq' ? SEQ_EXPECTED_SECONDS : EXPECTED_SECONDS, Math.min(20, width))}</Text>
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
    if (v.status === 'done' && v.kind === 'seq' && v.seq) return seqView(v.seq, v.focus, width, e, Box, Text, $)
    if (v.status === 'idle' || !v.data) {
      return (
        <Box paddingX={1}>
          <Text dimColor>/draw 를 입력하면 직전 답변의 흐름이, /draw-seq 를 입력하면 주고받음이 여기에 그림으로 나와요.</Text>
        </Box>
      )
    }
    const d = v.data
    const color = (i: number) => COLORS[i % COLORS.length]!
    // 터미널(Ink)에는 Svg 가 없다. surface 로 좁힌 뒤에 resolve 해야 Svg 가 보인다
    const Svg = e.surface === 'terminal' ? null : $.ui.resolve(e).Svg
    // 데스크톱 앱 등에서는 흐름 이름을 Svg 테두리와 같은 진한 색으로: 앱의 yellow 는 밝은 테마 흰 바탕에서 읽히지 않았다(2026-11-15 캡처)
    const headColor = (i: number) => (Svg ? flowStroke(i) : color(i))

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
            <Text color={headColor(i)}>{flowHead(f.label, i)}</Text>
            {Svg ? (
              // 데스크톱 앱·VS Code·모바일: 상자 줄을 그림 하나로 (E3). 엔진이 칸에 맞춰 줄여 그린다
              // 폭·높이를 주지 않으면 데스크톱 앱이 패널 폭까지 늘려 글자가 1.7배로 커졌다(2026-11-15 캡처). 그림 자신의 크기로 고정한다
              <Svg {...flowSvg(f.steps, width, i)} alt={`${flowHead(f.label, i)}: ${f.steps.join(' → ')}`} />
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
