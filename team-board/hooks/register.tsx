import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Beat, Explain } from '../types'
import {
  EVENT_MARK,
  ago,
  applyTaskTool,
  askUserText,
  basename,
  decisionsFromAnswers,
  describeTool,
  emptyBeat,
  event,
  explainPrompt,
  findByName,
  isStale,
  label,
  looksLikeQuestion,
  MAX_DECISIONS,
  MAX_TIMELINE,
  normalize,
  oneLine,
  progress,
  pushCapped,
  questionSummary,
  questionText,
  repoKey,
  dedupeNames,
  lastCustomTitle,
  projectDirName,
  routeLine,
  stripMarkdown,
  visible,
} from './board'
import { bar, contextTone, paletteOf } from './palette'
import { cells as widthOf, flowArt, parseExplain } from './diagram'
import { hex, ICONS, sprite } from './pixel'

const PANE = 'team-board'
// 결정을 묻는 줄은 강조한다
const ASKING_LINE = /정해\s*주|결정해\s*주|골라\s*주|선택해\s*주|어느\s*쪽|할까요\s*\?|하시겠습니까/
const TICK_MS = 3_000
const HEARTBEAT_MS = 60_000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite'])

const beats = atom({ plugin: 'team-board', key: 'beats' } as const, [] as Beat[])
const explain = atom({ plugin: 'team-board', key: 'explain' } as const, null as Explain | null)
const pending = atom({ plugin: 'team-board', key: 'pending' } as const, null as string | null)
const focus = atom({ plugin: 'team-board', key: 'focus' } as const, null as string | null)
const me = atom({ plugin: 'team-board', key: 'me' } as const, null as Beat | null)
const collapsed = atom({ plugin: 'team-board', key: 'collapsed' } as const, [] as string[])
const bandOff = atom({ plugin: 'team-board', key: 'bandOff' } as const, false)
const bandMode = atom({ plugin: 'team-board', key: 'bandMode' } as const, 'hud' as 'hud' | 'line')
const BAND_KEY = 'band-off'
const BAND_MODE_KEY = 'band-mode'
/** 세션별로 정한 표시 이름: 다시 켜도(claude --continue) 유지 */
const nameKey = (sessionId: string) => `name:${sessionId}`
const SOUND_KEY = 'sound-off'
/** 결정을 기다린 지 이만큼 지나도 그대로면 소리로 알린다 (바로 답하면 조용). */
const ALERT_AFTER_MS = 20_000

// 이 세션 자신의 상태와 파일 위치. 세션마다 하나.
const self = {
  dir: '',
  beat: null as Beat | null,
  lastWrite: 0,
  dirty: false,
  busy: false,
  interactive: false,
  sessionId: '',
  /** 이 세션의 대화 기록 파일 (세션 이름을 읽는 곳) */
  transcript: '',
  /** 지금 결정을 기다리기 시작한 시각, 이미 알린 질문 */
  askingSince: 0,
  alertedFor: '',
}

async function save($: EngineInterface, patch: Partial<Beat>, force = false): Promise<void> {
  if (!self.beat || !self.dir) return
  const now = await $.clock.now()
  const stateChanged = patch.state !== undefined && patch.state !== self.beat.state
  if (stateChanged && patch.state === 'asking') self.askingSince = now
  Object.assign(self.beat, patch)
  // 도구 호출이 몰릴 때는 1.5초에 한 번만 쓰고, 미룬 내용은 다음 틱에 쓴다.
  if (!force && !stateChanged && now - self.lastWrite < 1_500) {
    self.dirty = true
    return
  }
  self.beat.updatedAt = now
  self.lastWrite = now
  self.dirty = false
  const snapshot: Beat = { ...self.beat }
  await update($, me, () => snapshot)
  await $.fs.write(`${self.dir}/${self.beat.id}.json`, JSON.stringify(snapshot))
}

async function note($: EngineInterface, kind: Parameters<typeof event>[1], text: string, patch: Partial<Beat> = {}, force = false) {
  if (!self.beat) return
  const at = await $.clock.now()
  await save($, { ...patch, timeline: pushCapped(self.beat.timeline, event(at, kind, text), MAX_TIMELINE) }, force)
}

async function scan($: EngineInterface): Promise<void> {
  if (!self.dir) return
  const entries = await $.fs.list(self.dir).catch(() => [])
  const found: Beat[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    try {
      found.push(normalize(JSON.parse(await $.fs.read(`${self.dir}/${entry.name}`))))
    } catch {
      // 쓰는 도중이거나 깨진 파일은 다음 틱에 다시 읽는다.
    }
  }
  await update($, beats, () => dedupeNames(found))
}

