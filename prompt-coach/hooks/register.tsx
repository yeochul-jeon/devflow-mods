// 보내기 전 초안을 목표·맥락·조건·완료 기준 순으로 다듬어 입력창에 다시 채운다. 보내는 것은 사람이 한다.
// /coach <초안> 또는 입력창 위 [다듬기]. 전송 경로에는 끼어들지 않는다.
// 아이디어: yuk7392/prompt-coach 의 Refine (MIT). 코드는 새로 썼다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CoachBand, Spent } from '../types'
import { buildRefine, MAX_TOKENS, parseRefined, tooShort } from './refine'

// $.state 에 두어 핫 리로드에도 유지된다.
const band = atom({ plugin: 'prompt-coach', key: 'band' } as const, { hasDraft: false, busy: false } as CoachBand)
const spent = atom({ plugin: 'prompt-coach', key: 'spent' } as const, { calls: 0, input: 0, output: 0 } as Spent)
/** 마지막으로 다듬기 전의 원문. /coach undo 가 되돌린다. */
const original = atom({ plugin: 'prompt-coach', key: 'original' } as const, '')

type Outcome = { isDone: true; text: string } | { isDone: false; why: string }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'coach', description: '초안을 목표·맥락·조건·완료 기준 순으로 다듬어 입력창에', argumentHint: '<초안> | undo' })
    return r
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    const arg = e.args.trim()
    if (arg === '') {
      const s = await read($, spent)
      return {
        text: `쓰는 법: /coach <초안> · 입력창 위 [다듬기] · /coach undo\n이번 세션 ${s.calls}회, Haiku 입력 ${s.input.toLocaleString('en-US')} · 출력 ${s.output.toLocaleString('en-US')} 토큰`,
      }
    }
    if (arg === 'undo') {
      const before = await read($, original)
      if (!before) return { text: '되돌릴 원문이 없어요.' }
      const filled = await $.prompt.fill({ text: before, mode: 'replace' })
      return { text: filled.isFilled ? '다듬기 전 원문을 입력창에 되돌렸어요.' : `입력창에 넣지 못했어요 (${filled.refusal ?? '알 수 없음'})` }
    }
    // 명령을 보냈으니 입력창은 비어 있다. 그대로 채운다.
    const r = await refine($, arg)
    if (!r.isDone) return { text: `/coach: ${r.why}` }
    const filled = await $.prompt.fill({ text: r.text, mode: 'replace' })
    return { text: filled.isFilled ? '다듬은 초안을 입력창에 넣었어요. 고치거나 그대로 보내세요. (/coach undo 로 원문)' : `입력창에 넣지 못했어요 (${filled.refusal ?? '알 수 없음'})` }
  })

  // 초안이 있는지만 따라간다. 바뀔 때만 써서 띠를 다시 그리게 한다.
  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    const hasDraft = r.text.trim() !== ''
    if ((await read($, band)).hasDraft !== hasDraft) await update($, band, b => ({ ...b, hasDraft }))
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    if ((await read($, band)).hasDraft) await update($, band, b => ({ ...b, hasDraft: false }))
    return next(e)
  })

  // 다른 mod 와 Claude Code 가 그린 것은 그대로 두고 그 위에 붙인다.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    const b = await read($, band)
    if (e.props.hasSurvey || e.props.isWorking || (!b.hasDraft && !b.busy)) return rest
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" columnGap={1} paddingX={1}>
          {b.busy ? (
            <Text dimColor>다듬는 중…</Text>
          ) : (
            <Button key="coach-refine" label="다듬기" onPress={() => refineBox($)} />
          )}
          <Text dimColor>목표 → 맥락 → 조건 → 완료 기준 (Haiku)</Text>
        </Box>
        {rest}
      </Box>
    )
  })
}

/** 입력창의 지금 초안을 다듬는다. 모델이 일하는 동안 초안이 바뀌었으면 덮지 않는다. */
async function refineBox($: EngineInterface): Promise<void> {
  const { text: draft } = await $.prompt.read()
  await update($, band, b => ({ ...b, busy: true }))
  try {
    const r = await refine($, draft)
    if (!r.isDone) {
      $.ui.toast(`prompt-coach: ${r.why}`)
      return
    }
    if ((await $.prompt.read()).text !== draft) {
      $.ui.toast('prompt-coach: 다듬는 동안 초안이 바뀌어 덮지 않았어요. 다시 눌러 주세요.')
      return
    }
    const filled = await $.prompt.fill({ text: r.text, mode: 'replace' })
    if (!filled.isFilled) $.ui.toast(`prompt-coach: 입력창에 넣지 못했어요 (${filled.refusal ?? '알 수 없음'})`)
  } finally {
    await update($, band, b => ({ ...b, busy: false }))
  }
}

async function refine($: EngineInterface, draft: string): Promise<Outcome> {
  if (tooShort(draft)) return { isDone: false, why: '초안이 너무 짧아요 (공백 빼고 12자 이상).' }
  const { system, prompt } = buildRefine(draft)
  let r
  try {
    r = await $.model.complete({ model: 'haiku', system, prompt, maxTokens: MAX_TOKENS, timeoutMs: 30_000 })
  } catch (err) {
    // 엔진이 보내기를 거부한 요청(막힌 모델 등)은 reject 된다
    return { isDone: false, why: `모델 호출 실패 (${err instanceof Error ? err.message : String(err)})` }
  }
  await update($, spent, s => ({ calls: s.calls + 1, input: s.input + r.usage.input_tokens, output: s.output + r.usage.output_tokens }))
  if (!r.isAnswered) return { isDone: false, why: `모델 호출 실패 (${r.reason})` }
  const text = parseRefined(r.text)
  if (text === null) return { isDone: false, why: '다듬지 못했어요. 모델이 초안 대신 말로 답했어요.' }
  await update($, original, () => draft)
  return { isDone: true, text }
}
