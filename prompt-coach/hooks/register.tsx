// 보내기 전 초안을 다듬어 입력창에 다시 채운다. 먼저 빈 곳을 객관식으로 묻고, 답과 제안을 보태 다시 쓴다. 보내는 것은 사람이 한다.
// /coach <초안> 또는 입력창 위 [다듬기].
// 아이디어: yuk7392/prompt-coach 의 Refine (MIT), Tristen O'Brien 의 Prompt Upgrade. 코드는 새로 썼다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { CoachBand, CoachFlow, Spent } from '../types'
import { addedHead, type Answer, buildQuestions, buildRewrite, MAX_TOKENS, parseQuestions, parseRewrite, passThrough, rule, TEMPLATE, tooShort } from './refine'

// $.state 에 두어 핫 리로드에도 유지된다.
const band = atom({ plugin: 'prompt-coach', key: 'band' } as const, { hasDraft: false } as CoachBand)
const spent = atom({ plugin: 'prompt-coach', key: 'spent' } as const, { calls: 0, input: 0, output: 0 } as Spent)
/** 마지막으로 다듬기 전의 원문. /coach undo 와 [되돌리기]가 되돌린다. 비어 있으면 되돌릴 것이 없다. */
const original = atom({ plugin: 'prompt-coach', key: 'original' } as const, '')
/** 그때 입력창에 넣은 다듬은 글. [되돌리기]는 입력창이 이것과 같을 때만 덮는다. */
const refined = atom({ plugin: 'prompt-coach', key: 'refined' } as const, '')
const flow = atom({ plugin: 'prompt-coach', key: 'flow' } as const, { stage: 'idle' } as CoachFlow)
const auto = atom({ plugin: 'prompt-coach', key: 'auto' } as const, false)
const bypass = atom({ plugin: 'prompt-coach', key: 'bypass' } as const, false)
// team-board 가 이 이름으로 읽는다. 바꾸면 team-board 도 바꾼다
const pending = atom({ plugin: 'prompt-coach', key: 'pending' } as const, null as string | null)
const claudeAsking = atom({ plugin: 'prompt-coach', key: 'claudeAsking' } as const, false)

/** 자동 모드 설정. 모든 세션이 같은 값을 쓴다. */
const AUTO_KEY = 'auto-on'