async function runExplain($: EngineInterface): Promise<void> {
  const id = await read($, pending)
  if (!id || self.busy) return
  await update($, pending, () => null)
  const target = (await read($, beats)).find(b => b.id === id)
  if (!target?.question) return

  self.busy = true
  try {
    await update($, explain, (): Explain => ({ id, question: target.question, status: 'loading', text: '', data: null }))
    await update($, collapsed, list => list.filter(x => x !== id))
    const r = await $.model.complete({ model: 'haiku', prompt: explainPrompt(target), maxTokens: 3000, timeoutMs: 120_000 })
    await update($, explain, (): Explain =>
      r.isAnswered
        ? // JSON 이면 그림으로, 아니면 글 그대로 보여준다.
          { id, question: target.question, status: 'done', text: stripMarkdown(r.text).trim(), data: parseExplain(r.text) }
        : { id, question: target.question, status: 'error', text: `설명을 만들지 못했어요 (${r.reason})`, data: null },
    )
  } finally {
    self.busy = false
  }
}

/** claude --name, /rename 으로 정한 세션 이름. 대화 기록 파일의 마지막 customTitle. */
async function sessionTitle($: EngineInterface): Promise<string> {
  if (!self.transcript) return ''
  const grep = await $.process
    .run(['grep', '-o', '"customTitle":"[^"]*"', self.transcript], { timeoutMs: 3000 })
    .catch(() => null)
  return grep ? lastCustomTitle(grep.stdout) : ''
}

/**
 * 기본 표시 이름: 직접 정한 이름(/board name) > 세션 이름(claude --name, /rename) > 워크트리 브랜치 > 폴더 이름.
 */
async function defaultName($: EngineInterface, cwd: string, repoRoot: string | null): Promise<string> {
  const pinned = await $.store.get(nameKey(self.sessionId))
  if (typeof pinned === 'string' && pinned) return pinned
  const title = await sessionTitle($)
  if (title) return title
  if (repoRoot && repoRoot !== cwd) {
    const br = await $.process.run(['git', '-C', cwd, 'branch', '--show-current'], { timeoutMs: 3000 }).catch(() => null)
    const branch = br?.stdout.trim() ?? ''
    if (branch) return branch.split('/').pop()!.slice(0, 24)
  }
  return basename(cwd)
}

/** 이 세션이 결정을 기다린 지 오래면 한 번 알린다. 세션마다 자기 것만 알리므로 탭이 여러 개여도 한 번만 들린다. */
async function maybeAlert($: EngineInterface): Promise<void> {
  const b = self.beat
  if (!b || !self.interactive || b.state !== 'asking' || !b.question) return
  if (b.question === self.alertedFor || self.askingSince === 0) return
  if ((await $.clock.now()) - self.askingSince < ALERT_AFTER_MS) return
  self.alertedFor = b.question
  if ((await $.store.get(SOUND_KEY)) === true) return
  await announce($, `${b.name} 세션이 결정을 기다립니다`)
}

async function announce($: EngineInterface, text: string): Promise<void> {
  await $.audio.play({ asset: 'sounds/chime.wav' }).catch(() => undefined)
  // 한국어 목소리(Yuna)가 없으면 기본 목소리로
  await $.audio
    .speak(text, { voice: 'Yuna' })
    .catch(() => $.audio.speak(text))
    .catch(() => undefined)
}

