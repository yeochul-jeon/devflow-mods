// 답이 끝나면 다음에 보낼 만한 요청 2~3개를 입력창 위에 띄운다.
// 줄을 클릭하거나 빈 입력창에서 1~3 을 누르면 그 제안을 커서 자리에 넣고(저절로 보내지 않음), 0 은 닫는다.
// 숫자는 Button hotkey 라 띠가 보일 때만 먹는다. 가려진 띠가 다른 띠(엔진 Heads up 등)의 숫자를 가져가지 않는다
// 아이디어: hamzafer/claude-code-mods 의 next-steps (MIT). 코드는 새로 썼다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NextSteps, Spent } from '../types'
import { buildRequest, MAX_TOKENS, MIN_ANSWER, parseSteps } from './steps'

const OFF_KEY = 'off'
// $.state 에 두어 핫 리로드에도 유지된다.
const steps = atom({ plugin: 'next-steps', key: 'steps' } as const, null as NextSteps | null)
const spent = atom({ plugin: 'next-steps', key: 'spent' } as const, { calls: 0, input: 0, output: 0 } as Spent)
// 읽기만 한다. image-preview 가 입력창에 붙은 이미지 번호. image-preview 가 없으면 값이 없다
const imageDraft = atom({ plugin: 'image-preview', key: 'draft' } as const, [] as number[])
// 읽기만 한다. prompt-coach 의 입력창 초안 유무와 다듬기 단계. prompt-coach 가 없으면 값이 없다
const coachBand = atom({ plugin: 'prompt-coach', key: 'band' } as const, { hasDraft: false })
const coachFlow = atom({ plugin: 'prompt-coach', key: 'flow' } as const, { stage: 'idle' })
// 읽기만 한다. team-board 가 팀 창을 그릴 수 있는지: 이 세션이 팀에 올라 있고(me) /board band off 가 아님. team-board 가 없으면 값이 없다
const teamMe = atom({ plugin: 'team-board', key: 'me' } as const, null as object | null)
const teamBandOff = atom({ plugin: 'team-board', key: 'bandOff' } as const, false)

