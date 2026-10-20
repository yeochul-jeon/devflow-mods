// 답이 끝나면 다음에 보낼 만한 요청 2~3개를 입력창 위에 띄운다.
// 빈 입력창에서 1~3 을 누르면 그 제안이 초안으로 들어가고(저절로 보내지 않음), 0 은 닫는다. 줄을 클릭하면 커서 자리에 끼워 넣는다.
// 아이디어: hamzafer/claude-code-mods 의 next-steps (MIT). 코드는 새로 썼다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NextSteps, Spent } from '../types'
import { buildRequest, MAX_TOKENS, MIN_ANSWER, parseSteps } from './steps'

const OFF_KEY = 'off'
// $.state 에 두어 핫 리로드에도 유지된다.
const steps = atom({ plugin: 'next-steps', key: 'steps' } as const, null as NextSteps | null)
const spent = atom({ plugin: 'next-steps', key: 'spent' } as const, { calls: 0, input: 0, output: 0 } as Spent)

let off = false
/** 제안을 보여도 되는 턴. 전송이나 새 턴이 오면 바뀌어, 늦게 도착한 제안을 버린다. */
let latest = ''
let submits = 0
/** 설문이 떠 있으면 숫자는 설문의 답이다. */
let hasSurvey = false

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    off = (await $.store.get(OFF_KEY)) === true
    await $.command.register({ name: 'next', description: '다음 요청 제안: 사용량 보기, 켜기·끄기', argumentHint: '[on | off]' })
    return r
  })

  on('command.run', { command: 'next' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === 'on' || arg === 'off') {
      off = arg === 'off'
      await $.store.set(OFF_KEY, off)
      if (off) await update($, steps, () => null)
      return { text: off ? '다음 요청 제안을 껐어요. 다시 켜려면 /next on' : '다음 요청 제안을 켰어요.' }
    }
    if (arg) return { text: '쓰는 법: /next (사용량) · /next on · /next off' }
    const s = await read($, spent)
    return {
      text: `다음 요청 제안: ${off ? '꺼짐' : '켜짐'} · 이번 세션 ${s.calls}회, Haiku 입력 ${s.input.toLocaleString('en-US')} · 출력 ${s.output.toLocaleString('en-US')} 토큰`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    latest = `submit-${++submits}`
    await update($, steps, () => null)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    latest = e.turnId
    await update($, steps, () => null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r // 서브에이전트의 턴
    latest = e.turnId
    if (off || e.reason !== 'answer' || e.answer.trim().length < MIN_ANSWER) return r
    // 턴을 붙잡지 않도록 뒤에서 만든다
    void suggest($, e.turnId, e.answer).catch(err => $.ui.toast(`next-steps: ${err instanceof Error ? err.message : String(err)}`))
    return r
  })

  // 빈 입력창에 친 숫자 하나는 제안 고르기. 붙여 넣기에는 key 가 없어 그대로 들어간다.
  on('prompt.edit', async ($, e, next) => {
    if (hasSurvey || !e.key || e.key.ctrl || e.key.meta || e.text !== '' || e.start !== 0 || e.end !== 0 || !/^[0-9]$/.test(e.inputText)) return next(e)
    const s = await read($, steps)
    if (!s) return next(e)
    if (e.inputText === '0') {
      await update($, steps, () => null)
      return { text: '', cursor: 0 }
    }
    const pick = s.items[Number(e.inputText) - 1]
    return pick ? next({ ...e, inputText: pick }) : next(e)
  })

  // 다른 mod 와 Claude Code 가 그린 것은 그대로 두고 그 위에 붙인다.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    hasSurvey = e.props.hasSurvey
    const s = await read($, steps)
    if (e.props.hasSurvey || e.props.isWorking || !s || s.items.length === 0) return rest

    const { Box, Text, Button } = $.ui.resolve(e)
    // 0 닫기도 제안 줄과 같은 Button. 끝 공백은 아래 제안 줄과 같은 까닭
    const close = (
      <Button key="close" plain onPress={() => void update($, steps, () => null)}>
        <Text color="cyan" bold>{'0 '}</Text>
        <Text dimColor>{'닫기 '}</Text>
      </Button>
    )
    // 제안 하나: 번호와 글을 한 Button 으로. 마우스를 올리면 엔진이 Button 전체를 반전한다.
    // 반전이 오른쪽 끝에서 한 칸 모자라 마지막 넓은 글자가 반만 덮이므로 끝에 공백 한 칸을 둔다
    const item = (t: string, i: number, shrink: boolean) => (
      <Box flexShrink={shrink ? 1 : 0}>
        <Button key={`step-${i + 1}`} plain onPress={() => void pick($, t)}>
          <Text color="cyan" bold>{`${i + 1} `}</Text>
          <Text wrap="truncate-end">{`${t} `}</Text>
        </Button>
      </Box>
    )
    // 줄이 모자라면 한 줄에 모은다. 가로줄 한 줄을 더 센다
    const oneRow = e.props.maxRows < s.items.length + 3
    const mine = oneRow ? (
      <Box height={1} overflow="hidden">
        {/* 줄지 않게 두어야 폭이 넘칠 때 라벨·구분 기호가 0칸으로 줄지 않고 오른쪽 끝에서 잘린다 */}
        <Box key="one-row" flexShrink={0}>
          <Text dimColor>{'다음: '}</Text>
          {s.items.flatMap((t, i) => [item(t, i, false), <Text dimColor>{' ·  '}</Text>])}
          {close}
        </Box>
      </Box>
    ) : (
      <Box flexDirection="column">
        {s.items.map((t, i) => (
          <Box height={1} overflow="hidden">
            <Text dimColor>{i === 0 ? '다음: ' : '      '}</Text>
            {item(t, i, true)}
          </Box>
        ))}
        <Box height={1} overflow="hidden">
          <Text dimColor>{'      '}</Text>
          {close}
          <Text dimColor wrap="truncate-end">· 클릭이나 빈 입력창에서 숫자</Text>
        </Box>
      </Box>
    )
    return (
      <Box flexDirection="column">
        {/* 바로 위 대화 기록과 나눈다. 흐리게 그려 입력창의 가로줄과 다투지 않게 한다. 두 줄도 안 되면 뺀다 */}
        {e.props.maxRows >= 2 && <Text dimColor wrap="truncate-end">{rule(e.props.bodyColumns)}</Text>}
        <Box paddingX={1}>{mine}</Box>
        {rest}
      </Box>
    )
  })
}

