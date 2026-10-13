// 보내기 전 초안을 목표·맥락·조건·완료 기준 순으로 다듬어 입력창에 다시 채운다. 보내는 것은 사람이 한다.
// /coach <초안> 또는 입력창 위 [다듬기]. 전송 경로에는 끼어들지 않는다.
// 아이디어: yuk7392/prompt-coach 의 Refine (MIT). 코드는 새로 썼다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CoachBand, Spent } from '../types'
import { buildRefine, lacksDone, MAX_TOKENS, parseRefined, TEMPLATE, tooShort } from './refine'

// $.state 에 두어 핫 리로드에도 유지된다.
const band = atom({ plugin: 'prompt-coach', key: 'band' } as const, { hasDraft: false, busy: false } as CoachBand)
const spent = atom({ plugin: 'prompt-coach', key: 'spent' } as const, { calls: 0, input: 0, output: 0 } as Spent)
/** 마지막으로 다듬기 전의 원문. /coach undo 와 [되돌리기]가 되돌린다. 비어 있으면 되돌릴 것이 없다. */
const original = atom({ plugin: 'prompt-coach', key: 'original' } as const, '')
/** 그때 입력창에 넣은 다듬은 글. [되돌리기]는 입력창이 이것과 같을 때만 덮는다. */
const refined = atom({ plugin: 'prompt-coach', key: 'refined' } as const, '')

const NO_DONE = '완료 기준이 없어요. 끝난 걸 확인할 방법(테스트·빌드 등)을 넣어 보세요.'

type Outcome = { isDone: true; text: string; lacksDone: boolean } | { isDone: false; why: string }

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'coach', description: '초안을 목표·맥락·조건·완료 기준 순으로 다듬어 입력창에', argumentHint: '<초안> | template | undo' })
    return r
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    // 이 핸들러는 next 를 부르지 않아 아래 일반 command.run 훅이 오지 않는다. 같은 일을 여기서도 한다.
    await sent($, e)
    const arg = e.args.trim()
    if (arg === '') {
      const s = await read($, spent)
      return {
        text: `쓰는 법: /coach <초안> · /coach template · 입력창 위 [다듬기]·[되돌리기] · /coach undo\n이번 세션 ${s.calls}회, Haiku 입력 ${s.input.toLocaleString('en-US')} · 출력 ${s.output.toLocaleString('en-US')} 토큰`,
      }
    }
    // 명령을 보냈으니 입력창은 비어 있다. 그대로 채운다.
    if (arg === 'template') {
      const filled = await fillBox($, TEMPLATE)
      if (!filled.isFilled) return { text: `입력창에 넣지 못했어요 (${filled.refusal ?? '알 수 없음'})` }
      // 새 초안을 시작했으니 이전에 다듬은 원문은 되돌릴 대상이 아니다.
      if (await read($, original)) await forget($)
      return { text: '틀을 입력창에 넣었어요. 채운 뒤 [다듬기]를 누르거나 그대로 보내세요.' }
    }
    // 입력창이 비어 있어야 명령을 칠 수 있으므로 덮어쓸 것을 확인하지 않는다.
    if (arg === 'undo') {
      const before = await read($, original)
      if (!before) return { text: '되돌릴 원문이 없어요.' }
      const filled = await restore($, before)
      return { text: filled.isFilled ? '다듬기 전 원문을 입력창에 되돌렸어요.' : `입력창에 넣지 못했어요 (${filled.refusal ?? '알 수 없음'})` }
    }
    const r = await refine($, arg)
    if (!r.isDone) return { text: `/coach: ${r.why}` }
    const filled = await fillRefined($, arg, r.text)
    if (!filled.isFilled) return { text: `입력창에 넣지 못했어요 (${filled.refusal ?? '알 수 없음'})` }
    return { text: `다듬은 초안을 입력창에 넣었어요. 고치거나 그대로 보내세요. (/coach undo 로 원문)${r.lacksDone ? `\n${NO_DONE}` : ''}` }
  })

  // 사람이 Enter 로 보낸 명령은 입력창을 비우지만 prompt.submit 을 거치지 않는다. 플러그인이 부른 명령은 입력창을 그대로 둔다.
  on('command.run', async ($, e, next) => {
    await sent($, e)
    return next(e)
  })

  // 초안이 있는지만 따라간다. 바뀔 때만 써서 띠를 다시 그리게 한다.
  on('prompt.edit', async ($, e, next) => {
    const r = await next(e)
    const hasDraft = r.text.trim() !== ''
    if ((await read($, band)).hasDraft !== hasDraft) await update($, band, b => ({ ...b, hasDraft }))
    return r
  })

  // 보낸 뒤에는 되돌릴 원문이 의미가 없다.
  on('prompt.submit', async ($, e, next) => {
    if ((await read($, band)).hasDraft) await update($, band, b => ({ ...b, hasDraft: false }))
    if (await read($, original)) await forget($)
    return next(e)
  })

  // 다른 mod 와 Claude Code 가 그린 것은 그대로 두고 그 위에 붙인다.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    const b = await read($, band)
    const before = await read($, original)
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
          {!b.busy && before !== '' ? <Button key="coach-undo" label="되돌리기" onPress={() => undoBox($)} /> : null}
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
    const filled = await fillRefined($, draft, r.text)
    if (!filled.isFilled) $.ui.toast(`prompt-coach: 입력창에 넣지 못했어요 (${filled.refusal ?? '알 수 없음'})`)
    else if (r.lacksDone) $.ui.toast(`prompt-coach: ${NO_DONE}`)
  } finally {
    await update($, band, b => ({ ...b, busy: false }))
  }
}