/** 입력창이 비었을 때 띠의 버튼을 누르는 숫자. 선택지는 1~4. */
const SKIP_KEY = '0'
const NOW_KEY = '9'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'coach', description: '초안의 빈 곳을 묻고 다듬어 입력창에', argumentHint: '<초안> | template | undo | cancel | auto on|off' })
    await isAuto($)
    // 모듈을 다시 불러 모델 호출이 끊겼으면 초안을 돌려준다. 질문 단계는 답을 기다리는 중이라 그대로 둔다
    const f = await read($, flow)
    if (f.stage === 'asking' || f.stage === 'rewriting') await fail($, f.draft, '다시 불러와 멈췄어요.')
    return r
  })

  on('command.run', { command: 'coach' }, async ($, e) => {
    // 이 핸들러는 next 를 부르지 않아 아래 일반 command.run 훅이 오지 않는다. 같은 일을 여기서도 한다.
    await sent($, e)
    const arg = e.args.trim()
    if (arg === '') {
      const s = await read($, spent)
      return {
        text: `쓰는 법: /coach <초안> · /coach template · 입력창 위 [다듬기]·[되돌리기] · /coach undo · /coach cancel\n이번 세션 ${s.calls}회, Haiku 입력 ${s.input.toLocaleString('en-US')} · 출력 ${s.output.toLocaleString('en-US')} 토큰`,
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
    if (arg === 'auto' || arg === 'auto on' || arg === 'auto off') {
      if (arg !== 'auto') {
        await $.store.set(AUTO_KEY, arg === 'auto on')
        await update($, auto, () => arg === 'auto on')
      }
      return { text: (await isAuto($)) ? AUTO_ON : '자동 모드 꺼짐: [다듬기]·/coach 로만 다듬어요. (/coach auto on)' }
    }
    if (arg === 'cancel') return { text: (await cancel($)) ? '다듬기를 그만두고 초안을 입력창에 돌려놓았어요.' : '다듬는 중이 아니에요.' }
    const refusal = await begin($, arg)
    return { text: refusal ? `/coach: ${refusal}` : '입력창 위에 질문이 떠요. 숫자로 고르거나, 입력창에 직접 써서 Enter.' }
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
    // 다듬은 글을 지웠으면 보탠 것 줄도 내린다
    if (!hasDraft && (await read($, flow)).stage === 'done') await setFlow($, { stage: 'idle' })
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    // 질문하는 동안 입력창에 쓴 글은 지금 질문의 직접 답이다. 보내지 않는다.
    const f = await read($, flow)
    // 질문 중 '>' 로 시작한 글은 새 요청이다. 다듬기를 그만두고 보낸 뒤 초안을 입력창에 돌려놓는다
    if (f.stage === 'questions' && e.origin.kind === 'composer' && !e.command && e.text.startsWith('>')) {
      await setFlow($, { stage: 'idle' })
      const r = await next({ ...e, text: e.text.slice(1).trimStart() })
      if (r.drop === undefined && (await $.prompt.read()).text.trim() === '') await fillBox($, f.draft)
      return r
    }
    if (f.stage === 'questions' && e.origin.kind === 'composer' && !e.command && e.text.trim() !== '') {
      // 막힌 글은 엔진이 입력창에 다시 넣는다. 그 뒤에 비우고 답을 넘긴다. 여기서 답하면 마지막 질문의 다듬은 글이
      // 되돌아온 글에 덮여 지워지고, 바깥 hook(team-board)이 drop 을 보고 되돌릴 때 바뀐 질문도 옛 것으로 돌아간다
      const typed = e.text.trim()
      void $.clock.sleep(300).then(async () => {
        await clearBox($)
        await answer($, typed)
      }).catch(unloaded)
      return { drop: 'prompt-coach: 질문의 답으로 받았어요' }
    }
    let text = e.text
    if (e.origin.kind === 'composer') {
      const skip = await read($, bypass)
      if (skip) await update($, bypass, () => false)
      // 자동 모드: 사람이 친 프롬프트를 보내기 전에 먼저 묻는다. '>' 로 시작하면 벗겨서 그대로 보낸다
      if (!e.command && (await isAuto($))) {
        if (text.startsWith('>')) text = text.slice(1).trimStart()
        else if (!skip && !passThrough(e) && !(await read($, claudeAsking)) && (await begin($, text)) === null) {
          void $.clock.sleep(300).then(() => clearBox($)).catch(unloaded)
          return { drop: 'prompt-coach: 입력창 위 질문에 답하면 다듬어요 (그대로 보내려면 맨 앞에 >)' }
        }
      }
    }
    // 보낸 뒤에는 되돌릴 원문과 보탠 것 줄이 의미가 없다.
    if ((await read($, band)).hasDraft) await update($, band, b => ({ ...b, hasDraft: false }))
    if (await read($, original)) await forget($)
    if (f.stage === 'done') await setFlow($, { stage: 'idle' })
    return next(text === e.text ? e : { ...e, text })
  })

  // team-board 가 이 세션을 Claude 의 질문 대기로 보면 기억한다. 사람이 보내는 순간 team-board 가 먼저 작업 중으로 바꾸므로
  // 작업 중은 무시하고 대기·다음 턴에서만 끈다. prompt-coach 자신의 질문(결정 필요로 보임)은 Claude 의 질문이 아니다
  on('state.set', { plugin: 'team-board', key: 'me' }, async ($, e, next) => {
    const r = await next(e)
    const me = e.value as { state?: unknown; question?: unknown } | null
    if ('value' in r && r.value?.isSet && me) {
      if (me.state === 'asking' && typeof me.question === 'string' && !me.question.startsWith('prompt-coach: ')) await setClaudeAsking($, true)
      else if (me.state === 'idle') await setClaudeAsking($, false)
    }
    return r
  }).catch(($, e, next) => next(e)) // 읽기만 하므로 실패해도 team-board 의 기록은 그대로 선다

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) await setClaudeAsking($, false)
    return next(e)
  })

  // 다른 mod 와 Claude Code 가 그린 것은 그대로 두고 그 위에 붙인다.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const f = await read($, flow)
    const b = await read($, band)
    const before = await read($, original)
    const width = e.props.bodyColumns
    const { Box, Text, Button } = $.ui.resolve(e)
    // 바로 위 대화 기록과 나눈다. 흐리게 그려 입력창의 가로줄과 다투지 않게 한다. 오른쪽 끝은 지금 단계
    const isOn = await read($, auto)
    const head = (status = '') => <Text dimColor wrap="truncate-end">{rule(width, status || (isOn ? '자동' : ''))}</Text>
    const cancelButton = <Button key="coach-cancel" label="취소" plain dimColor onPress={() => void cancel($)} />
    const undoButton = before !== '' ? <Button key="coach-undo" label="되돌리기" onPress={() => void undoBox($)} /> : null

    if (f.stage === 'asking' || f.stage === 'rewriting') {
      return (
        <Box flexDirection="column">
          {head(f.stage === 'asking' ? '질문 만드는 중' : '다듬는 중')}
          <Box flexDirection="row" columnGap={2} paddingX={1}>
            <Text dimColor wrap="truncate-end">{`초안  ${oneLine(f.draft)}`}</Text>
            {cancelButton}
          </Box>
          {rest}
        </Box>
      )
    }

    if (f.stage === 'questions') {
      const i = f.answers.length
      const q = f.questions[i]
      if (!q) return rest
      return (
        <Box flexDirection="column">
          {head(`질문 ${i + 1}/${f.questions.length}`)}
          {/* 질문하는 동안 입력창은 비어 있다. 무엇을 다듬는지 한 줄로 보인다. 좁으면 높이를 아끼려고 이 줄과 직접 쓰기 안내를 뺀다 */}
          {width >= 60 ? <Box paddingX={1}><Text dimColor wrap="truncate-end">{`초안  ${oneLine(f.draft)}`}</Text></Box> : null}
          <Box flexDirection="row" columnGap={1} paddingX={1}>
            <Text backgroundColor="yellow" color="black" bold>{` ${i + 1} `}</Text>
            <Text bold>{q.q}</Text>
          </Box>
          <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingX={1}>
            {q.options.map((o, k) => <Button key={`coach-opt-${k}`} label={o} hotkey={String(k + 1)} plain onPress={() => void answer($, o)} />)}
            <Button key="coach-skip" label="건너뛰기" hotkey={SKIP_KEY} plain dimColor onPress={() => void answer($, null)} />
            <Button key="coach-now" label="바로 다듬기" hotkey={NOW_KEY} plain onPress={() => void rewriteNow($)} />
            {cancelButton}
          </Box>
          {width >= 60 ? <Box paddingX={1}><Text dimColor wrap="truncate-end">입력창 Enter = 이 질문의 답 · &gt; 로 시작하면 새 요청</Text></Box> : null}
          {rest}
        </Box>
      )
    }

    if (f.stage === 'done') {
      return (
        <Box flexDirection="column">
          {head('입력창에 넣음')}
          <Box paddingX={1}>
            <Text wrap="truncate-end">
              <Text bold>{addedHead(f.added)}</Text>
              {f.added.map((a, k) => <Text key={`added-${k}`} color={a.kind === 'answer' ? 'green' : 'yellow'}>{`  + ${a.text}`}</Text>)}
            </Text>
          </Box>
          <Box flexDirection="row" columnGap={1} paddingX={1}>
            {undoButton}
            <Text dimColor wrap="truncate-end">초록 답 · 노랑 제안 · 고치거나 그대로 보내세요</Text>
          </Box>
          {rest}
        </Box>
      )
    }

    if (e.props.isWorking || !b.hasDraft) return rest
    return (
      <Box flexDirection="column">
        {head()}
        <Box flexDirection="row" columnGap={1} paddingX={1}>
          <Button key="coach-refine" label="다듬기" onPress={() => void refineBox($)} />
          {undoButton}
          <Text dimColor wrap="truncate-end">빈 곳을 몇 개 묻고 다듬어요 (Haiku)</Text>
        </Box>
        {rest}
      </Box>
    )
  })
}

