// 보내기 전 초안을 다듬어 입력창에 다시 채운다. 먼저 빈 곳을 객관식으로 묻고, 답과 제안을 보태 다시 쓴다. 보내는 것은 사람이 한다.
// /coach <초안> 또는 입력창 위 [다듬기].
// 아이디어: yuk7392/prompt-coach 의 Refine (MIT), Tristen O'Brien 의 Prompt Upgrade. 코드는 새로 썼다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CoachBand, CoachEntry, CoachFlow, Spent } from '../types'
import { addedHead, type Answer, buildQuestions, buildRewrite, cells, MAX_TOKENS, parseQuestions, parseRewrite, passThrough, rule, TEMPLATE, tooShort } from './refine'

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
const history = atom({ plugin: 'prompt-coach', key: 'history' } as const, [] as CoachEntry[])
const pick = atom({ plugin: 'prompt-coach', key: 'pick' } as const, 0)
const tick = atom({ plugin: 'prompt-coach', key: 'tick' } as const, 0)

/** 변환 중 띠의 스피너: 프레임(cli-spinners dots), 주기, 색(질문 번호와 같은 노랑). */
const SPIN_FRAMES = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const SPIN_MS = 150
const SPIN_COLOR = 'yellow'
/** 변환 중에만 돈다. 틱 콜백은 겹쳐 돌 수 있어 원자 하나만 쓴다. */
let spinner: Timer | null = null

/** 자동 모드 설정. 모든 세션이 같은 값을 쓴다. */
const AUTO_KEY = 'auto-on'
/** 다듬기 기록. 모든 세션이 같은 목록을 쓴다. */
const HISTORY_KEY = 'history'
const MAX_HISTORY = 20
const PANE = 'prompt-coach'