export const register: Register = (on, options) => {
  const pal = paletteOf(options.palette)

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    self.interactive = e.isInteractive === true
    const cwd = await $.session.cwd()
    const repo = await $.session.repo()
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? cwd
    self.dir = `${home}/.claude/team-board/${repoKey(repo?.root ?? cwd)}`
    // 세션 id 가 같은 프로세스가 둘일 수 있어(재개, 상위 세션이 띄운 세션) 프로세스마다 꼬리표를 붙인다.
    // 모듈이 다시 로드된 경우(플러그인 갱신, 엔진 작업자 재시작)엔 같은 세션 기록을 이어 쓴다.
    self.sessionId = await $.session.id()
    self.transcript = `${home}/.claude/projects/${projectDirName(cwd)}/${self.sessionId}.jsonl`
    const prev = await read($, me)
    self.beat = prev
      ? { ...prev, state: prev.state === 'ended' ? 'idle' : prev.state }
      : emptyBeat(`${self.sessionId}-${crypto.randomUUID().slice(0, 8)}`, await defaultName($, cwd, repo?.root ?? null), cwd)
    await save($, {}, true)
    await scan($)
    await update($, bandOff, () => false)
    if ((await $.store.get(BAND_KEY)) === true) await update($, bandOff, () => true)
    const mode = await $.store.get(BAND_MODE_KEY)
    await update($, bandMode, (): 'hud' | 'line' => (mode === 'line' ? 'line' : 'hud'))

    $.clock.every(TICK_MS, async () => {
      const stale = (await $.clock.now()) - self.lastWrite > HEARTBEAT_MS
      if (self.beat && (self.dirty || stale)) await save($, {}, true)
      await scan($)
      await runExplain($)
      await maybeAlert($)
    })

    await $.command.register({
      name: 'board',
      description: '팀 세션 상황판: 진행 현황, 결정 기록, 결정 대기',
      argumentHint: '[세션이름 | name <표시이름>]',
    })
    return result
  })

  on('session.end', async ($, e, next) => {
    await save($, { state: 'ended' }, true)
    return next(e)
  })

  // 사용자가 직접 보낸 요청. 결정을 기다리던 중이면 이것이 그 결정의 답이다.
  on('prompt.submit', async ($, e, next) => {
    const text = typeof e.text === 'string' ? e.text.trim() : ''
    // next(e) 안에서 턴이 시작되며 결정 대기 상태가 지워지므로, 넘기기 전에 기록한다.
    if (text && !text.startsWith('/') && self.beat) {
      const at = await $.clock.now()
      let { decisions, timeline } = self.beat
      if (self.beat.state === 'asking' && self.beat.question) {
        const d = { at, question: questionSummary(self.beat.question), answer: oneLine(text, 120) }
        decisions = pushCapped(decisions, d, MAX_DECISIONS)
        timeline = pushCapped(timeline, event(at, 'decide', `${d.question} → ${d.answer}`), MAX_TIMELINE)
      }
      timeline = pushCapped(timeline, event(at, 'prompt', text), MAX_TIMELINE)
      // 결정과 새 요청을 한 번에 쓴다. 답을 보냈으니 더 이상 결정 대기가 아니다.
      await save($, { decisions, timeline, question: '', prompt: oneLine(text, 100), state: 'working', step: '생각 중' }, true)
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await save($, { state: 'working', step: '생각 중', question: '' })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const main = !e.agentId

    if (e.tool === 'AskUserQuestion' && main) {
      const asked = askUserText(input)
      await note($, 'ask', asked.split('\n')[0] ?? '', { state: 'asking', step: '질문 중', question: asked }, true)
      const r = await next(e)
      const answers = (r as { result?: { answers?: unknown } }).result?.answers
      const at = await $.clock.now()
      const ds = decisionsFromAnswers(answers, at)
      let decisions = self.beat?.decisions ?? []
      let timeline = self.beat?.timeline ?? []
      for (const d of ds) {
        decisions = pushCapped(decisions, d, MAX_DECISIONS)
        timeline = pushCapped(timeline, event(at, 'decide', `${d.question} → ${d.answer}`), MAX_TIMELINE)
      }
      await save($, { state: 'working', step: '답변 반영 중', question: '', decisions, timeline }, true)
      return r
    }

    if (TASK_TOOLS.has(e.tool) && main) {
      const r = await next(e)
      const tasks = applyTaskTool(self.beat?.tasks ?? [], e.tool, input, (r as { result?: unknown }).result)
      if (tasks) {
        const cur = progress(tasks).current
        await save($, { tasks, step: cur ? `할 일: ${cur.subject}` : describeTool(e.tool, input) })
      }
      return r
    }

    const step = describeTool(e.tool, input)
    if (EDIT_TOOLS.has(e.tool) && main && self.beat) {
      const file = basename(String(input.file_path ?? input.notebook_path ?? ''))
      const files = [file, ...self.beat.files.filter(f => f !== file)].slice(0, 12)
      await save($, { step, edits: self.beat.edits + 1, files })
    } else {
      await save($, { step: main ? step : `(서브) ${step}` })
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) return r

    const usage = await $.session.usage().catch(() => null)
    const contextPct = usage?.context?.percent ?? null
    const answer = 'answer' in e && typeof e.answer === 'string' ? e.answer : ''

    if (e.isAborted || !answer) {
      await note($, 'abort', '중단됨', { state: 'idle', step: '', contextPct, last: '중단됨' })
    } else if (looksLikeQuestion(answer)) {
      const q = questionText(answer)
      await note($, 'ask', questionSummary(q), { state: 'asking', step: '', contextPct, last: oneLine(answer, 100), question: q })
    } else {
      await note($, 'done', answer, { state: 'idle', step: '', contextPct, last: oneLine(answer, 100), question: '' })
    }
    return r
  })

  on('command.run', { command: 'board' }, async ($, e) => {
    const args = e.args.trim()
    const [sub, ...rest] = args.split(/\s+/)
    if (sub === 'band' && (rest[0] === 'on' || rest[0] === 'off')) {
      const off = rest[0] === 'off'
      await $.store.set(BAND_KEY, off)
      await update($, bandOff, () => off)
      return { text: off ? '입력창 위 팀 띠를 껐어요. 다시 켜려면 /board band on' : '입력창 위 팀 띠를 켰어요.' }
    }
    if (sub === 'sound' && (rest[0] === 'on' || rest[0] === 'off' || rest[0] === 'test')) {
      if (rest[0] === 'test') {
        await announce($, `${self.beat?.name ?? '이'} 세션이 결정을 기다립니다`)
        return { text: '알림 소리를 재생했어요. (macOS 에서만 들립니다)' }
      }
      const off = rest[0] === 'off'
      await $.store.set(SOUND_KEY, off)
      return { text: off ? '결정 대기 음성 알림을 껐어요.' : '결정 대기 음성 알림을 켰어요. 결정을 20초 넘게 기다리면 그 세션이 알려 줍니다.' }
    }
    if (sub === 'band' && (rest[0] === 'hud' || rest[0] === 'line')) {
      await $.store.set(BAND_MODE_KEY, rest[0])
      await update($, bandMode, (): 'hud' | 'line' => (rest[0] === 'line' ? 'line' : 'hud'))
      return { text: rest[0] === 'hud' ? '입력창 위 팀 띠를 창(HUD) 모양으로 그립니다.' : '입력창 위 팀 띠를 한 줄로 그립니다.' }
    }
    if (sub === 'name' && rest.length) {
      await $.store.set(nameKey(self.sessionId), rest.join(' ').slice(0, 24))
      await save($, { name: rest.join(' ').slice(0, 24) }, true)
      await scan($)
      return { text: `이 세션을 "${self.beat?.name}"(으)로 표시합니다.` }
    }
    await scan($)
    if (args) {
      const list = visible(await read($, beats), await $.clock.now())
      const target = findByName(list, args)
      if (!target) return { text: `"${args}" 세션을 찾지 못했어요. 지금 세션: ${list.map(b => b.name).join(', ') || '없음'}` }
      await update($, focus, () => target.id)
    } else {
      await update($, focus, () => null)
    }
    // 직접 연 패널이니 키보드를 가져온다: Tab 으로 버튼 이동, Enter 로 누름, Esc 로 닫기.
    await $.ui.open({ id: PANE, title: '팀 상황판', focus: true, closeOnEscape: true })
    return { text: '팀 상황판을 열었어요. (Tab 버튼 · Enter 누름 · PgUp/PgDn 스크롤 · Esc 닫기)' }
  })

  // Claude Code 의 /rename 을 따라간다 (세션 이름 = 보드 이름)
  on('command.run', { command: 'rename' }, async ($, e, next) => {
    const r = await next(e)
    // 인자 없이 /rename 하면 Claude Code 가 이름을 지어 기록 파일에 쓴다
    const name = e.args.trim().slice(0, 24) || (await sessionTitle($))
    if (name && self.beat) {
      await $.store.set(nameKey(self.sessionId), name)
      await save($, { name }, true)
      await scan($)
    }
    return r
  })

  // 버튼 처리. 그리기의 $ 로는 상태를 쓸 수 없어서, 누름은 여기서 받는다.
  on('ui.press', async ($, e, next) => {
    if (e.plugin !== 'team-board') return next(e)
    const key = String(e.element ?? '')
    if (key.startsWith('explain-')) await update($, pending, () => key.slice('explain-'.length))
    else if (key.startsWith('toggle-')) {
      const id = key.slice('toggle-'.length)
      await update($, collapsed, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
    } else if (key.startsWith('detail-')) await update($, focus, () => key.slice('detail-'.length))
    else if (key === 'back') await update($, focus, () => null)
    else if (key === 'band-board') await $.command.run({ command: 'board', args: '' })
    else return next(e)
    return { element: key }
  })

  // 입력창 위 띠: 다른 mod 의 띠 아래에 붙인다 (가리지 않음).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, bandOff))) return next(e)
    const now = await $.clock.now()
    const list = visible(await read($, beats), now)
    const below = await next(e)
    if (list.length < 2) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const asking = list.filter(b => b.state === 'asking' && !isStale(b, now)).length
    const tone = (b: Beat) => (isStale(b, now) ? pal.dim : b.state === 'asking' ? pal.ask : b.state === 'working' ? pal.work : pal.dim)
    const markOf = (b: Beat) => (isStale(b, now) ? '·' : b.state === 'asking' ? '⚑' : b.state === 'working' ? '●' : '○')
    const isMe = (b: Beat) => b.id === self.beat?.id

    // 한 줄 모양 (예전 띠): /board band line
    if ((await read($, bandMode)) === 'line') {
      const chip = (b: Beat) => {
        const stale = isStale(b, now)
        const { done, total } = progress(b.tasks)
        const prog = total ? ` ${bar(done, total, 4)} ${done}/${total}` : ''
        return b.state === 'asking' && !stale ? (
          <Text backgroundColor={pal.ask} color={pal.onBadge} bold>{` ${markOf(b)} ${b.name}${isMe(b) ? '*' : ''}${prog} `}</Text>
        ) : (
          <Text color={tone(b)} dimColor={stale}>{`${markOf(b)} ${b.name}${isMe(b) ? '*' : ''}${prog}`}</Text>
        )
      }
      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="row" columnGap={2} paddingX={1} flexWrap="wrap">
            <Text backgroundColor={asking ? pal.ask : pal.accent} color={pal.onBadge} bold>
              {asking ? ` TEAM ${list.length} · 결정 ${asking} ` : ` TEAM ${list.length} `}
            </Text>
            {list.map(chip)}
            <Text color={pal.dim}>/board</Text>
          </Box>
        </Box>
      )
    }

    // 창(HUD) 모양: 위에 팀 요약, 아래에 세션 칸을 나란히 (세이브 슬롯처럼)
    const inner = Math.max(30, (e.props.bodyColumns ?? 100) - 4)
    const slotW = Math.max(22, Math.min(34, Math.floor((inner - (list.length - 1)) / list.length)))
    const sum = list.reduce((a, b) => {
      const p = progress(b.tasks)
      return { done: a.done + p.done, total: a.total + p.total }
    }, { done: 0, total: 0 })
    const count = (st: Beat['state']) => list.filter(b => b.state === st && !isStale(b, now)).length
    const SEG = { done: pal.ok, now: pal.work, left: pal.dim, end: pal.text } as const

    const slot = (b: Beat) => {
      const stale = isStale(b, now)
      const hot = b.state === 'asking' && !stale
      const fg = hot ? pal.onBadge : pal.text
      const tag = stale ? 'zz' : hot ? '결정!' : b.state === 'working' ? '작업' : '대기'
      const { done, total } = progress(b.tasks)
      const second = hot
        ? <Text color={pal.onBadge} wrap="truncate-end">{questionSummary(b.question)}</Text>
        : total
          ? (
              <Text wrap="truncate-end">
                {routeLine(b.tasks, Math.max(8, slotW - 8)).map(sg => <Text color={SEG[sg.tone]}>{sg.text}</Text>)}
                <Text color={pal.text}>{` ${done}/${total}`}</Text>
              </Text>
            )
          : <Text color={b.state === 'working' ? pal.work : pal.dim} wrap="truncate-end">{b.state === 'working' ? b.step || '생각 중' : b.last || b.prompt || '새 요청 대기'}</Text>
      return (
        <Box
          key={`slot-${b.id}`}
          width={slotW}
          flexDirection="column"
          paddingX={1}
          {...(hot ? { backgroundColor: pal.ask } : pal.card ? { backgroundColor: isMe(b) ? pal.frame : pal.card } : {})}
        >
          <Box flexDirection="row" justifyContent="space-between">
            <Text color={hot ? pal.onBadge : tone(b)} bold wrap="truncate-end">
              {`${markOf(b)} ${b.name}${isMe(b) ? '*' : ''}`}
            </Text>
            <Text color={hot ? pal.onBadge : tone(b)} bold={hot}>{` ${tag}`}</Text>
          </Box>
          <Box>{second}</Box>
        </Box>
      )
    }

    const hud = (
      <Box flexDirection="column" borderStyle="double" borderColor={asking ? pal.ask : pal.accent} paddingX={1} {...(pal.card ? { backgroundColor: pal.card } : {})}>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" columnGap={2} flexShrink={1}>
            <Text color={pal.accent} bold>{`◆ TEAM ${list.length}`}</Text>
            {asking ? <Text backgroundColor={pal.ask} color={pal.onBadge} bold>{` 결정 ${asking} `}</Text> : null}
            <Text color={pal.work}>{`● 작업 ${count('working')}`}</Text>
            <Text color={pal.dim}>{`○ 대기 ${count('idle')}`}</Text>
            {sum.total ? (
              <Text>
                <Text color={pal.ok}>{bar(sum.done, sum.total, 8)}</Text>
                <Text color={pal.text}>{` ${sum.done}/${sum.total}`}</Text>
              </Text>
            ) : null}
          </Box>
          <Button key="band-board" label="보드 /board" hotkey="b" onPress={() => {}} />
        </Box>
        <Box flexDirection="row" flexWrap="wrap" columnGap={1}>
          {list.map(slot)}
        </Box>
      </Box>
    )
    return (
      <Box flexDirection="column">
        {below}
        {hud}
      </Box>
    )
  })

  // /board 패널: 전체 보기 또는 한 세션 자세히
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Raster = 'Raster' in els ? els.Raster : undefined
    const now = await $.clock.now()
    const list = visible(await read($, beats), now)
    const ex = await read($, explain)
    const waiting = await read($, pending)
    const focusId = await read($, focus)
    const folded = await read($, collapsed)
    const focused = focusId ? list.find(b => b.id === focusId) : undefined
    const cols = Math.max(30, e.props.bodyColumns ?? 60)
    const cells = cols >= 80 ? 12 : cols >= 56 ? 8 : 5
    const noop = () => {}

    const stateTone = (b: Beat) =>
      isStale(b, now) ? pal.dim : b.state === 'asking' ? pal.ask : b.state === 'working' ? pal.work : pal.frame

    // 라벨 칸 폭을 맞춘 한 줄
    const row = (labelText: string, body: JSX.Element, key?: string) => (
      <Box key={key} flexDirection="row">
        <Box width={6} flexShrink={0}>
          <Text color={pal.dim}>{labelText}</Text>
        </Box>
        <Box flexGrow={1} flexShrink={1}>{body}</Box>
      </Box>
    )

    const titleRow = (b: Beat) => {
      const tone = stateTone(b)
      const badge = isStale(b, now) ? '소식없음' : label(b, now)
      return (
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Box flexDirection="row" columnGap={1} flexShrink={1}>
            <Text backgroundColor={tone === pal.frame ? pal.dim : tone} color={pal.onBadge} bold>{` ${badge} `}</Text>
            <Text color={pal.text} bold wrap="truncate-end">{b.name}</Text>
            {b.id === self.beat?.id ? <Text color={pal.dim}>(이 세션)</Text> : null}
          </Box>
          <Box flexDirection="row" columnGap={1} flexShrink={0}>
            <Text color={contextTone(b.contextPct, pal)}>
              {b.contextPct === null ? 'ctx --' : `ctx ${bar(b.contextPct, 100, 5)} ${b.contextPct}%`}
            </Text>
            <Text color={pal.dim}>{`· ${ago(now - b.updatedAt)}`}</Text>
          </Box>
        </Box>
      )
    }

    // 픽셀 아이콘은 터미널 + 색이 #rrggbb 인 팔레트 + 넉넉한 폭에서만 (아니면 글자 카드)
    const useTile = Raster !== undefined && pal.isRaw && cols >= 56
    const rightWidth = cols - 6 - (useTile ? 9 : 0)
    const SEG_COLOR = { done: pal.ok, now: pal.work, left: pal.dim, end: pal.text } as const

    const progressRow = (b: Beat) => {
      const { done, total, current } = progress(b.tasks)
      if (!total) return null
      const segs = routeLine(b.tasks, Math.min(34, Math.max(10, rightWidth - 6 - 6)))
      return row(
        '진행',
        <Text wrap="truncate-end">
          {segs.map(sg => (
            <Text color={SEG_COLOR[sg.tone]} bold={sg.tone === 'now'}>{sg.text}</Text>
          ))}
          <Text color={pal.text}>{` ${done}/${total}`}</Text>
          {current ? <Text color={pal.work}>{`  ${current.subject}`}</Text> : done === total ? <Text color={pal.ok}>  도착</Text> : null}
        </Text>,
      )
    }

    const tileOf = (b: Beat) => {
      if (!useTile || !Raster) return null
      const stale = isStale(b, now)
      const kind = stale ? 'stale' : b.state === 'asking' ? 'asking' : b.state === 'working' ? 'working' : 'idle'
      const bg = stale || kind === 'idle' ? pal.frame : kind === 'asking' ? pal.ask : pal.work
      const fg = stale ? pal.dim : kind === 'idle' ? pal.ok : pal.onBadge
      return (
        <Box width={8} flexShrink={0} backgroundColor={bg} paddingX={1}>
          <Raster key={`icon-${b.id}`} {...sprite(ICONS[kind], hex(fg), hex(bg))} />
        </Box>
      )
    }

    // 결정을 기다리는 카드에만 주의 띠
    const stripeOf = (b: Beat) => {
      if (b.state !== 'asking' || isStale(b, now)) return null
      const inner = cols - 6
      const text = ' 결정을 기다려요 '
      const left = Math.max(2, Math.floor((inner - widthOf(text)) / 2))
      const right = Math.max(2, inner - left - widthOf(text))
      return (
        <Text wrap="truncate-end">
          <Text color={pal.ask} backgroundColor={pal.onBadge}>{'▚'.repeat(left)}</Text>
          <Text color={pal.onBadge} backgroundColor={pal.ask} bold>{text}</Text>
          <Text color={pal.ask} backgroundColor={pal.onBadge}>{'▚'.repeat(right)}</Text>
        </Text>
      )
    }

    // 카드 머리: 주의 띠 + [아이콘 | 이름·상태 / 지금 무엇 / 경로]
    const headOf = (b: Beat) => {
      const showsPrompt = !(b.state === 'asking' && b.question) && !(b.state === 'working' && b.step) && !b.last
      const second =
        b.state === 'asking' && b.question
          ? row('결정', <Text color={pal.ask} bold wrap="truncate-end">{questionSummary(b.question)}</Text>)
          : b.state === 'working' && b.step
            ? row('지금', <Text color={pal.work} wrap="truncate-end">{b.step}</Text>)
            : b.last
              ? row('마지막', <Text color={pal.dim} wrap="truncate-end">{b.last}</Text>)
              : b.prompt
                ? row('요청', <Text color={pal.text} wrap="truncate-end">{b.prompt}</Text>)
                : null
      return (
        <Box flexDirection="column">
          {stripeOf(b)}
          <Box flexDirection="row" columnGap={1}>
            {tileOf(b)}
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              {titleRow(b)}
              {second}
              {progressRow(b) ?? (b.prompt && !showsPrompt ? row('요청', <Text color={pal.dim} wrap="truncate-end">{b.prompt}</Text>) : null)}
            </Box>
          </Box>
        </Box>
      )
    }

    const cardProps = (b: Beat) => ({
      flexDirection: 'column' as const,
      borderStyle: 'round',
      borderColor: stateTone(b),
      borderDimColor: isStale(b, now),
      paddingX: 1,
      ...(pal.card ? { backgroundColor: pal.card } : {}),
    })

    // 설명 상자 안쪽 폭: 패널 폭에서 패널·카드·상자의 테두리와 여백, 들여쓰기를 뺀다.
    const artWidth = Math.max(20, cols - 18)

    const explainBox = (b: Beat) => {
      const mine = ex && ex.id === b.id && ex.question === b.question ? ex : null
      if (!mine || mine.status === 'loading' || folded.includes(b.id)) return null
      if (mine.status === 'error' || !mine.data) {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor={mine.status === 'error' ? pal.bad : pal.accent} paddingX={1} marginTop={1}>
            <Text color={pal.accent} bold>12살 버전</Text>
            {mine.text.split('\n').map(l => (
              <Text color={mine.status === 'error' ? pal.bad : pal.text}>{l || ' '}</Text>
            ))}
          </Box>
        )
      }
      const d = mine.data
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={pal.accent} paddingX={1} marginTop={1}>
          <Text color={pal.accent} bold>12살 버전</Text>
          {d.items.map((it, i) => (
            <Box flexDirection="column" marginTop={1}>
              <Text color={pal.text} bold wrap="wrap">{`${i + 1}. ${it.title}`}</Text>
              {it.analogy ? (
                <Box flexDirection="row">
                  <Box width={8} flexShrink={0}><Text color={pal.dim}>   비유 </Text></Box>
                  <Box flexGrow={1} flexShrink={1}><Text color={pal.text} wrap="wrap">{it.analogy}</Text></Box>
                </Box>
              ) : null}
              {it.options.map(op => (
                <Box flexDirection="column" marginTop={1}>
                  <Text color={pal.work} bold>{`   ▸ ${op.label}`}</Text>
                  {flowArt(op.flow, artWidth).map(line => (
                    <Text color={pal.frame === 'promptBorder' ? pal.dim : pal.accent} wrap="truncate-end">{`     ${line}`}</Text>
                  ))}
                  {op.result ? (
                    <Box flexDirection="row">
                      <Box width={7} flexShrink={0}><Text color={pal.dim}>     └</Text></Box>
                      <Box flexGrow={1} flexShrink={1}><Text color={pal.dim} wrap="wrap">{op.result}</Text></Box>
                    </Box>
                  ) : null}
                </Box>
              ))}
              {it.link ? (
                <Box flexDirection="row" marginTop={1}>
                  <Box width={10} flexShrink={0}><Text color={pal.ok}>   ◆ 맥락 </Text></Box>
                  <Box flexGrow={1} flexShrink={1}><Text color={pal.ok} wrap="wrap">{it.link}</Text></Box>
                </Box>
              ) : null}
              {it.suggest ? (
                <Box flexDirection="row">
                  <Box width={10} flexShrink={0}><Text color={pal.ask}>   ★ 제안 </Text></Box>
                  <Box flexGrow={1} flexShrink={1}><Text color={pal.ask} wrap="wrap">{it.suggest}</Text></Box>
                </Box>
              ) : null}
            </Box>
          ))}
          {d.first ? (
            <Box flexDirection="row" marginTop={1}>
              <Box width={14} flexShrink={0}><Text color={pal.onBadge} backgroundColor={pal.ask} bold>{' 먼저 정할 것 '}</Text></Box>
              <Box flexGrow={1} flexShrink={1} paddingLeft={1}><Text color={pal.text} bold wrap="wrap">{d.first}</Text></Box>
            </Box>
          ) : null}
        </Box>
      )
    }

    const askBlock = (b: Beat, maxLines: number) => {
      if (b.state !== 'asking' || !b.question) return null
      const all = b.question.split('\n').filter(l => l.trim())
      const loading = waiting === b.id || (ex?.id === b.id && ex.question === b.question && ex.status === 'loading')
      const has = !loading && !!ex && ex.id === b.id && ex.question === b.question && ex.status !== 'loading'
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={pal.ask} bold>⚑ 결정할 것</Text>
          {/* 질문은 보통 답변 끝에 있으니 끝부분을 보여준다 */}
          {all.length > maxLines ? <Text color={pal.dim}>{`│ … 앞 ${all.length - maxLines}줄 (자세히에서 전체)`}</Text> : null}
          {all.slice(-maxLines).map(l => (
            <Box flexDirection="row">
              <Box width={2} flexShrink={0}>
                <Text color={pal.ask}>│</Text>
              </Box>
              <Box flexGrow={1} flexShrink={1}>
                <Text wrap="wrap" color={ASKING_LINE.test(l) ? pal.ask : pal.text} bold={ASKING_LINE.test(l)}>{l}</Text>
              </Box>
            </Box>
          ))}
          <Box flexDirection="row" columnGap={1} marginTop={1}>
            {has ? (
              <Button key={`toggle-${b.id}`} variant="primary" label={folded.includes(b.id) ? '12살 설명 펼치기 ▾' : '12살 설명 접기 ▴'} onPress={noop} />
            ) : null}
            <Button
              key={`explain-${b.id}`}
              variant={has ? 'secondary' : 'primary'}
              label={loading ? '설명 만드는 중…' : has ? '다시 만들기' : '12살 버전으로 설명'}
              onPress={noop}
            />
          </Box>
          {explainBox(b)}
        </Box>
      )
    }

    // 한 세션 자세히
    if (focused) {
      const b = focused
      const { done, total } = progress(b.tasks)
      return (
        <Box flexDirection="column" paddingX={1}>
          <Box {...cardProps(b)}>
            {headOf(b)}
            {b.prompt ? row('요청', <Text color={pal.text} wrap="truncate-end">{b.prompt}</Text>) : null}
            {b.files.length ? row('편집', <Text color={pal.dim} wrap="truncate-end">{`${b.edits}회 · ${b.files.slice(0, 6).join(', ')}`}</Text>) : null}
            {askBlock(b, 40)}
          </Box>

          {total ? (
            <Box flexDirection="column" marginTop={1}>
              <Text>
                <Text color={pal.accent} bold>할 일 </Text>
                <Text color={pal.dim}>{`${done}/${total}`}</Text>
              </Text>
              {b.tasks.map(t => (
                <Text wrap="truncate-end">
                  <Text color={t.status === 'completed' ? pal.ok : t.status === 'in_progress' ? pal.work : pal.dim}>
                    {t.status === 'completed' ? '  ✓ ' : t.status === 'in_progress' ? '  ▶ ' : '  · '}
                  </Text>
                  <Text color={t.status === 'completed' ? pal.dim : t.status === 'in_progress' ? pal.work : pal.text} strikethrough={t.status === 'completed'}>
                    {t.subject}
                  </Text>
                </Text>
              ))}
            </Box>
          ) : null}

          <Box flexDirection="column" marginTop={1}>
            <Text>
              <Text color={pal.accent} bold>결정 기록 </Text>
              <Text color={pal.dim}>{`${b.decisions.length}건`}</Text>
            </Text>
            {b.decisions.length === 0 ? <Text color={pal.dim}>  아직 없음</Text> : null}
            {[...b.decisions].reverse().map((d, i, all) => (
              <Box flexDirection="column">
                <Text wrap="truncate-end">
                  <Text color={pal.ok}>  ◆ </Text>
                  <Text color={pal.text}>{d.question}</Text>
                  <Text color={pal.dim}>{`  ${ago(now - d.at)}`}</Text>
                </Text>
                <Text wrap="truncate-end">
                  <Text color={pal.frame}>{i < all.length - 1 ? '  │   ' : '      '}</Text>
                  <Text color={pal.ok} bold>{`→ ${d.answer}`}</Text>
                </Text>
              </Box>
            ))}
          </Box>

          <Box flexDirection="column" marginTop={1}>
            <Text color={pal.accent} bold>흐름</Text>
            {[...b.timeline].reverse().map(ev => {
              const c = ev.kind === 'decide' ? pal.ok : ev.kind === 'ask' ? pal.ask : ev.kind === 'abort' ? pal.bad : ev.kind === 'prompt' ? pal.work : pal.dim
              return (
                <Box flexDirection="row">
                  <Box width={10} flexShrink={0}>
                    <Text color={pal.dim}>{`  ${ago(now - ev.at)}`}</Text>
                  </Box>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text wrap="truncate-end">
                      <Text color={c}>{`${EVENT_MARK[ev.kind]}  `}</Text>
                      <Text color={pal.text}>{ev.text}</Text>
                    </Text>
                  </Box>
                </Box>
              )
            })}
          </Box>

          <Box marginTop={1}>
            <Button key="back" label="← 전체 보기" onPress={noop} />
          </Box>
        </Box>
      )
    }

    if (list.length === 0) {
      return (
        <Box paddingX={1}>
          <Text color={pal.dim}>아직 기록된 세션이 없어요. 같은 레포에서 Claude Code를 열면 여기에 나타나요.</Text>
        </Box>
      )
    }

    // 전체 보기
    const sum = list.reduce(
      (acc, b) => {
        const p = progress(b.tasks)
        return { done: acc.done + p.done, total: acc.total + p.total }
      },
      { done: 0, total: 0 },
    )
    const count = (s: Beat['state']) => list.filter(b => b.state === s && !isStale(b, now)).length
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" columnGap={2} flexWrap="wrap" marginBottom={1}>
          <Text color={pal.accent} bold>TEAM BOARD</Text>
          {count('asking') ? <Text backgroundColor={pal.ask} color={pal.onBadge} bold>{` 결정 대기 ${count('asking')} `}</Text> : null}
          <Text color={pal.work}>{`● 작업 ${count('working')}`}</Text>
          <Text color={pal.dim}>{`○ 대기 ${count('idle')}`}</Text>
          {sum.total ? (
            <Text>
              <Text color={pal.dim}>전체 </Text>
              <Text color={pal.ok}>{bar(sum.done, sum.total, cells)}</Text>
              <Text color={pal.text}>{` ${sum.done}/${sum.total}`}</Text>
            </Text>
          ) : null}
        </Box>

        {list.map(b => {
          const lastDecision = b.decisions[b.decisions.length - 1]
          return (
            <Box key={b.id} {...cardProps(b)}>
              {headOf(b)}
              {lastDecision
                ? row(
                    '결정',
                    <Text wrap="truncate-end">
                      <Text color={pal.ok}>◆ </Text>
                      <Text color={pal.text}>{lastDecision.question}</Text>
                      <Text color={pal.ok} bold>{` → ${lastDecision.answer}`}</Text>
                      {b.decisions.length > 1 ? <Text color={pal.dim}>{`  외 ${b.decisions.length - 1}건`}</Text> : null}
                    </Text>,
                  )
                : null}
              {askBlock(b, 6)}
              <Box flexDirection="row" justifyContent="flex-end">
                <Button key={`detail-${b.id}`} label="자세히 →" onPress={noop} />
              </Box>
            </Box>
          )
        })}
        <Text color={pal.dim}>PgUp/PgDn 스크롤 · Home 처음 · /board 세션이름 → 자세히 · /board name 이름 · /board band|sound off|on</Text>
      </Box>
    )
  })
}
