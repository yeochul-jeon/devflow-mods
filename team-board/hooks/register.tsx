import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Beat, Decision, Event, Explain, ExplainItem, ExplainKind, SteExplain } from '../types'
import {
  EVENT_MARK,
  ago,
  applyTaskTool,
  askUserText,
  bandLayout,
  bandOrder,
  basename,
  cacheLeft,
  cacheMinutes,
  cacheText,
  cacheWarn,
  decisionsFromAnswers,
  describeTool,
  emptyBeat,
  event,
  explainPrompt,
  htmlPrompt,
  findByName,
  HIDE_MS,
  isAskingLine,
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
import { commandKey, formatAlert, judge, masksIn, noteForClaude, signLine } from './failure'
import { bar, contextTone, paletteOf } from './palette'
import { cells as widthOf, flowArt, parseExplain, parseSte } from './diagram'
import { hex, ICONS, sprite } from './pixel'

const PANE = 'team-board'
const TICK_MS = 3_000
const HEARTBEAT_MS = 60_000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite'])
// 사람이 보낸 입력: 터미널 입력, Remote Control, claude -p·Agent SDK. 작업 알림·다른 세션·플러그인이 넣은 입력은 기록하지 않는다
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])

const beats = atom({ plugin: 'team-board', key: 'beats' } as const, [] as Beat[])
const explain = atom({ plugin: 'team-board', key: 'explain' } as const, null as Explain | null)
const steExplain = atom({ plugin: 'team-board', key: 'steExplain' } as const, null as SteExplain | null)
const tab = atom({ plugin: 'team-board', key: 'tab' } as const, 'kid' as ExplainKind)
const queue = atom({ plugin: 'team-board', key: 'queue' } as const, [] as string[])
const html = atom({ plugin: 'team-board', key: 'html' } as const, null as { id: string; question: string } | null)
const focus = atom({ plugin: 'team-board', key: 'focus' } as const, null as string | null)
const me = atom({ plugin: 'team-board', key: 'me' } as const, null as Beat | null)
const collapsed = atom({ plugin: 'team-board', key: 'collapsed' } as const, [] as string[])
const bandOff = atom({ plugin: 'team-board', key: 'bandOff' } as const, false)
const bandMode = atom({ plugin: 'team-board', key: 'bandMode' } as const, 'hud' as 'hud' | 'line')
const bandSoloOff = atom({ plugin: 'team-board', key: 'bandSoloOff' } as const, false)
const BAND_KEY = 'band-off'
const BAND_MODE_KEY = 'band-mode'
const BAND_SOLO_KEY = 'band-solo-off'
/** 세션별로 정한 표시 이름: 다시 켜도(claude --continue) 유지 */
const nameKey = (sessionId: string) => `name:${sessionId}`
const SOUND_KEY = 'sound-off'
const FAIL_KEY = 'fail-off'
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
  /** 세션 이름을 마지막으로 확인한 시각, 대화 기록 파일에서 이름을 찾았는지 */
  titleCheckedAt: 0,
  titleDone: false,
  /** 숨은 실패 감지를 끔 (/board fail off) */
  failOff: false,
  /** HTML 요청 턴이 끝나면 되돌릴 이 세션의 결정 질문 (요청 턴이 결정 대기를 지우지 않게) */
  htmlKeep: '',
  /** 결정의 답으로 기록한 요청. 그 턴이 답도 도구 호출도 없이 중단되면 이것으로 되돌린다 */
  undo: null as { question: string; decisions: Decision[]; decide: Event } | null,
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
  const now = await $.clock.now()
  const found: Beat[] = []
  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    // 어차피 숨길 오래된 기록은 읽지 않는다
    if (now - entry.mtimeMs >= HIDE_MS) continue
    try {
      found.push(normalize(JSON.parse(await $.fs.read(`${self.dir}/${entry.name}`))))
    } catch {
      // 쓰는 도중이거나 깨진 파일은 다음 틱에 다시 읽는다.
    }
  }
  // 잔재를 먼저 숨겨야 살아 있는 세션 이름에 ·2 가 붙지 않는다
  await update($, beats, () => dedupeNames(visible(found, now)))
}

async function runExplain($: EngineInterface): Promise<void> {
  if (self.busy) return
  const job = (await read($, queue))[0]
  if (!job) return
  await update($, queue, list => list.slice(1))
  const kind: ExplainKind = job.startsWith('ste:') ? 'ste' : 'kid'
  const id = job.slice(job.indexOf(':') + 1)
  const target = (await read($, beats)).find(b => b.id === id)
  if (!target?.question) return
  const question = target.question
  // JSON 이면 그림으로, 아니면 글 그대로 보여준다.
  const put = (status: Explain['status'], text: string, raw = '') =>
    kind === 'ste'
      ? update($, steExplain, (): SteExplain => ({ id, question, status, text, data: raw ? parseSte(raw) : null }))
      : update($, explain, (): Explain => ({ id, question, status, text, data: raw ? parseExplain(raw) : null }))

  self.busy = true
  try {
    await put('loading', '')
    await update($, collapsed, list => list.filter(x => x !== id))
    const r = await $.model.complete({ model: 'haiku', prompt: explainPrompt(target, kind), maxTokens: 3000, timeoutMs: 120_000 })
    if (r.isAnswered) await put('done', stripMarkdown(r.text).trim(), r.text)
    else await put('error', `설명을 만들지 못했어요 (${r.reason})`)
  } catch (err) {
    // 엔진이 보내기를 거부한 요청(막힌 모델 등)은 reject 된다. 로딩에 머물지 않게 이유를 보여준다
    await put('error', `설명을 만들지 못했어요 (${err instanceof Error ? err.message : String(err)})`)
  } finally {
    self.busy = false
  }
}