/** 모듈이 내려가 끊긴 뒤의 reject 만 삼킨다. 다른 오류는 그대로 드러낸다. */
function unloaded(err: unknown): void {
  if (!(err instanceof Error && err.message.includes('unloaded'))) throw err
}

/** 흐름을 바꾸고, 답을 기다리는 질문을 team-board 가 읽는 곳에 맞춘다. 입력창을 채우기 전에 비워야 보낸 글이 그 질문의 답으로 기록되지 않는다. */
async function setFlow($: EngineInterface, next: CoachFlow): Promise<void> {
  await update($, flow, () => next)
  const q = next.stage === 'questions' ? next.questions[next.answers.length]?.q : undefined
  const waiting = q === undefined ? null : `prompt-coach: ${q}`
  if ((await read($, pending)) !== waiting) await update($, pending, () => waiting)
  // 다듬은 글을 넣었거나 초안을 돌려놓은 뒤의 첫 보내기는 다시 묻지 않는다
  if (next.stage === 'done') await update($, bypass, () => true)
}

async function setClaudeAsking($: EngineInterface, on: boolean): Promise<void> {
  if ((await read($, claudeAsking)) !== on) await update($, claudeAsking, () => on)
}

const AUTO_ON = '자동 모드 켜짐: 보낼 때 먼저 빈 곳을 물어요. 그대로 보내려면 맨 앞에 > (모든 세션, /coach auto off)'