/** 입력창이 다듬은 결과 그대로일 때만 원문으로 되돌린다. 그 뒤에 고친 글은 덮지 않는다. */
async function undoBox($: EngineInterface): Promise<void> {
  const before = await read($, original)
  if (!before) return
  if ((await $.prompt.read()).text !== (await read($, refined))) {
    $.ui.toast('prompt-coach: 다듬은 뒤 입력창이 바뀌어 되돌리지 않았어요.')
    return
  }
  const filled = await restore($, before)
  if (!filled.isFilled) $.ui.toast(`prompt-coach: 입력창에 넣지 못했어요 (${filled.refusal ?? '알 수 없음'})`)
}

/** 사람이 Enter 로 보낸 명령이면 입력창이 비었으니 띠를 끈다. */
async function sent($: EngineInterface, e: { origin: { kind: string } }): Promise<void> {
  if (e.origin.kind === 'composer' && (await read($, band)).hasDraft) await update($, band, b => ({ ...b, hasDraft: false }))
}

/** 입력창을 채운다. prompt.edit 는 사람이 칠 때만 오므로 띠는 직접 켠다. */
async function fillBox($: EngineInterface, text: string) {
  const filled = await $.prompt.fill({ text, mode: 'replace' })
  if (filled.isFilled) await update($, band, b => ({ ...b, hasDraft: true }))
  return filled
}

/** 다듬은 글을 입력창에 넣고, 넣었을 때만 되돌릴 원문을 남긴다. */
async function fillRefined($: EngineInterface, draft: string, text: string) {
  const filled = await fillBox($, text)
  if (filled.isFilled) {
    await update($, original, () => draft)
    await update($, refined, () => text)
  }
  return filled
}

/** 원문은 한 번만 되돌린다. */
async function restore($: EngineInterface, before: string) {
  const filled = await fillBox($, before)
  if (filled.isFilled) await forget($)
  return filled
}

async function forget($: EngineInterface): Promise<void> {
  await update($, original, () => '')
  await update($, refined, () => '')
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
  return { isDone: true, text, lacksDone: lacksDone(r.text) }
}