/**
 * 설명 탭 누름. 탭: 설명이 없으면 고르고 만들기, 다른 탭이 열려 있으면 고르기, 이 탭이 열려 있으면 접기·펼치기.
 * 재생성: 이 탭을 고르고 다시 만들기. 만드는 중에는 새 요청을 넣지 않는다.
 */
async function pressExplain($: EngineInterface, action: 'tab' | 'regen', kind: ExplainKind, id: string): Promise<void> {
  const target = (await read($, beats)).find(b => b.id === id)
  if (!target?.question) return
  const job = `${kind}:${id}`
  const part = kind === 'ste' ? await read($, steExplain) : await read($, explain)
  const mine = part && part.id === id && part.question === target.question ? part : null
  const making = (await read($, queue)).includes(job) || mine?.status === 'loading'
  const open = async () => {
    await update($, tab, () => kind)
    await update($, collapsed, list => list.filter(x => x !== id))
  }
  const make = () => update($, queue, list => (list.includes(job) ? list : [...list, job]))
  if (action === 'regen') {
    if (!mine || making) return
    await open()
    await make()
  } else if (!mine && !making) {
    await open()
    await make()
  } else if ((await read($, tab)) === kind) {
    if (!making) await update($, collapsed, list => (list.includes(id) ? list.filter(x => x !== id) : [...list, id]))
  } else {
    await open()
  }
}

/** HTML 버튼: 보드를 연 이 세션에 요청을 보낸다 (질문 하나에 한 번). 끝날 때까지 기다리지 않는다 (await 하면 멈춘다). */
async function pressHtml($: EngineInterface, id: string): Promise<void> {
  const target = (await read($, beats)).find(b => b.id === id)
  if (!target?.question) return
  const sent = await read($, html)
  if (sent && sent.id === id && sent.question === target.question) return
  await update($, html, () => ({ id, question: target.question }))
  void $.prompt.submit({ text: htmlPrompt(target) })
}

/** claude --name, /rename 으로 정한 세션 이름. 대화 기록 파일의 마지막 customTitle. */
async function sessionTitle($: EngineInterface): Promise<string> {
  if (!self.transcript) return ''
  const grep = await $.process
    .run(['grep', '-o', '"customTitle":"[^"]*"', self.transcript], { timeoutMs: 3000 })
    .catch(() => null)
  return grep ? lastCustomTitle(grep.stdout) : ''
}

const BOARD_HELP = [
  '팀 상황판 명령',
  '',
  '보기',
  '  /board                     전체: 세션마다 요청·진행·결정·결정 대기',
  '  /board <세션>              자세히: 할 일, 결정 기록 전체, 흐름, 편집 파일   예) /board sub-2',
  '',
  '이름',
  '  /board name <이름>         이 세션의 표시 이름 (다시 열어도 유지)          예) /board name api-fix',
  '  /rename <이름>             Claude Code 세션 이름 = 보드 이름',
  '',
  '입력창 위 팀 창',
  '  /board band off | on       끄기 / 켜기',
  '  /board band hud | line     창 모양 / 한 줄 모양',
  '  /board band solo off | on  세션이 하나일 때 숨기기 / 보이기',
  '',
  '결정 대기 음성 알림 (macOS)',
  '  /board sound off | on      끄기 / 켜기 (기본 켜짐)',
  '  /board sound test          미리 듣기',
  '',
  '숨은 실패 (exit 0 인데 실패한 빌드·테스트)',
  '  /board fail                보고서',
  '  /board fail clear          이 세션 표시 지우기',
  '  /board fail off | on       감지 끄기 / 켜기',
].join('\n')

const TITLE_EVERY_MS = 15_000

/**
 * /clear·/resume 뒤에는 세션 id 와 대화 기록 파일이 바뀐다. 바뀌었으면 따라가고,
 * 직접 정한 이름(/board name, /rename)은 새 id 로 옮긴다.
 */
async function followSessionId($: EngineInterface): Promise<void> {
  if (!self.sessionId) return
  const id = await $.session.id()
  if (!id || id === self.sessionId) return
  const pinned = await $.store.get(nameKey(self.sessionId))
  if (typeof pinned === 'string' && pinned) await $.store.set(nameKey(id), pinned)
  self.transcript = self.transcript.replace(`${self.sessionId}.jsonl`, `${id}.jsonl`)
  self.sessionId = id
  self.titleCheckedAt = 0
  self.titleDone = false
}