let off = false
/** 제안을 보여도 되는 턴. 전송이나 새 턴이 오면 바뀌어, 늦게 도착한 제안을 버린다. */
let latest = ''
let submits = 0

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
      if (off) {
        latest = `off-${++submits}` // 만들고 있던 제안도 버린다 (T56)
        await update($, steps, () => null)
      }
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
    // 백그라운드 보조 에이전트가 깨어난 턴은 메인 대화의 제안과 무관하다 (T56)
    if (e.agentId) return next(e)
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

  // 다른 mod 와 Claude Code 가 그린 것은 그대로 두고 그 아래(입력창 바로 위)에 붙인다.
  // 위에 붙이면 이 mod 가 바깥일 때 team-board 띠가 아래로 밀려 잘린다
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const s = await read($, steps)
    // 받은 줄이 없으면 그리지 않는다. 그려서 넘치면 엔진이 "↓ n more" 에 한 줄을 더 써 위 띠까지 가려진다
    if (e.props.hasSurvey || e.props.isWorking || !s || s.items.length === 0 || e.props.maxRows < 1) return next(e)
    // 줄 수는 받은 maxRows 와 공유 상태만으로 정한다 (docs/band-rows.md). Claude Code 2.1.323 부터 mod 마다 따로 불리고
    // 모두 띠 전체의 maxRows 를 받아, next 로 줄 수를 넘겨도 다른 mod 에 닿지 않는다. 그래서 next 에는 받은 e 를 그대로 넘긴다.
    // prompt-coach 가 다듬는 중이면 그 화면이 줄을 쓰고 숫자 키도 쓴다. 같은 숫자를 두 mod 가 그리면 둘 다 눌리지 않으므로 그리지 않는다
    // 제안은 지우지 않고 숨기기만 한다: 다듬기를 취소하거나 입력창을 비우면 다시 보이고, 보내면 위 prompt.submit 이 지운다
    if ((await read($, coachFlow)).stage !== 'idle') return next(e)
    // 칩 줄·다듬기 줄·팀 한 줄에 1줄씩 남기고도 자리가 되면 펼친다(가로줄 + 제안 + 닫기 줄 = items + 2 줄). 안 되면 한 줄에 모은다.
    // 가로줄 있는 한 줄 모양(2줄)도 그 줄들을 남길 수 있을 때만. 1줄뿐이면 이 띠가 칩 줄·다듬기 줄·팀 줄보다 먼저 남는다
    const hasChips = e.viewport?.isFullscreen !== false && (await read($, imageDraft)).length > 0
    const hasTeam = !!(await read($, teamMe)) && !(await read($, teamBandOff))
    const spare = (hasChips ? 1 : 0) + ((await read($, coachBand)).hasDraft ? 1 : 0) + (hasTeam ? 1 : 0)
    const oneRow = e.props.maxRows < s.items.length + 2 + spare
    const ruled = e.props.maxRows >= 2 + spare
    const rest = await next(e)
    // 같은 숫자는 나중에 그린 이 띠가 이긴다. 위 띠(엔진 Heads up 등)에 숫자 버튼이 있으면 그 숫자를 빼앗지 않도록 클릭만 받는다
    const keys = !hasDigitKey(rest)

    const { Box, Text, Button } = $.ui.resolve(e)
    // 번호는 엔진이 hotkey 로 그린다(`1: `, 강조색). 0 닫기도 제안 줄과 같은 Button. 끝 공백은 아래 제안 줄과 같은 까닭
    const close = (
      <Button key="close" hotkey={keys ? '0' : undefined} plain onPress={() => void update($, steps, () => null)}>
        <Text dimColor>{'닫기 '}</Text>
      </Button>
    )
    // 제안 하나: 번호와 글을 한 Button 으로. 마우스를 올리면 엔진이 Button 전체를 반전한다.
    // 반전이 오른쪽 끝에서 한 칸 모자라 마지막 넓은 글자가 반만 덮이므로 끝에 공백 한 칸을 둔다
    const item = (t: string, i: number, shrink: boolean) => (
      <Box flexShrink={shrink ? 1 : 0}>
        <Button key={`step-${i + 1}`} hotkey={keys ? String(i + 1) : undefined} plain onPress={() => void pick($, t)}>
          <Text wrap="truncate-end">{`${t} `}</Text>
        </Button>
      </Box>
    )
    const mine = oneRow ? (
      // 글자 하나하나를 줄지 않는 Box 에 담는다. 엔진이 hotkey 번호(`1: `)를 뺀 폭으로 줄을 재서, 폭이 넘치면 버튼 앞 글자가 번호 폭만큼 줄어 덮였다.
      // 이렇게 두면 아무것도 줄지 않고 오른쪽 끝에서만 잘린다
      <Box key="one-row" height={1} overflow="hidden">
        <Box flexShrink={0}><Text dimColor>{'다음: '}</Text></Box>
        {s.items.flatMap((t, i) => [item(t, i, false), <Box flexShrink={0}><Text dimColor>{' ·  '}</Text></Box>])}
        <Box flexShrink={0}>{close}</Box>
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
          <Text dimColor wrap="truncate-end">{keys ? '· 클릭이나 빈 입력창에서 숫자' : '· 클릭으로 고르기'}</Text>
        </Box>
      </Box>
    )
    return (
      <Box flexDirection="column">
        {rest}
        {/* 바로 위 대화 기록이나 다른 mod 띠와 나눈다. 흐리게 그려 입력창의 가로줄과 다투지 않게 한다. 세 줄도 안 되면 뺀다 */}
        {ruled && <Text dimColor wrap="truncate-end">{rule(e.props.bodyColumns)}</Text>}
        <Box paddingX={1}>{mine}</Box>
      </Box>
    )
  })
}

/** 그린 트리(RenderNode: type·props·children)에 숫자 hotkey Button 이 있는지. */
function hasDigitKey(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasDigitKey)
  if (!node || typeof node !== 'object') return false
  const n = node as { type?: unknown; props?: { hotkey?: unknown }; children?: unknown }
  return (n.type === 'Button' && typeof n.props?.hotkey === 'string' && /^[0-9]$/.test(n.props.hotkey)) || hasDigitKey(n.children)
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
  // 그사이 전송·새 턴·끄기가 왔으면 버린다. 쓰다가 겹치면 update 가 다시 부르므로 그 안에서 본다 (T56)
  await update($, steps, cur => (latest !== turnId ? cur : items.length > 0 ? { turnId, items } : null))
}