/** 입력창이 비었을 때 띠의 버튼을 누르는 숫자. 선택지는 1~4. */
const SKIP_KEY = '0'
const NOW_KEY = '9'

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({ name: 'coach', description: '초안의 빈 곳을 묻고 다듬어 입력창에', argumentHint: '<초안> | view | template | undo | cancel | auto on|off' })
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
        text: `쓰는 법: /coach <초안> · /coach view · /coach template · 입력창 위 [다듬기]·[되돌리기] · /coach undo · /coach cancel · /coach auto on|off\n이번 세션 ${s.calls}회, Haiku 입력 ${s.input.toLocaleString('en-US')} · 출력 ${s.output.toLocaleString('en-US')} 토큰`,
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
      if (arg !== 'auto') await setAuto($, arg === 'auto on')
      return { text: (await isAuto($)) ? AUTO_ON : '자동 모드 꺼짐: [다듬기]·/coach 로만 다듬어요. (/coach auto on)' }
    }
    if (arg === 'view') {
      await loadHistory($)
      await update($, pick, () => 0)
      await $.ui.open({ id: PANE, title: 'prompt-coach', closeOnEscape: true })
      // 이 줄은 모델도 읽으므로 짧게 둔다
      return { text: '다듬기 상세를 옆 패널에 띄웠어요. (Esc로 닫기)' }
    }
    if (arg === 'cancel') return { text: (await cancel($)) ? '다듬기를 그만두고 초안을 입력창에 돌려놓았어요.' : '다듬는 중이 아니에요.' }
    const refusal = await begin($, arg)
    return { text: refusal ?? '입력창 위에 질문이 떠요. 숫자로 고르거나, 입력창에 직접 써서 Enter.' }
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
    if (!hasDraft) {
      // 다듬은 글을 지웠으면 보탠 것 줄도 내린다
      if ((await read($, flow)).stage === 'done') await setFlow($, { stage: 'idle' })
      // 다듬은 글·돌려놓은 초안을 지웠으면 다음 보내기는 다시 묻는다
      if (await read($, bypass)) await update($, bypass, () => false)
    }
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

  // 상세 패널: 단계 표시, 질문 전체, 고른 기록의 수치·보탠 것·원문과 다듬은 글, 기록 목록, 설정
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    // 패널 안쪽 폭 (좌우 여백 1칸씩)
    const cols = Math.max(24, (e.props as { bodyColumns?: number }).bodyColumns ?? 80) - 2
    const f = await read($, flow)
    const list = await read($, history)
    const chosen = Math.min(await read($, pick), Math.max(0, list.length - 1))
    const entry = list[chosen]
    const isOn = await read($, auto)
    const used = await read($, spent)

    // 한 줄 높이 Box 안에서 줄바꿈시켜 넘친 가로줄을 숨긴다 (truncate 는 끝에 … 를 붙인다)
    const ruled = (key: string, lead: JSX.Element, leadW: number) => (
      <Box key={key} height={1} overflow="hidden">
        <Text wrap="wrap">
          {lead}
          <Text dimColor>{'─'.repeat(Math.max(0, cols - leadW))}</Text>
        </Text>
      </Box>
    )
    const section = (key: string, title: string) => <Box key={key} marginTop={1}>{ruled(`${key}-r`, <Text bold dimColor>{`${title} `}</Text>, cells(title) + 1)}</Box>
    const TITLE = 'PROMPT COACH'

    // 단계: 초안 → 질문 → 다시 쓰기 → 검토. 끝난 것 초록 ✓, 지금 노랑 ●, 남은 것 흐린 ○
    const now = f.stage === 'asking' || f.stage === 'questions' ? 1 : f.stage === 'rewriting' ? 2 : 3
    const steps = ['초안', '질문', '다시 쓰기', '검토']
    const tracker = (
      <Box key="tracker" flexDirection="row" flexWrap="wrap">
        {steps.map((st, i) => (
          <Text key={`step-${i}`}>
            {i > 0 ? <Text color={i <= now ? 'green' : undefined} dimColor={i > now}>{' ── '}</Text> : null}
            {i < now ? <Text color="green">{`✓ ${st}`}</Text> : i === now ? <Text color="yellow" bold>{`● ${st}`}</Text> : <Text dimColor>{`○ ${st}`}</Text>}
          </Text>
        ))}
      </Box>
    )

    const card = (key: string, label: string, body: string, gold: boolean, width?: number) => (
      <Box key={key} flexDirection="column" borderStyle="round" borderColor={gold ? 'yellow' : 'gray'} paddingX={1} width={width} flexShrink={0}>
        <Text bold color={gold ? 'yellow' : undefined} dimColor={!gold}>{label}</Text>
        <Text>{body}</Text>
      </Box>
    )

    const flowPart = () => {
      if (f.stage === 'asking' || f.stage === 'rewriting') {
        return [card('draft', '초안', f.draft, false), <Text key="wait" color="cyan">{f.stage === 'asking' ? '질문을 만드는 중…' : '다시 쓰는 중…'}</Text>]
      }
      if (f.stage !== 'questions') return []
      const current = f.answers.length
      return [
        card('draft', '초안', f.draft, false),
        section('qs', '몇 가지만 물을게요'),
        ...f.questions.map((q, i) => {
          const given = f.answers[i]
          if (i < current) {
            return (
              <Box key={`q-${i}`} flexDirection="column">
                <Box flexDirection="row" columnGap={1}>
                  <Text backgroundColor="green" color="black" bold>{' ✓ '}</Text>
                  <Text>{q.q}</Text>
                </Box>
                <Box flexDirection="row" columnGap={2} paddingX={4}>
                  {given ? <Text color="green">{given}</Text> : <Text dimColor>건너뜀</Text>}
                  <Button key={`change-${i}`} label="바꾸기" plain dimColor onPress={() => void setFlow($, { ...f, answers: f.answers.slice(0, i) })} />
                </Box>
              </Box>
            )
          }
          if (i > current) {
            return (
              <Box key={`q-${i}`} flexDirection="row" columnGap={1}>
                <Text dimColor>{` ${i + 1} `}</Text>
                <Text dimColor>{q.q}</Text>
              </Box>
            )
          }
          return (
            <Box key={`q-${i}`} flexDirection="column">
              <Box flexDirection="row" columnGap={1}>
                <Text backgroundColor="yellow" color="black" bold>{` ${i + 1} `}</Text>
                <Text bold>{q.q}</Text>
              </Box>
              <Box flexDirection="row" flexWrap="wrap" columnGap={2} paddingX={4}>
                {q.options.map((o, k) => <Button key={`view-opt-${k}`} label={o} hotkey={String(k + 1)} plain onPress={() => void answer($, o)} />)}
                <Button key="view-skip" label="건너뛰기" hotkey={SKIP_KEY} plain dimColor onPress={() => void answer($, null)} />
              </Box>
            </Box>
          )
        }),
        <Box key="q-actions" flexDirection="row" columnGap={2} marginTop={1}>
          {/* 주 버튼: 노란 바탕에 어두운 굵은 글자 */}
          <Button key="view-now" hotkey={NOW_KEY} plain onPress={() => void rewriteNow($)}>
            <Text backgroundColor="yellow" color="black" bold>{' 나머지 건너뛰고 다듬기 '}</Text>
          </Button>
          <Button key="view-cancel" label="취소" plain dimColor onPress={() => void cancel($)} />
        </Box>,
        <Text key="q-hint" dimColor>{'입력창 Enter = 지금 질문의 답 · > 로 시작하면 새 요청'}</Text>,
      ]
    }

    const reviewPart = () => {
      if (!entry || f.stage !== 'idle' && f.stage !== 'done') return []
      const side = cols >= 70
      const half = Math.floor((cols - 1) / 2)
      return [
        <Box key="nums" flexDirection="row" columnGap={3} marginTop={1}>
          <Text dimColor>{`원문 ${words(entry.draft)}단어`}</Text>
          <Text bold>{`다듬은 글 ${words(entry.refined)}단어`}</Text>
          <Text color="green">{`보탠 것 ${entry.added.length}`}</Text>
        </Box>,
        <Box key="review-actions" flexDirection="row" columnGap={2}>
          <Button key="view-fill" label="입력창에 넣기" variant="primary" onPress={() => void fillFromHistory($, entry)} />
        </Box>,
        section('added', '보탠 것'),
        ...(entry.added.length === 0
          ? [<Text key="added-none" dimColor>없음 (순서만 다듬음)</Text>]
          : entry.added.map((a, k) => (
              <Text key={`added-${k}`}>
                <Text color={a.kind === 'answer' ? 'green' : 'yellow'}>{'+ '}</Text>
                {a.text}
                <Text dimColor>{a.kind === 'answer' ? '  답' : '  제안'}</Text>
              </Text>
            ))),
        <Box key="cards" flexDirection={side ? 'row' : 'column'} columnGap={1} marginTop={1}>
          {card('card-draft', '원문', entry.draft, false, side ? half : undefined)}
          {card('card-refined', '✦ 다듬은 글', entry.refined, true, side ? cols - half - 1 : undefined)}
        </Box>,
      ]
    }

    const historyPart = () =>
      list.length === 0
        ? []
        : [
            section('history', `기록 ${list.length}`),
            ...list.map((item, i) => (
              <Button key={`hist-${i}`} plain onPress={() => void update($, pick, () => i)}>
                <Text color={i === chosen ? 'yellow' : undefined}>{i === chosen ? '▸ ' : '  '}</Text>
                <Text dimColor={i !== chosen}>{clip(oneLine(item.draft), cols - 4)}</Text>
              </Button>
            )),
          ]

    return (
      <Box flexDirection="column" paddingX={1}>
        <Text bold>{TITLE}</Text>
        {ruled('title-rule', <Text color="yellow">{'━'.repeat(cells(TITLE))}</Text>, cells(TITLE))}
        {tracker}
        {/* 설정은 위에 둔다. 아래에 두면 기록이 길 때 패널 밖으로 밀려 보이지 않는다 */}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          <Text>{`자동 모드 ${isOn ? '켜짐' : '꺼짐'}`}</Text>
          <Button key="view-auto" label={isOn ? '끄기' : '켜기'} onPress={() => void setAuto($, !isOn)} />
          <Text dimColor>{`이번 세션 Haiku ${used.calls}회 · 입력 ${used.input.toLocaleString('en-US')} · 출력 ${used.output.toLocaleString('en-US')} 토큰`}</Text>
        </Box>
        {...flowPart()}
        {...reviewPart()}
        {f.stage === 'idle' && list.length === 0 ? <Text dimColor>아직 다듬은 기록이 없어요. 입력창 위 [다듬기]나 /coach &lt;초안&gt; 으로 시작하세요.</Text> : null}
        {...historyPart()}
      </Box>
    )
  })

  // 다른 mod 와 Claude Code 가 그린 것은 그대로 두고 그 아래(입력창 바로 위)에 붙인다.
  // 위에 붙이면 이 mod 가 바깥일 때 team-board 띠가 아래로 밀려 잘린다
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e)
    if (e.props.hasSurvey) return rest
    const f = await read($, flow)
    const b = await read($, band)
    const before = await read($, original)
    const width = e.props.bodyColumns
    const { Box, Text, Button } = $.ui.resolve(e)
    // 바로 위 대화 기록이나 다른 mod 띠와 나눈다. 빈 줄 하나와 굵은 회색 줄로 위 메시지와 띄운다 (줄이 모자라면 빈 줄은 뺀다). 오른쪽 끝은 지금 단계
    const isOn = await read($, auto)
    // spin 이 있으면 상태 앞에 노랑 스피너를 둔다
    const head = (status = '', spin = '') => {
      const tail = spin ? `${spin} ${status}` : status || (isOn ? '자동' : '')
      const line = rule(width, tail)
      return (
        <Box marginTop={e.props.maxRows >= 3 ? 1 : 0}>
          {spin ? (
            <Text color="gray" wrap="truncate-end">
              {line.slice(0, line.length - tail.length)}
              <Text color={SPIN_COLOR}>{spin}</Text>
              {` ${status}`}
            </Text>
          ) : (
            <Text color="gray" wrap="truncate-end">{line}</Text>
          )}
        </Box>
      )
    }
    const cancelButton = <Button key="coach-cancel" label="취소" plain dimColor onPress={() => void cancel($)} />
    const undoButton = before !== '' ? <Button key="coach-undo" label="되돌리기" onPress={() => void undoBox($)} /> : null

    if (f.stage === 'asking' || f.stage === 'rewriting') {
      const n = await read($, tick)
      const secs = Math.floor(((await $.clock.now()) - f.since) / 1000)
      return (
        <Box flexDirection="column">
          {rest}
          {head(`${f.stage === 'asking' ? '질문 만드는 중' : '다듬는 중'} ${secs}초`, SPIN_FRAMES[n % SPIN_FRAMES.length])}
          <Box flexDirection="row" columnGap={2} paddingX={1}>
            <Text dimColor wrap="truncate-end">{`초안  ${oneLine(f.draft)}`}</Text>
            {cancelButton}
          </Box>
        </Box>
      )
    }

    if (f.stage === 'questions') {
      const i = f.answers.length
      const q = f.questions[i]
      if (!q) return rest
      // 띠 자리가 다 그릴 줄(빈 줄·머리줄·초안·질문·선택지·안내 = 6)보다 적으면 질문과 선택지만 그린다. 넘치면 아래가 가려져 안 보이는 선택지를 숫자로 고르게 된다
      const tight = e.props.maxRows < 6
      return (
        <Box flexDirection="column">
          {rest}
          {tight ? null : head(`질문 ${i + 1}/${f.questions.length}`)}
          {/* 질문하는 동안 입력창은 비어 있다. 무엇을 다듬는지 한 줄로 보인다. 좁으면 높이를 아끼려고 이 줄과 직접 쓰기 안내를 뺀다 */}
          {width >= 60 && !tight ? <Box paddingX={1}><Text dimColor wrap="truncate-end">{`초안  ${oneLine(f.draft)}`}</Text></Box> : null}
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
          {width >= 60 && !tight ? <Box paddingX={1}><Text dimColor wrap="truncate-end">입력창 Enter = 이 질문의 답 · &gt; 로 시작하면 새 요청</Text></Box> : null}
        </Box>
      )
    }

    if (f.stage === 'done') {
      return (
        <Box flexDirection="column">
          {rest}
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
        </Box>
      )
    }

    // 받은 줄이 없으면(위 mod 가 다 씀) 그리지 않는다. 그려서 넘치면 엔진이 "↓ n more" 에 한 줄을 더 써 위 띠까지 가려진다 (T54)
    if (e.props.isWorking || !b.hasDraft || e.props.maxRows < 1) return rest
    // 쉬는 동안은 한 줄만 쓴다. 머리줄·빈 줄을 빼 다른 mod 띠에 줄을 남긴다
    return (
      <Box flexDirection="column">
        {rest}
        <Box flexDirection="row" columnGap={1} paddingX={1} height={1} overflow="hidden">
          <Button key="coach-refine" label="다듬기" onPress={() => void refineBox($)} />
          {undoButton}
          <Text dimColor wrap="truncate-end">{`빈 곳을 몇 개 묻고 다듬어요 (Haiku)${isOn ? ' · 자동' : ''}`}</Text>
        </Box>
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
  // 변환 중에만 스피너를 돌린다. 질문 만들기 → 다듬기는 이어서 돈다
  const busy = next.stage === 'asking' || next.stage === 'rewriting'
  if (busy && !spinner) spinner = $.clock.every(SPIN_MS, () => void update($, tick, n => n + 1).catch(unloaded))
  if (!busy && spinner) {
    spinner.cancel()
    spinner = null
  }
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

async function setAuto($: EngineInterface, on: boolean): Promise<void> {
  await $.store.set(AUTO_KEY, on)
  await update($, auto, () => on)
}

async function loadHistory($: EngineInterface): Promise<void> {
  const stored = await $.store.get(HISTORY_KEY)
  await update($, history, () => (Array.isArray(stored) ? (stored as CoachEntry[]) : []))
}

/** 다듬기 한 번을 기록 맨 앞에 둔다. 다른 세션이 쓴 것도 잃지 않게 저장소에서 다시 읽어 붙인다. */
async function remember($: EngineInterface, item: CoachEntry): Promise<void> {
  const stored = await $.store.get(HISTORY_KEY)
  const next = [item, ...(Array.isArray(stored) ? (stored as CoachEntry[]) : [])].slice(0, MAX_HISTORY)
  await $.store.set(HISTORY_KEY, next)
  await update($, history, () => next)
  await update($, pick, () => 0)
}

/** 기록의 다듬은 글을 입력창에 넣는다. 입력창에 글이 있으면 덮지 않는다. */
async function fillFromHistory($: EngineInterface, item: CoachEntry): Promise<void> {
  if ((await $.prompt.read()).text.trim() !== '') {
    $.ui.toast('prompt-coach: 입력창에 글이 있어 넣지 않았어요. 비운 뒤 다시 누르세요.')
    return
  }
  const filled = await fillRefined($, item.draft, item.refined)
  if (!filled.isFilled) $.ui.toast(`prompt-coach: 입력창에 넣지 못했어요 (${filled.refusal ?? '알 수 없음'})`)
  // 넣은 글을 보내면 자동 모드가 다시 묻지 않는다
  else await update($, bypass, () => true)
}

function words(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** 칸 수에 맞춰 자른다. 넘치면 끝에 … */
function clip(text: string, width: number): string {
  if (cells(text) <= width) return text
  let out = ''
  for (const ch of text) {
    if (cells(out + ch) > width - 1) break
    out += ch
  }
  return out + '…'
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
  await setFlow($, { stage: 'asking', draft, since: await $.clock.now() })
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
  await setFlow($, { stage: 'rewriting', draft, since: await $.clock.now() })
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
  await remember($, { at: await $.clock.now(), draft, refined: out.text, added: out.added })
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