/**
 * claude --name 의 이름은 대화 기록 파일이 생긴 뒤에야 읽을 수 있어서, 직접 정한 이름이 없으면 가끔 다시 본다.
 * 이름을 찾으면 그만 본다 (이름은 파일 첫 줄에 쓰이고, 바뀜은 /rename 이 따라간다). 이름이 없으면
 * 인자 없는 /rename 이 기록 파일에 늦게 쓰는 이름도 잡도록 계속 본다.
 */
async function followTitle($: EngineInterface): Promise<void> {
  if (!self.beat || self.titleDone) return
  const now = await $.clock.now()
  if (now - self.titleCheckedAt < TITLE_EVERY_MS) return
  self.titleCheckedAt = now
  const pinned = await $.store.get(nameKey(self.sessionId))
  if (typeof pinned === 'string' && pinned) return
  const title = await sessionTitle($)
  if (!title) return
  self.titleDone = true
  if (title !== self.beat.name) {
    await save($, { name: title }, true)
    await scan($)
  }
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
    self.titleDone = false
    self.failOff = (await $.store.get(FAIL_KEY)) === true
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
    const soloOff = (await $.store.get(BAND_SOLO_KEY)) === true
    await update($, bandSoloOff, () => soloOff)

    $.clock.every(TICK_MS, async () => {
      const stale = (await $.clock.now()) - self.lastWrite > HEARTBEAT_MS
      if (self.beat && (self.dirty || stale)) await save($, {}, true)
      await scan($)
      await runExplain($)
      await maybeAlert($)
      await followSessionId($)
      await followTitle($)
    })

    await $.command.register({
      name: 'board',
      description: '팀 세션 상황판: 진행 현황, 결정 기록, 결정 대기',
      argumentHint: '[세션 | name | band | sound | fail | help]',
    })
    return result
  })

  // /clear 와 같은 탭의 /resume 은 대화만 바뀌고 탭은 그대로다 (session.start 도 다시 오지 않음).
  // 그때는 숨기지 않고 대기로 두며, 결정 기록은 남기고 대기 질문과 할 일은 비운다.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      const at = await $.clock.now()
      const timeline = self.beat
        ? pushCapped(self.beat.timeline, event(at, 'clear', e.reason === 'clear' ? '/clear' : '/resume'), MAX_TIMELINE)
        : []
      self.askingSince = 0
      await save($, { state: 'idle', step: '', question: '', last: '', prompt: '', tasks: [], timeline, cacheAt: null }, true)
    } else {
      await save($, { state: 'ended' }, true)
    }
    return next(e)
  })

  // 사용자가 직접 보낸 요청. 결정을 기다리던 중이면 이것이 그 결정의 답이다.
  on('prompt.submit', async ($, e, next) => {
    const text = typeof e.text === 'string' ? e.text.trim() : ''
    // next(e) 안에서 턴이 시작되며 결정 대기 상태가 지워지므로, 넘기기 전에 기록한다.
    if (text && !text.startsWith('/') && self.beat && USER_ORIGINS.has(e.origin.kind)) {
      const at = await $.clock.now()
      let { decisions, timeline } = self.beat
      self.undo = null
      if (self.beat.state === 'asking' && self.beat.question) {
        const d = { at, question: questionSummary(self.beat.question), answer: oneLine(text, 120) }
        const decide = event(at, 'decide', `${d.question} → ${d.answer}`)
        self.undo = { question: self.beat.question, decisions, decide }
        decisions = pushCapped(decisions, d, MAX_DECISIONS)
        timeline = pushCapped(timeline, decide, MAX_TIMELINE)
      }
      timeline = pushCapped(timeline, event(at, 'prompt', text), MAX_TIMELINE)
      // 결정과 새 요청을 한 번에 쓴다. 답을 보냈으니 더 이상 결정 대기가 아니다.
      self.htmlKeep = ''
      await save($, { decisions, timeline, question: '', prompt: oneLine(text, 100), state: 'working', step: '생각 중' }, true)
    } else if (e.origin.kind === 'plugin' && e.origin.name === 'team-board' && self.beat?.state === 'asking' && self.beat.question) {
      // HTML 버튼이 보낸 요청: 결정은 아직 남아 있다
      self.htmlKeep = self.beat.question
    }
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    await save($, { state: 'working', step: '생각 중', question: '' })
    return next(e)
  })

  // 메인 스레드의 모델 요청마다 프롬프트 캐시 수명이 다시 시작된다. 서브에이전트 요청은 다른 prefix 다.
  // 도구 호출 기록처럼 1.5초에 한 번까지만 쓰고, 미룬 것은 다음 틱에 쓴다.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) await save($, { cacheAt: await $.clock.now() })
    return yield* next(e)
  })

  // compact 뒤에는 대화 앞부분이 바뀌어 캐시가 없다. 다음 메인 요청에서 다시 잰다.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await save($, { cacheAt: null }, true)
    return r
  })

  // 숨은 실패: exit 0 인데 출력에 실패 흔적. 같은 명령이 깨끗하게 다시 돌면 지운다.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (self.failOff || e.agentId || !self.beat) return ran
    // 거부됐거나 exit 0 이 아니면 Claude 가 이미 오류로 받는다
    if (ran.deny !== undefined || ran.isError === true) return ran
    const out = ran.result
    if (!out || out.interrupted || out.backgroundTaskId !== undefined) return ran
    const text = [out.stdout, out.stderr].filter(t => typeof t === 'string' && t.length > 0).join('\n')
    const at = await $.clock.now()
    const alert = judge(e.command, text, at)
    const prev = self.beat.fail
    if (!alert) {
      // 실패 코드를 가리는 명령이 출력 없이 끝나면 통과했는지 알 수 없어 지우지 않는다
      if (prev && prev.key === commandKey(e.command) && (text.trim() || !masksIn(e.command).length)) await save($, { fail: null }, true)
      return ran
    }
    const timeline = pushCapped(self.beat.timeline, event(at, 'fail', `${alert.key} · ${signLine(alert.signs[0] ?? '')}`), MAX_TIMELINE)
    // 다른 명령의 확인 필요(warn)로 남아 있는 실패(high)를 덮지 않는다. 기록에는 남긴다
    const keep = prev?.level === 'high' && alert.level === 'warn' && prev.key !== alert.key
    await save($, { fail: keep ? prev : alert, timeline }, true)
    await scan($)
    const memo = noteForClaude(alert)
    return memo ? { ...ran, context: [...(ran.context ?? []), memo] } : ran
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const main = !e.agentId
    // 도구를 썼으면 답을 받아 일하는 중이다. 이제 중단해도 결정은 되돌리지 않는다
    self.undo = null

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
    const undo = self.undo
    self.undo = null

    // 결정의 답으로 보낸 요청을 아무 진행 없이 중단했다: 그 결정을 지우고 같은 질문의 결정 대기로 돌아간다
    if (undo && e.isAborted && !answer && self.beat) {
      const at = await $.clock.now()
      const kept = self.beat.timeline.filter(t => !(t.kind === 'decide' && t.at === undo.decide.at && t.text === undo.decide.text))
      const timeline = pushCapped(kept, event(at, 'abort', '중단됨'), MAX_TIMELINE)
      await save($, { state: 'asking', step: '', contextPct, question: undo.question, decisions: undo.decisions, timeline }, true)
      return r
    }
    // HTML 요청 턴(중단 포함)이 끝나면 결정 대기로 되돌린다. 답(링크)은 질문으로 보지 않는다
    if (self.htmlKeep) {
      const question = self.htmlKeep
      self.htmlKeep = ''
      await save($, { state: 'asking', step: '', contextPct, question }, true)
      return r
    }
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
    if (sub === 'band' && rest[0] === 'solo' && (rest[1] === 'on' || rest[1] === 'off')) {
      const off = rest[1] === 'off'
      await $.store.set(BAND_SOLO_KEY, off)
      await update($, bandSoloOff, () => off)
      return { text: off ? '세션이 하나일 때는 팀 창을 숨겨요. 다시 보려면 /board band solo on' : '세션이 하나여도 팀 창을 보여요.' }
    }
    if (sub === 'band' && (rest[0] === 'hud' || rest[0] === 'line')) {
      await $.store.set(BAND_MODE_KEY, rest[0])
      await update($, bandMode, (): 'hud' | 'line' => (rest[0] === 'line' ? 'line' : 'hud'))
      return { text: rest[0] === 'hud' ? '입력창 위 팀 띠를 창(HUD) 모양으로 그립니다.' : '입력창 위 팀 띠를 한 줄로 그립니다.' }
    }
    if (sub === 'fail') {
      const opt = rest[0] ?? ''
      if (opt === 'on' || opt === 'off') {
        self.failOff = opt === 'off'
        await $.store.set(FAIL_KEY, self.failOff)
        if (self.failOff) await save($, { fail: null }, true)
        return { text: self.failOff ? '숨은 실패 감지를 껐어요. 다시 켜려면 /board fail on' : '숨은 실패 감지를 켰어요.' }
      }
      if (opt === 'clear') {
        await save($, { fail: null }, true)
        await scan($)
        return { text: '이 세션의 숨은 실패 표시를 지웠어요.' }
      }
      const all = visible(await read($, beats), await $.clock.now()).filter(b => b.fail)
      const picked = opt ? all.filter(b => b.name.includes(rest.join(' '))) : all
      if (!picked.length) return { text: `숨은 실패가 없어요.${self.failOff ? ' (이 세션은 감지가 꺼져 있어요: /board fail on)' : ''}` }
      return { text: picked.map(b => formatAlert(b.name, b.fail!)).join('\n\n') + '\n\n같은 명령이 깨끗하게 다시 돌면 저절로 지워져요. 바로 지우려면 그 세션에서 /board fail clear' }
    }
    if (sub === 'help' || sub === '?' || (sub === 'name' && !rest.length)) return { text: BOARD_HELP }
    if (sub === 'band' || sub === 'sound') return { text: `"/board ${args}" 는 모르는 옵션이에요.\n\n${BOARD_HELP}` }
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
      if (!target) return { text: `"${args}" 세션을 찾지 못했어요. 지금 세션: ${list.map(b => b.name).join(', ') || '없음'}\n명령 목록은 /board help` }
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
    const tabKey = /^(tab|regen)-(kid|ste)-(.+)$/.exec(key)
    if (tabKey) await pressExplain($, tabKey[1] as 'tab' | 'regen', tabKey[2] as ExplainKind, tabKey[3]!)
    else if (key.startsWith('html-')) await pressHtml($, key.slice('html-'.length))
    else if (key.startsWith('detail-')) await update($, focus, () => key.slice('detail-'.length))
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
    // 세션 하나: /board band solo off 면 숨김 (기본은 보임)
    if (!list.length || (list.length < 2 && (await read($, bandSoloOff)))) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const asking = list.filter(b => b.state === 'asking' && !isStale(b, now)).length
    const tone = (b: Beat) => (isStale(b, now) ? pal.dim : b.state === 'asking' ? pal.ask : b.state === 'working' ? pal.work : pal.dim)
    const markOf = (b: Beat) => (isStale(b, now) ? '·' : b.state === 'asking' ? '⚑' : b.state === 'working' ? '●' : '○')
    const isMe = (b: Beat) => b.id === self.beat?.id
    // 숨은 실패: 결정 대기가 아니고 아직 풀리지 않은 실패(high)
    const failed = (b: Beat) => !isStale(b, now) && b.fail?.level === 'high'
    const fails = list.filter(failed).length

    // 한 줄 모양 (예전 띠): /board band line
    if ((await read($, bandMode)) === 'line') {
      const chip = (b: Beat) => {
        const stale = isStale(b, now)
        const { done, total } = progress(b.tasks)
        const prog = total ? ` ${bar(done, total, 4)} ${done}/${total}` : ''
        return b.state === 'asking' && !stale ? (
          <Text backgroundColor={pal.ask} color={pal.onBadge} bold>{` ${markOf(b)} ${b.name}${isMe(b) ? '*' : ''}${prog} `}</Text>
        ) : (
          <Text dimColor={stale}>
            <Text color={tone(b)}>{`${markOf(b)} ${b.name}${isMe(b) ? '*' : ''}${prog}`}</Text>
            {failed(b) ? <Text color={pal.bad} bold>{' ⚠'}</Text> : null}
            {!stale && cacheWarn(b, now) ? <Text color={pal.ask}>{` ${cacheText(cacheLeft(b.cacheAt, now))}`}</Text> : null}
          </Text>
        )
      }
      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="row" columnGap={2} paddingX={1} flexWrap="wrap">
            <Text backgroundColor={asking ? pal.ask : pal.accent} color={pal.onBadge} bold>
              {asking ? ` TEAM ${list.length} · 결정 ${asking} ` : ` TEAM ${list.length} `}
            </Text>
            {fails ? <Text backgroundColor={pal.bad} color={pal.onBadge} bold>{` ⚠ 실패 ${fails} `}</Text> : null}
            {list.map(chip)}
            <Text color={pal.dim}>/board</Text>
          </Box>
        </Box>
      )
    }

    // 창(HUD) 모양: 위에 팀 요약, 아래에 세션 칸을 나란히 (세이브 슬롯처럼)
    // 세션 수·화면 크기에 맞춰 배치: 혼자면 한 줄, 많으면 칸을 한 줄로 줄이고 넘치면 +k
    const layout = bandLayout(list.length, e.props.bodyColumns ?? 100, e.props.maxRows ?? 10)
    const slotW = layout.slotW
    const ordered = bandOrder(list, now, self.beat?.id)
    const shown = ordered.slice(0, layout.shown)
    const hidden = ordered.length - shown.length
    const sum = list.reduce((a, b) => {
      const p = progress(b.tasks)
      return { done: a.done + p.done, total: a.total + p.total }
    }, { done: 0, total: 0 })
    const count = (st: Beat['state']) => list.filter(b => b.state === st && !isStale(b, now)).length
    const SEG = { done: pal.ok, now: pal.work, left: pal.dim, end: pal.text } as const

    const stateOf = (b: Beat) => {
      const stale = isStale(b, now)
      const hot = b.state === 'asking' && !stale
      const bad = !hot && failed(b)
      const cool = !stale && !hot && !bad && cacheWarn(b, now)
      return { stale, hot, bad, cool }
    }
    // 이름 앞 상태 배지: 폭 6칸으로 같아서 칸마다 이름 시작 위치가 맞는다. filled = 칸이 노랗게 칠해짐(반전색)
    const badgeOf = (b: Beat, filled = false) => {
      const s = stateOf(b)
      const [text, bg, fg] = s.stale ? ['  zz  ', pal.frame, pal.dim]
        : s.hot ? [' 결정 ', filled ? pal.onBadge : pal.ask, filled ? pal.ask : pal.onBadge]
          : s.bad ? [' 실패 ', pal.bad, pal.onBadge]
            : b.state === 'working' ? [' 작업 ', pal.work, pal.onBadge]
              : s.cool ? [' 캐시 ', pal.ask, pal.onBadge]
                : [' 대기 ', pal.dim, pal.onBadge]
      return <Text backgroundColor={bg} color={fg} bold>{text}</Text>
    }
    const minutesOf = (b: Beat) => <Text color={pal.ask}>{cacheMinutes(cacheLeft(b.cacheAt, now)!)}</Text>

    // filled: 칸이 노랗게 칠해졌는지 (HUD 칸). 혼자 띠는 바탕이 칠해지지 않아 질문을 노란 글자로 쓴다
    const secondOf = (b: Beat, width: number, filled = true) => {
      const hot = b.state === 'asking' && !isStale(b, now)
      const bad = !hot && failed(b)
      const { done, total } = progress(b.tasks)
      return hot
        ? <Text color={filled ? pal.onBadge : pal.ask} wrap="truncate-end">{questionSummary(b.question)}</Text>
        : bad
          ? <Text color={pal.bad} wrap="truncate-end">{signLine(b.fail!.signs[0] ?? b.fail!.key)}</Text>
        : total
          ? (
              <Text wrap="truncate-end">
                {routeLine(b.tasks, Math.max(8, width - 8)).map(sg => <Text color={SEG[sg.tone]}>{sg.text}</Text>)}
                <Text color={pal.text}>{` ${done}/${total}`}</Text>
              </Text>
            )
          : <Text color={b.state === 'working' ? pal.work : pal.dim} wrap="truncate-end">{b.state === 'working' ? b.step || '생각 중' : b.last || b.prompt || '새 요청 대기'}</Text>
    }

    const slot = (b: Beat) => {
      const { hot, cool } = stateOf(b)
      return (
        <Box
          key={`slot-${b.id}`}
          width={slotW}
          flexDirection="column"
          paddingX={1}
          {...(hot ? { backgroundColor: pal.ask } : pal.card ? { backgroundColor: isMe(b) ? pal.frame : pal.card } : {})}
        >
          <Box flexDirection="row" columnGap={1}>
            <Box flexShrink={0}>{badgeOf(b, hot)}</Box>
            <Text color={hot ? pal.onBadge : tone(b)} bold wrap="truncate-end">
              {`${b.name}${isMe(b) ? '*' : ''}`}
            </Text>
            {cool ? <Box flexShrink={0}>{minutesOf(b)}</Box> : null}
          </Box>
          {layout.mode === 'full' ? <Box>{secondOf(b, slotW)}</Box> : null}
        </Box>
      )
    }

    const hud = (
      <Box flexDirection="column" borderStyle="double" borderColor={asking ? pal.ask : fails ? pal.bad : pal.accent} paddingX={1} {...(pal.card ? { backgroundColor: pal.card } : {})}>
        <Box flexDirection="row" justifyContent="space-between">
          <Box flexDirection="row" columnGap={2} flexShrink={1}>
            <Text color={pal.accent} bold>{`◆ TEAM ${list.length}`}</Text>
            {asking ? <Text backgroundColor={pal.ask} color={pal.onBadge} bold>{` 결정 ${asking} `}</Text> : null}
            {fails ? <Text backgroundColor={pal.bad} color={pal.onBadge} bold>{` ⚠ 실패 ${fails} `}</Text> : null}
            {count('working') ? <Text backgroundColor={pal.work} color={pal.onBadge} bold>{` 작업 ${count('working')} `}</Text> : null}
            {count('idle') ? <Text backgroundColor={pal.dim} color={pal.onBadge} bold>{` 대기 ${count('idle')} `}</Text> : null}
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
          {shown.map(slot)}
          {hidden ? <Text color={pal.dim}>{` +${hidden} 더 · /board `}</Text> : null}
        </Box>
      </Box>
    )

    // 혼자: 머리줄 한 줄에 내 상태를 바로 (창 높이 3줄)
    if (layout.mode === 'solo') {
      const b = list[0]!
      const { hot, bad, cool } = stateOf(b)
      return (
        <Box flexDirection="column">
          {below}
          <Box flexDirection="row" justifyContent="space-between" columnGap={2} borderStyle="double" borderColor={hot ? pal.ask : bad ? pal.bad : pal.accent} paddingX={1} {...(pal.card ? { backgroundColor: pal.card } : {})}>
            <Box flexDirection="row" columnGap={2} flexShrink={1}>
              {/* 이름과 배지는 줄이지 않는다. 설명이 길어도 설명만 잘린다 (태그 "캐시 n분" 이 길어 줄이 쪼개지던 문제) */}
              <Box flexShrink={0}>
                <Text color={pal.accent} bold>{`◆ ${b.name}`}</Text>
              </Box>
              <Box flexShrink={0} flexDirection="row" columnGap={1}>
                {badgeOf(b)}
                {cool ? minutesOf(b) : null}
              </Box>
              <Box flexShrink={1}>{secondOf(b, Math.min(40, slotW - 40), false)}</Box>
            </Box>
            <Button key="band-board" label="보드 /board" hotkey="b" onPress={() => {}} />
          </Box>
        </Box>
      )
    }
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
    const steEx = await read($, steExplain)
    const tabNow = await read($, tab)
    const jobs = await read($, queue)
    const htmlSent = await read($, html)
    const focusId = await read($, focus)
    const folded = await read($, collapsed)
    const focused = focusId ? list.find(b => b.id === focusId) : undefined
    const cols = Math.max(30, e.props.bodyColumns ?? 60)
    const cells = cols >= 80 ? 12 : cols >= 56 ? 8 : 5
    const noop = () => {}

    const stateTone = (b: Beat) =>
      isStale(b, now) ? pal.dim : b.state === 'asking' ? pal.ask : b.fail?.level === 'high' ? pal.bad : b.state === 'working' ? pal.work : pal.frame

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
      const badge = isStale(b, now) ? '소식없음' : b.state !== 'asking' && b.fail?.level === 'high' ? '숨은 실패' : label(b, now)
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
            {b.cacheAt != null ? (
              <Text color={cacheWarn(b, now) ? pal.ask : pal.dim}>{`· ${cacheText(cacheLeft(b.cacheAt, now))}`}</Text>
            ) : null}
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
      const broke = !stale && b.state !== 'asking' && b.fail?.level === 'high'
      const kind = stale ? 'stale' : b.state === 'asking' || broke ? 'asking' : b.state === 'working' ? 'working' : 'idle'
      const bg = stale || kind === 'idle' ? pal.frame : broke ? pal.bad : kind === 'asking' ? pal.ask : pal.work
      const fg = stale ? pal.dim : kind === 'idle' ? pal.ok : pal.onBadge
      return (
        <Box width={8} flexShrink={0} backgroundColor={bg} paddingX={1}>
          <Raster key={`icon-${b.id}`} {...sprite(ICONS[kind], hex(fg), hex(bg))} />
        </Box>
      )
    }

    // 결정을 기다리는 카드에만 주의 띠
    const stripeOf = (b: Beat) => {
      if (isStale(b, now)) return null
      const asks = b.state === 'asking'
      if (!asks && b.fail?.level !== 'high') return null
      const inner = cols - 6
      const text = asks ? ' 결정을 기다려요 ' : ' 출력에 실패가 숨어 있어요 '
      const hue = asks ? pal.ask : pal.bad
      const left = Math.max(2, Math.floor((inner - widthOf(text)) / 2))
      const right = Math.max(2, inner - left - widthOf(text))
      return (
        <Text wrap="truncate-end">
          <Text color={hue} backgroundColor={pal.onBadge}>{'▚'.repeat(left)}</Text>
          <Text color={pal.onBadge} backgroundColor={hue} bold>{text}</Text>
          <Text color={hue} backgroundColor={pal.onBadge}>{'▚'.repeat(right)}</Text>
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

    // 숨은 실패: 명령, 흔적, 가림. full 이면 흔적을 모두.
    const failRows = (b: Beat, full: boolean) => {
      const f = b.fail
      if (!f || isStale(b, now)) return null
      const hue = f.level === 'high' ? pal.bad : pal.ask
      const signs = full ? f.signs : f.signs.slice(0, 1)
      return (
        <Box flexDirection="column">
          {row('실패', <Text wrap="truncate-end"><Text color={hue} bold>{f.level === 'high' ? '⚠ exit 0 인데 ' : '△ 확인 필요 '}</Text><Text color={pal.text}>{f.command}</Text></Text>, `fail-cmd-${b.id}`)}
          {signs.map((sg, i) => row('', <Text color={hue} wrap="truncate-end">{`• ${sg}`}</Text>, `fail-sign-${b.id}-${i}`))}
          {full ? f.masks.map((m, i) => row('', <Text color={pal.dim} wrap="truncate-end">{`가림  ${m}`}</Text>, `fail-mask-${b.id}-${i}`)) : null}
        </Box>
      )
    }

    // 설명 상자 안쪽 폭: 패널 폭에서 패널·카드·상자의 테두리와 여백, 들여쓰기를 뺀다.
    const artWidth = Math.max(20, cols - 18)

    // 설명 탭: 종류별 이름과 색. 결정 배지의 노랑과 겹치지 않게 초록·파랑.
    const TABS: { kind: ExplainKind; label: string; hue: string }[] = [
      { kind: 'kid', label: '12살', hue: pal.ok },
      { kind: 'ste', label: 'ASD-STE100', hue: pal.work },
    ]
    // 이 세션 질문으로 만든 설명 (질문이 바뀌면 보이지 않는다)
    const partOf = (b: Beat, kind: ExplainKind) => {
      const part = kind === 'ste' ? steEx : ex
      return part && part.id === b.id && part.question === b.question ? part : null
    }
    const makingOf = (b: Beat, kind: ExplainKind) => jobs.includes(`${kind}:${b.id}`) || partOf(b, kind)?.status === 'loading'
    // 상자를 보일지: 어느 한쪽이라도 만들었거나 만드는 중
    const hasAny = (b: Beat) => TABS.some(t => partOf(b, t.kind) || makingOf(b, t.kind))

    // 12살 설명 한 항목
    const kid = (it: ExplainItem, i: number) => (
      <Box flexDirection="column">
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
    )

    const explainBox = (b: Beat) => {
      if (!hasAny(b) || folded.includes(b.id)) return null
      const t = TABS.find(x => x.kind === tabNow) ?? TABS[0]!
      const part = partOf(b, t.kind)
      if (makingOf(b, t.kind) || !part) {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor={t.hue} paddingX={1} marginTop={1}>
            <Text color={t.hue}>{makingOf(b, t.kind) ? '설명 만드는 중…' : ' '}</Text>
          </Box>
        )
      }
      if (part.status === 'error' || !part.data) {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor={part.status === 'error' ? pal.bad : t.hue} paddingX={1} marginTop={1}>
            {part.text.split('\n').map(l => (
              <Text color={part.status === 'error' ? pal.bad : pal.text}>{l || ' '}</Text>
            ))}
          </Box>
        )
      }
      if (t.kind === 'ste' && steEx?.data) {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor={t.hue} paddingX={1} marginTop={1}>
            {steEx.data.items.map((it, i) => (
              <Box flexDirection="column" marginTop={i ? 1 : 0}>
                <Text color={pal.text} bold wrap="wrap">{`${i + 1}. ${it.title}`}</Text>
                {it.ste.map(l => (
                  <Box flexDirection="row">
                    <Box width={2} flexShrink={0}><Text color={pal.dim}>·</Text></Box>
                    <Box flexGrow={1} flexShrink={1}><Text color={pal.text} wrap="wrap">{l}</Text></Box>
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        )
      }
      const d = ex?.data
      if (!d) return null
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={t.hue} paddingX={1} marginTop={1}>
          {d.items.map((it, i) => (
            <Box marginTop={i ? 1 : 0}>{kid(it, i)}</Box>
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

    // 탭 줄: [ 12살 ▴ ][ 🔄 ] │ [ ASD-STE100 ][ 🔄 ] │ [ HTML ]. 고른 탭은 배지처럼 색 바탕, ▴/▾ 는 고른 탭에만
    // (초점 반전이 걸린 고른 탭이 안 고른 탭처럼 보일 수 있어 기호로 구분한다).
    const tabRow = (b: Beat) => {
      const shown = hasAny(b)
      return (
        <Box flexDirection="row" columnGap={1} marginTop={1}>
          {TABS.flatMap((t, i) => {
            const picked = shown && tabNow === t.kind
            const out = [
              <Button key={`tab-${t.kind}-${b.id}`} plain onPress={noop}>
                {picked ? (
                  <Text color={pal.onBadge} backgroundColor={t.hue} bold>{` ${t.label} ${folded.includes(b.id) ? '▾' : '▴'} `}</Text>
                ) : (
                  <Text color={t.hue} bold>{`[ ${t.label} ]`}</Text>
                )}
              </Button>,
            ]
            // 재생성은 만든 탭에만, 만드는 중에는 숨긴다 (눌러도 무시되므로)
            if (partOf(b, t.kind) && !makingOf(b, t.kind)) out.push(<Button key={`regen-${t.kind}-${b.id}`} variant="secondary" label="🔄" onPress={noop} />)
            if (i < TABS.length - 1) out.push(<Text color={pal.dim}>│</Text>)
            return out
          })}
          <Text color={pal.dim}>│</Text>
          {htmlSent && htmlSent.id === b.id && htmlSent.question === b.question ? (
            <Text color={pal.dim}>HTML 요청함</Text>
          ) : (
            <Button key={`html-${b.id}`} variant="secondary" label="HTML" onPress={noop} />
          )}
        </Box>
      )
    }

    const askBlock = (b: Beat, maxLines: number) => {
      if (b.state !== 'asking' || !b.question) return null
      const all = b.question.split('\n').filter(l => l.trim())
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
                <Text wrap="wrap" color={isAskingLine(l) ? pal.ask : pal.text} bold={isAskingLine(l)}>{l}</Text>
              </Box>
            </Box>
          ))}
          {tabRow(b)}
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
            {failRows(b, true)}
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
          {list.some(b => b.fail?.level === 'high' && !isStale(b, now)) ? <Text backgroundColor={pal.bad} color={pal.onBadge} bold>{` ⚠ 숨은 실패 ${list.filter(b => b.fail?.level === 'high' && !isStale(b, now)).length} `}</Text> : null}
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
              {failRows(b, false)}
              {askBlock(b, 6)}
              <Box flexDirection="row" justifyContent="flex-end">
                <Button key={`detail-${b.id}`} label="자세히 →" onPress={noop} />
              </Box>
            </Box>
          )
        })}
        <Text color={pal.dim}>PgUp/PgDn 스크롤 · Home 처음 · /board 세션이름 → 자세히 · 명령 목록 /board help</Text>
      </Box>
    )
  })
}