/** 띠 폭을 채우는 이름 붙은 가로줄. */
function rule(width: number): string {
  const head = '── next-steps '
  return head + '─'.repeat(Math.max(0, width - head.length))
}

/** 누른 제안을 커서 자리에 끼워 넣는다. 보내지는 않는다. */
async function pick($: EngineInterface, text: string): Promise<void> {
  await $.prompt.fill({ text, mode: 'insert' })
}

async function suggest($: EngineInterface, turnId: string, answer: string): Promise<void> {
  // 백그라운드 에이전트가 돌고 있으면 메인이 곧 다시 일하므로 건너뛴다
  const agents = await $.agent.list()
  if (agents.some(a => a.status === 'running')) return

  const history = (await $.session.messages()).filter(m => m.text.trim() !== '')
  if (history.at(-1)?.role === 'assistant') history.pop() // 최신 답은 따로 넣는다
  const { system, prompt } = buildRequest(history, answer)
  const r = await $.model.complete({ model: 'haiku', system, prompt, maxTokens: MAX_TOKENS, timeoutMs: 20_000 })
  await update($, spent, s => ({ calls: s.calls + 1, input: s.input + r.usage.input_tokens, output: s.output + r.usage.output_tokens }))
  if (!r.isAnswered) {
    // 시간 초과(aborted)와 빈 답은 조용히 넘기고, API 오류는 알린다
    if (r.reason === 'api-error') $.ui.toast(`next-steps: 제안을 만들지 못했어요 (api-error ${r.status ?? ''})`)
    return
  }
  const items = parseSteps(r.text, r.usage.output_tokens >= MAX_TOKENS)
  // 그사이 전송이나 새 턴이 왔으면 버린다
  if (latest !== turnId) return
  await update($, steps, () => (items.length > 0 ? { turnId, items } : null))
}