/** 자동 모드인지 설정에서 읽고 띠 표시용 사본을 맞춘다. 저장소를 못 읽으면 꺼진 것으로 본다(보내기를 막지 않게). */
async function isAuto($: EngineInterface): Promise<boolean> {
  const on = (await $.store.get(AUTO_KEY).catch(() => undefined)) === true
  if ((await read($, auto)) !== on) await update($, auto, () => on)
  return on
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** 입력창의 지금 초안으로 시작한다. 짧으면 이유를 알린다. */
async function refineBox($: EngineInterface): Promise<void> {
  const refusal = await begin($, (await $.prompt.read()).text)
  if (refusal) $.ui.toast(`prompt-coach: ${refusal}`)
}

/** 질문을 만들기 시작한다. 숫자 키로 답하도록 입력창을 비우고 초안은 흐름에 둔다. 시작하지 못하면 이유. */
async function begin($: EngineInterface, draft: string): Promise<string | null> {
  if (tooShort(draft)) return '초안이 너무 짧아요 (공백 빼고 12자 이상).'
  const stage = (await read($, flow)).stage
  if (stage !== 'idle' && stage !== 'done') return '이미 다듬는 중이에요. 띠에서 끝내거나 /coach cancel 하세요.'
  await setFlow($, { stage: 'asking', draft })
  await clearBox($)
  // 모듈을 내리면(다시 불러오기·종료) 기다리던 호출이 reject 된다. 다시 불러온 쪽의 session.start 가 초안을 돌려준다
  void ask($, draft).catch(unloaded)
  return null
}

async function ask($: EngineInterface, draft: string): Promise<void> {
  const r = await complete($, buildQuestions(draft))
  if (!(await still($, 'asking', draft))) return
  if (!r.isDone) return fail($, draft, r.why)
  const questions = parseQuestions(r.text)
  if (questions === null) return fail($, draft, '질문을 만들지 못했어요.')
  if (questions.length === 0) return rewrite($, draft, [])
  await setFlow($, { stage: 'questions', draft, questions, answers: [] })
}

/** 지금 질문에 답한다(null 은 건너뛰기). 마지막 질문이면 다시 쓴다. */
async function answer($: EngineInterface, value: string | null): Promise<void> {
  const f = await read($, flow)
  if (f.stage !== 'questions') return
  const answers = [...f.answers, value]
  if (answers.length < f.questions.length) {
    await setFlow($, { ...f, answers })
    return
  }
  await rewrite($, f.draft, given(f.questions, answers))
}

/** 남은 질문을 건너뛰고 지금까지의 답으로 다시 쓴다. */
async function rewriteNow($: EngineInterface): Promise<void> {
  const f = await read($, flow)
  if (f.stage === 'questions') await rewrite($, f.draft, given(f.questions, f.answers))
}

function given(questions: readonly { q: string }[], answers: readonly (string | null)[]): Answer[] {
  return questions.flatMap((q, i) => (answers[i] ? [{ q: q.q, a: answers[i]! }] : []))
}

async function rewrite($: EngineInterface, draft: string, answers: readonly Answer[]): Promise<void> {
  await setFlow($, { stage: 'rewriting', draft })
  const r = await complete($, buildRewrite(draft, answers))
  if (!(await still($, 'rewriting', draft))) return
  if (!r.isDone) return fail($, draft, r.why)
  const out = parseRewrite(r.text)
  if (out === null) return fail($, draft, '다듬지 못했어요. 모델이 초안 대신 말로 답했어요.')
  // 그사이 입력창에 새 글을 썼으면 덮지 않는다. 원문은 /coach undo 로 찾을 수 있게 둔다
  if ((await $.prompt.read()).text.trim() !== '') {
    await update($, original, () => draft)
    await update($, refined, () => '')
    await setFlow($, { stage: 'idle' })
    $.ui.toast('prompt-coach: 입력창에 새 글이 있어 덮지 않았어요. 원문은 /coach undo')
    return
  }
  const filled = await fillRefined($, draft, out.text)
  if (!filled.isFilled) return fail($, draft, `입력창에 넣지 못했어요 (${filled.refusal ?? '알 수 없음'}).`)
  await setFlow($, { stage: 'done', added: out.added })
}

/** 기다리던 단계가 그대로인지. 그사이 취소했거나 다른 초안으로 다시 시작했으면 결과를 버린다. */
async function still($: EngineInterface, stage: 'asking' | 'rewriting', draft: string): Promise<boolean> {
  const f = await read($, flow)
  return f.stage === stage && f.draft === draft
}

/** 흐름을 접고 초안을 입력창에 돌려놓는다. 입력창에 새 글이 있으면 덮지 않는다. */
async function fail($: EngineInterface, draft: string, why: string): Promise<void> {
  await setFlow($, { stage: 'idle' })
  await update($, bypass, () => true)
  const back = (await $.prompt.read()).text.trim() === '' ? (await fillBox($, draft)).isFilled : false
  $.ui.toast(`prompt-coach: ${why}${back ? ' 초안은 입력창에 그대로예요.' : ''}`)
}

/** 다듬기를 그만둔다. 다듬는 중이 아니었으면 false. */
async function cancel($: EngineInterface): Promise<boolean> {
  const f = await read($, flow)
  if (f.stage === 'idle' || f.stage === 'done') return false
  await setFlow($, { stage: 'idle' })
  await update($, bypass, () => true)
  if ((await $.prompt.read()).text.trim() === '') await fillBox($, f.draft)
  return true
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
  else await setFlow($, { stage: 'idle' })
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

async function clearBox($: EngineInterface): Promise<void> {
  if ((await $.prompt.read()).text === '') return
  const filled = await $.prompt.fill({ text: '', mode: 'replace' })
  if (filled.isFilled) await update($, band, b => ({ ...b, hasDraft: false }))
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

/** Haiku 한 번. 사용량을 세고, 답한 글이나 실패 이유를 돌려준다. */
async function complete($: EngineInterface, req: { system: string; prompt: string }): Promise<{ isDone: true; text: string } | { isDone: false; why: string }> {
  let r
  try {
    r = await $.model.complete({ model: 'haiku', system: req.system, prompt: req.prompt, maxTokens: MAX_TOKENS, timeoutMs: 30_000 })
  } catch (err) {
    // 엔진이 보내기를 거부한 요청(막힌 모델 등)은 reject 된다
    return { isDone: false, why: `모델 호출 실패 (${err instanceof Error ? err.message : String(err)})` }
  }
  await update($, spent, s => ({ calls: s.calls + 1, input: s.input + r.usage.input_tokens, output: s.output + r.usage.output_tokens }))
  if (!r.isAnswered) return { isDone: false, why: `모델 호출 실패 (${r.reason})` }
  return { isDone: true, text: r.text }
}
