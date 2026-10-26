import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { PillBar, PillTone, SoundOs, Strip, TodoStrip } from './board'
import type { Beat, Decision, Event, Explain, ExplainItem, ExplainKind, RecentLine, SteExplain, SubAgent, WorkPlan } from '../types'
import {
  EVENT_MARK,
  agentClearEnded,
  agentCounts,
  agentEnd,
  agentGone,
  agentMeta,
  agentPatch,
  agentStart,
  agentStrips,
  askContext,
  fitStrip,
  gitText,
  parseGitStatus,
  parseShortstat,
  wrapCells,
  agentSummary,
  agentSync,
  waitsOnAgents,
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
  flowKeep,
  flowKey,
  flowText,
  normalize,
  notificationTokens,
  oneLine,
  overlaps,
  pillBar,
  pillToneOf,
  progress,
  soundCommands,
  soundOs,
  pushCapped,
  needsVerify,
  pushTouch,
  questionSummary,
  sinceLastPrompt,
  sinceText,
  questionText,
  recentTurns,
  repoKey,
  dedupeNames,
  lastCustomTitle,
  projectDirName,
  routeLine,
  stripMarkdown,
  headParts,
  steStacked,
  stampTasks,
  tasksFromPlan,
  todoStrips,
  touchPath,
  turnTook,
  unwrapPaste,
  visible,
  withMe,
} from './board'
import { commandKey, formatAlert, isVerify, judge, masksIn, noteForClaude, redact, signLine } from './failure'
import { bar, contextTone, mix, paletteOf } from './palette'
import { cells as widthOf, clip as widthClip, flowArt, parseExplain, parseSte } from './diagram'
import { hex, ICONS, sprite } from './pixel'

const PANE = 'team-board'
const TICK_MS = 3_000
const HEARTBEAT_MS = 60_000
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const TASK_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TodoWrite'])
// work-plan mod 의 계획 보고. 할 일은 그 mod 의 atom 을 관찰해 받으므로 단계 줄을 이 도구 이름으로 덮지 않는다
const PLAN_TOOL: string = 'mcp__work-plan__plan_update'
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
// 읽기만 한다. work-plan 이 없으면 값이 없다
const workPlan = atom({ plugin: 'work-plan', key: 'plan' } as const, null as WorkPlan | null)
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
  /** 저장소 루트 (없으면 작업 폴더). 편집 경로를 상대 경로로 쓴다 */
  root: '',
  /** 같은 파일 겹침을 Claude 에게 이미 알린 것: `<경로>|<세션 id>` */
  overlapTold: new Set<string>(),
  /** 마지막 검증 명령 뒤에 고친 코드 경로와 마지막 편집 시각 (T34 B1). 보조 에이전트의 편집·검증도 센다 */
  unchecked: new Set<string>(),
  uncheckedAt: 0,
  /** 수정 없이 연달아 실패한 같은 명령 (T34 A4). 편집하면 다시 센다 */
  failRun: { key: '', count: 0 },
  /** 이번 요청 뒤 메인 세션의 마지막 도구 작업. 질문 맥락의 직전 줄 (Claude 가 말없이 물을 때) */
  lastTool: '',
  beat: null as Beat | null,
  lastWrite: 0,
  /** 마지막으로 시작한 scan 번호. 늦게 끝난 이전 scan 이 새 결과를 덮지 않게 한다 */
  scanGen: 0,
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
  /** 세션 id 가 바뀌기 직전 session.end 의 이유 ('clear' | 'resume'). 바뀐 id 를 따라갈 때 쓰고 지운다 */
  switchReason: '',
  /** 숨은 실패 감지를 끔 (/board fail off) */
  failOff: false,
  /** HTML 요청 턴이 끝나면 되돌릴 이 세션의 결정 질문 (요청 턴이 결정 대기를 지우지 않게) */
  htmlKeep: '',
  /** 결정의 답으로 기록한 요청. 그 턴이 답도 도구 호출도 없이 중단되면 이것으로 되돌린다 */
  undo: null as { question: string; decisions: Decision[]; decide: Event } | null,
  /** 마지막 결정 요청의 직전 대화. 질문을 되돌릴 때(htmlKeep, undo) 함께 되돌린다 */
  lastRecent: [] as RecentLine[],
  /** 흐름 줄 원문 (flowKey → 글). 장부와 따로 <id>.flow 에 쓴다: 모든 세션이 몇 초마다 읽는 <id>.json 을 키우지 않고, 옛 판의 scan(*.json)도 읽지 않게 */
  flow: {} as Record<string, string>,
  flowDirty: false,
  /** prompt-coach 질문을 띄우기 전 상태. 질문이 끝나면 이것으로 되돌린다(Claude 의 질문을 기다리던 중이었을 수 있다) */
  coachKept: null as Pick<Beat, 'state' | 'step' | 'question'> | null,
}

/** 흐름 줄의 원문을 남긴다. 장부의 줄은 100자로 줄인 한 줄이다. 실패 기록처럼 비밀 값은 가린다 */
function keepFull(ev: Event, raw: string): Event {
  self.flow[flowKey(ev)] = flowText(redact(raw))
  self.flowDirty = true
  return ev
}

async function save($: EngineInterface, patch: Partial<Beat>, force = false): Promise<void> {
  if (!self.beat || !self.dir) return
  const now = await $.clock.now()
  const stateChanged = patch.state !== undefined && patch.state !== self.beat.state
  if (stateChanged && patch.state === 'asking') self.askingSince = now
  // 직전 대화는 결정을 기다리는 동안만 둔다
  if (patch.question === '') patch = { ...patch, recent: [] }
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
  if (self.flowDirty) {
    self.flowDirty = false
    self.flow = flowKeep(self.flow, snapshot.timeline)
    await $.fs.write(`${self.dir}/${self.beat.id}.flow`, JSON.stringify(self.flow))
  }
}

/**
 * 보조 에이전트 장부를 바꾸고 쓴다. 읽기와 바꾸기를 await 없이 한 번에 해야 한다:
 * 같은 응답에서 띄운 에이전트들의 hook 이 동시에 돌아, await 앞에서 읽은 장부로 쓰면 서로 덮는다.
 */
async function setAgents($: EngineInterface, change: (agents: SubAgent[]) => SubAgent[], force = false): Promise<void> {
  if (!self.beat) return
  self.beat.agents = change(self.beat.agents)
  await save($, {}, force)
}

/** 끝난 신호를 놓친 보조 에이전트와 턴만 끝나고 아직 도는 보조 에이전트를 엔진 목록으로 보정한다. 세션이 끝난 뒤의 틱에서는 목록이 거부되므로 무시한다. */
async function syncAgents($: EngineInterface): Promise<void> {
  if (!self.beat || !self.beat.agents.length) return
  const infos = await $.agent.list().catch(() => null)
  if (!infos) return
  const at = await $.clock.now()
  const before = self.beat.agents.map(a => a.status).join()
  self.beat.agents = agentSync(self.beat.agents, infos, at)
  if (self.beat.agents.map(a => a.status).join() !== before) await save($, {}, true)
}

/**
 * work-plan 의 계획을 할 일로 옮긴다. 남은 단계를 완료로 볼지는 결정 대기 여부로 정하므로,
 * 턴 끝에 이 세션의 상태를 정한 뒤에도 한 번 더 부른다 (hook 순서에 따라 계획의 턴 끝 표시가 먼저 올 수 있다).
 * 단계 줄은 일하는 중일 때만 바꾼다.
 */
async function coachPending($: EngineInterface, question: string | null): Promise<void> {
  const b = self.beat
  if (!b) return
  if (question) {
    self.coachKept ??= { state: b.state, step: b.step, question: b.question }
    await save($, { state: 'asking', step: '', question }, true)
  } else if (self.coachKept) {
    const kept = self.coachKept
    self.coachKept = null
    // 그사이 턴이 시작됐으면(작업 중) 그대로 둔다
    if (b.state === 'asking' && b.question.startsWith('prompt-coach: ')) await save($, kept, true)
  }
}

async function syncPlan($: EngineInterface, plan?: unknown): Promise<void> {
  if (!self.beat) return
  const p = plan === undefined ? await read($, workPlan) : plan
  const r = tasksFromPlan(p)
  if (!r) return
  // 단계가 끝난 시각은 보고 시각으로 (syncPlan 은 세션 시작·턴 끝에도 불려 지금 시각이면 늦게 찍힌다).
  // 답으로 끝난 턴은 남은 단계를 그때 완료로 그리므로 턴이 끝난 시각 (마지막 보고 시각이면 지금 단계가 앞 단계와 함께 끝난 것으로 보였다)
  const wp = p as WorkPlan
  const s = stampTasks(self.beat.tasks, self.beat.planStartAt, r.tasks, wp.ended?.at ?? wp.updatedAt, self.beat.planEnded === true && !r.ended)
  const base = { tasks: s.tasks, planStartAt: s.planStartAt, planEnded: r.ended }
  // 계획 보고는 한 턴에 몇 번뿐이라 바로 쓴다: 묶어 쓰기(1.5초)에 걸리면 띠가 Spinner 보다 한 단계 늦다 (T24 실화면)
  await save($, r.step && self.beat.state === 'working' ? { ...base, step: r.step } : base, true)
}

async function note($: EngineInterface, kind: Parameters<typeof event>[1], text: string, patch: Partial<Beat> = {}, force = false, full = text) {
  if (!self.beat) return
  const at = await $.clock.now()
  await save($, { ...patch, timeline: pushCapped(self.beat.timeline, keepFull(event(at, kind, text), full), MAX_TIMELINE) }, force)
}

/** 한 세션의 흐름 원문 파일. 없거나 깨졌으면 빈 것 (그 줄은 장부의 줄로 복사한다) */
async function readFlow($: EngineInterface, dir: string, id: string): Promise<Record<string, string>> {
  try {
    const v: unknown = JSON.parse(await $.fs.read(`${dir}/${id}.flow`))
    return v && typeof v === 'object' ? (v as Record<string, string>) : {}
  } catch {
    return {}
  }
}

/** 흐름 줄을 누르면 원문을 클립보드로. 원문이 없으면 장부의 줄 */
async function copyFlow($: EngineInterface, id: string, at: number, kind: string, surface: RenderSurface): Promise<void> {
  const ev = (await read($, beats)).find(b => b.id === id)?.timeline.find(t => t.at === at && t.kind === kind)
  if (!ev || !self.dir) return
  const text = (await readFlow($, self.dir, id))[flowKey(ev)] ?? ev.text
  const r = await $.ui.copy({ text, surface })
  await $.ui.toast(r.isCopied ? '복사함' : `복사 못 함: ${r.reason}`)
}

async function scan($: EngineInterface): Promise<void> {
  if (!self.dir) return
  const gen = ++self.scanGen
  const entries = await $.fs.list(self.dir).catch(() => [])
  const now = await $.clock.now()
  const found: Beat[] = []
  for (const entry of entries) {
    // 12시간 넘은 원문 파일은 비운다. fs 에 삭제가 없어 '{}' 로 덮고, 이미 비었으면(2바이트) 두어 틱마다 다시 쓰지 않는다
    if (entry.kind === 'file' && entry.name.endsWith('.flow') && now - entry.mtimeMs >= HIDE_MS && entry.size > 2) {
      await $.fs.write(`${self.dir}/${entry.name}`, '{}')
      continue
    }
    if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
    // 어차피 숨길 오래된 기록은 읽지 않는다
    if (now - entry.mtimeMs >= HIDE_MS) continue
    try {
      found.push(normalize(JSON.parse(await $.fs.read(`${self.dir}/${entry.name}`))))
    } catch {
      // 쓰는 도중이거나 깨진 파일은 다음 틱에 다시 읽는다.
    }
  }
  // clock.every 는 앞 틱이 끝나기 전에도 다음 틱을 부른다. 그 사이 시작된 scan 이 있으면 이 결과는 낡았다 (경로선 깜빡임, 0.16.2)
  if (gen !== self.scanGen) return
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
    // 생각(thinking) 토큰도 이 한도 안에서 쓴다. 3000 이면 6항목 STE 답이 잘려 JSON 글자로 보였다 (0.15.0)
    const r = await $.model.complete({ model: 'haiku', prompt: explainPrompt(target, kind), maxTokens: 8000, timeoutMs: 120_000 })
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

/** 작업 폴더의 git 상태 (T34 B2). 턴 끝에 읽는다. git 저장소가 아니거나 git 이 없으면 null */
async function readGit($: EngineInterface, cwd: string): Promise<Beat['git']> {
  const run = (args: string[]) => $.process.run(['git', '-C', cwd, ...args], { timeoutMs: 3000 }).catch(() => null)
  const st = await run(['status', '--porcelain=v1', '-b'])
  const s = st?.exitCode === 0 ? parseGitStatus(st.stdout) : null
  if (!s) return null
  const d = s.files ? await run(['diff', '--shortstat', 'HEAD']) : null
  return { ...s, ...parseShortstat(d?.exitCode === 0 ? d.stdout : ''), at: await $.clock.now() }
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
  '  /board <세션>              자세히: 할 일, 보조 에이전트, 결정 기록 전체, 흐름, 편집 파일   예) /board sub-2',
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
  '결정 대기 알림 (소리는 macOS 음성·chime, OS 알림은 preferredNotifChannel)',
  '  /board sound off | on      끄기 / 켜기 (기본 켜짐)',
  '  /board sound test          미리 듣기, OS 알림이 나가는지 확인',
  '',
  '숨은 실패 (exit 0 인데 실패한 빌드·테스트)',
  '  /board fail                보고서',
  '  /board fail clear          이 세션 표시 지우기',
  '  /board fail off | on       감지 끄기 / 켜기',
].join('\n')

const TITLE_EVERY_MS = 15_000

/**
 * /clear·/resume 뒤에는 세션 id 와 대화 기록 파일이 바뀐다. 바뀌었으면 따라간다.
 * /clear 는 같은 대화가 이어지므로 직접 정한 이름(/board name, /rename)을 새 id 로 옮긴다.
 * /resume 은 다른 대화로 옮긴 것이라 그 대화의 이름을 쓴다.
 */
async function followSessionId($: EngineInterface): Promise<void> {
  if (!self.sessionId) return
  const id = await $.session.id()
  if (!id || id === self.sessionId) return
  const resumed = self.switchReason === 'resume'
  self.switchReason = ''
  const pinned = await $.store.get(nameKey(self.sessionId))
  if (!resumed && typeof pinned === 'string' && pinned) await $.store.set(nameKey(id), pinned)
  self.transcript = self.transcript.replace(`${self.sessionId}.jsonl`, `${id}.jsonl`)
  self.sessionId = id
  self.titleCheckedAt = 0
  self.titleDone = false
  if (resumed && self.beat) {
    const repo = await $.session.repo()
    const name = await defaultName($, self.beat.cwd, repo?.root ?? null)
    if (name !== self.beat.name) {
      await save($, { name }, true)
      await scan($)
    }
  }
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
  // 음성은 몇 초 걸리므로 OS 알림을 먼저 (T34 A2). 기본 설정의 Orca·Warp 는 no-channel 이라 소리를 대신하지 않고 덧붙인다
  await notifyOs($, `${b.name}: ${questionSummary(b.question)}`)
  await announce($, `${b.name} 세션이 결정을 기다립니다`)
}

/** OS 알림 (T34 A2): 사용자의 preferredNotifChannel 로. 나간 채널 또는 안 나간 이유를 한 줄로 돌려준다 */
async function notifyOs($: EngineInterface, text: string): Promise<string> {
  const r = await $.ui.notify(text, { title: 'team-board 결정 대기' }).catch((err: unknown) => ({ isSent: false as const, reason: err instanceof Error ? err.message : String(err) }))
  return r.isSent ? `OS 알림: 보냄 (${r.channel})` : `OS 알림: 안 나감 (${r.reason})`
}

const NOTIFY_HINT = 'OS 알림을 받으려면 ~/.claude/settings.json 에 "preferredNotifChannel" 을 터미널에 맞게 넣으세요: iterm2, kitty, ghostty, 또는 벨만 울리는 terminal_bell. 기본값(auto)에서 Orca·Warp 는 알림 채널이 없습니다.'

// 이 기기의 소리 재생 방식. 처음 울릴 때 한 번 정한다
let soundOsOf: SoundOs | null = null

async function announce($: EngineInterface, text: string): Promise<void> {
  const root = $.plugin.root
  soundOsOf ??= soundOs(root, /^[A-Za-z]:/.test(root) ? '' : ((await $.process.run(['uname', '-s'], { timeoutMs: 2000 }).catch(() => null))?.stdout ?? ''))
  if (soundOsOf !== 'mac') {
    // 알림은 부가 기능이라 플레이어가 없으면 조용히 건너뛴다. 음성(say)은 macOS 에만 있다
    for (const c of soundCommands(soundOsOf, `${root}/sounds/chime.wav`)) {
      const r = await $.process.run(c.argv, { ...(c.env ? { env: c.env } : {}), timeoutMs: 5000 }).catch(() => null)
      if (r?.exitCode === 0) return
    }
    return
  }
  await $.audio.play({ asset: 'sounds/chime.wav' }).catch(() => undefined)
  // 한국어 목소리(Yuna)가 없으면 기본 목소리로
  await $.audio
    .speak(text, { voice: 'Yuna' })
    .catch(() => $.audio.speak(text))
    .catch(() => undefined)
}

export const register: Register = (on, options) => {
  const pal = paletteOf(options.palette)

  // 알약 막대 한 줄 (T24 B안). Text 는 그리는 화면의 것. 채움 선은 상태색을 카드 바탕 쪽으로 조금 흐리게.
  // 알약은 상태색을 카드 바탕 쪽으로 30% 어둡게 칠해 위 줄의 배지(상태색 그대로)와 구분한다 (T27 D2).
  // 이름 색 팔레트(theme)는 섞을 수 없어 채움은 흐린 글자(dimColor), 알약은 상태색 그대로 (밝은 테마 실화면)
  const PILL_HUE: Record<PillTone, string> = { run: pal.work, ask: pal.ask, err: pal.bad, ok: pal.ok, stop: pal.ask }
  const pillBg = (tone: PillTone) => mix(PILL_HUE[tone], pal.card || '#000000', 0.3)
  const pillOf = (Text: any, pb: PillBar) => (
    <Text wrap="truncate-end">
      <Text color={pal.dim}>{pb.cap}</Text>
      <Text color={mix(PILL_HUE[pb.tone], pal.card || '#000000', 0.2)} dimColor={!pal.isRaw}>{pb.fill}</Text>
      <Text backgroundColor={pillBg(pb.tone)} color={pal.onBadge} bold>{pb.pill}</Text>
      <Text color={mix(pal.dim, pal.card || '#000000', 0.3)}>{pb.rest}</Text>
      <Text color={PILL_HUE[pb.tone]} bold>{`  ${pb.pct}%`}</Text>
    </Text>
  )
  // 막대 아래 보조 에이전트 한 줄
  const stripOf = (Text: any, r: Strip, width: number) => {
    if ('more' in r) return <Text color={pal.dim} wrap="truncate-end">{`↳ +${r.more} 보조 ${r.more}개 · ${r.done}개 끝남`}</Text>
    const f = fitStrip(r, width)
    return (
      <Text wrap="truncate-end">
        <Text color={pal.dim}>{`↳ ${r.n} `}</Text>
        <Text color={r.status === 'working' ? pal.text : pal.dim}>{f.label}</Text>
        {f.model ? <Text color={pal.dim}>{` (${f.model})`}</Text> : null}
        {f.tool ? <Text color={r.status === 'failed' ? pal.bad : pal.work}>{`  ${f.tool}`}</Text> : null}
        <Text color={pal.dim}>{`  ${r.time}`}</Text>
      </Text>
    )
  }

  on('session.start', async ($, e, next) => {
    const result = await next(e)

    self.interactive = e.isInteractive === true
    const cwd = await $.session.cwd()
    const repo = await $.session.repo()
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? cwd
    self.dir = `${home}/.claude/team-board/${repoKey(repo?.root ?? cwd)}`
    self.root = repo?.root ?? cwd
    // 세션 id 가 같은 프로세스가 둘일 수 있어(재개, 상위 세션이 띄운 세션) 프로세스마다 꼬리표를 붙인다.
    // 모듈이 다시 로드된 경우(플러그인 갱신, 엔진 작업자 재시작)엔 같은 세션 기록을 이어 쓴다.
    self.sessionId = await $.session.id()
    self.titleDone = false
    self.failOff = (await $.store.get(FAIL_KEY)) === true
    self.transcript = `${home}/.claude/projects/${projectDirName(cwd)}/${self.sessionId}.jsonl`
    const prev = await read($, me)
    self.beat = prev
      ? { ...prev, state: prev.state === 'ended' ? 'idle' : prev.state }
      : { ...emptyBeat(`${self.sessionId}-${crypto.randomUUID().slice(0, 8)}`, await defaultName($, cwd, repo?.root ?? null), cwd), startedAt: await $.clock.now() }
    // 앞서 남긴 원문을 이어 쓴다 (없으면 처음부터)
    self.flow = prev ? await readFlow($, self.dir, self.beat.id) : {}
    // 다시 시작했으면 앞 프로세스의 보조 에이전트는 끝났다. 모듈만 다시 로드됐으면 엔진 목록에 남아 있다
    if (self.beat.agents.some(a => a.status === 'working')) {
      const infos = await $.agent.list().catch(() => null)
      if (infos) self.beat.agents = agentGone(self.beat.agents, infos, await $.clock.now())
    }
    await save($, {}, true)
    // 모듈이 다시 로드되기 전에 work-plan 이 써 둔 계획
    await syncPlan($)
    await scan($)
    await update($, bandOff, () => false)
    if ((await $.store.get(BAND_KEY)) === true) await update($, bandOff, () => true)
    const mode = await $.store.get(BAND_MODE_KEY)
    await update($, bandMode, (): 'hud' | 'line' => (mode === 'line' ? 'line' : 'hud'))
    const soloOff = (await $.store.get(BAND_SOLO_KEY)) === true
    await update($, bandSoloOff, () => soloOff)

    $.clock.every(TICK_MS, async () => {
      const stale = (await $.clock.now()) - self.lastWrite > HEARTBEAT_MS
      await syncAgents($)
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
      self.switchReason = e.reason
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
    const text = typeof e.text === 'string' ? unwrapPaste(e.text).trim() : ''
    // next(e) 안에서 턴이 시작되며 결정 대기 상태가 지워지므로, 넘기기 전에 기록한다.
    // ' /lookback' 처럼 앞에 공백이 있으면 엔진이 일반 메시지로 보낸다. 그래서 / 는 다듬기 전 글로 본다
    if (text && !e.text.startsWith('/') && self.beat && USER_ORIGINS.has(e.origin.kind)) {
      const at = await $.clock.now()
      const b = self.beat
      const kept = { decisions: b.decisions, timeline: b.timeline, question: b.question, prompt: b.prompt, promptAt: b.promptAt, state: b.state, step: b.step, recent: b.recent }
      const keptAsking = { undo: self.undo, htmlKeep: self.htmlKeep, askingSince: self.askingSince }
      let { decisions, timeline } = self.beat
      self.undo = null
      if (self.beat.state === 'asking' && self.beat.question) {
        const d = { at, question: questionSummary(self.beat.question), answer: oneLine(text, 120) }
        const decide = keepFull(event(at, 'decide', `${d.question} → ${d.answer}`), `${d.question} → ${text}`)
        self.undo = { question: self.beat.question, decisions, decide }
        decisions = pushCapped(decisions, d, MAX_DECISIONS)
        timeline = pushCapped(timeline, decide, MAX_TIMELINE)
      }
      timeline = pushCapped(timeline, keepFull(event(at, 'prompt', text), text), MAX_TIMELINE)
      // 결정과 새 요청을 한 번에 쓴다. 답을 보냈으니 더 이상 결정 대기가 아니다.
      self.htmlKeep = ''
      self.beat.agents = agentClearEnded(self.beat.agents)
      self.failRun = { key: '', count: 0 }
      self.lastTool = ''
      await save($, { decisions, timeline, question: '', prompt: oneLine(text, 100), promptAt: at, state: 'working', step: '생각 중', stuck: null }, true)
      // 다른 mod 가 보내기를 막았으면(drop) 요청도 답도 아니다. 넘기기 전 상태로 되돌린다
      const r = await next(e)
      if (r.drop !== undefined) {
        self.flowDirty = true
        await save($, kept, true)
        Object.assign(self, keptAsking)
      }
      return r
    } else if (e.origin.kind === 'plugin' && e.origin.name === 'team-board' && self.beat?.state === 'asking' && self.beat.question) {
      // HTML 버튼이 보낸 요청: 결정은 아직 남아 있다
      self.htmlKeep = self.beat.question
    } else if (e.origin.kind === 'task-notification' && self.beat) {
      // 뒤에서 돈 보조 에이전트의 토큰은 엔진이 작업 알림에 적어 준 수를 쓴다
      for (const n of notificationTokens(text)) await setAgents($, list => agentPatch(list, n.id, a => ({ ...a, tokens: n.tokens })), true)
    }
    return next(e)
  })

  // CLI 2.1.304 부터 작업 알림은 prompt.submit 을 거치지 않고 대화 기록에만 붙는다(턴 없음). 엔진이 센 토큰을 여기서도 읽는다
  on('session.append', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && self.beat && e.message.type === 'user') {
      const text = e.message.content.map(b => (b.type === 'text' ? b.text : '')).join('\n')
      if (text.includes('<subagent_tokens>'))
        for (const n of notificationTokens(text)) await setAgents($, list => agentPatch(list, n.id, a => ({ ...a, tokens: n.tokens })), true)
    }
    return r
  }).catch(($, e, next) => next(e)) // 토큰 표시가 실패해도 기록은 그대로 남는다

  // work-plan 이 계획을 쓰면 할 일로 옮긴다. 기록이 끝난 뒤에 읽고, 쓰기가 거절됐으면 무시한다.
  // 도구 호출 관찰과 달리 hook 순서와 상관없이 불린다.
  on('state.set', { plugin: 'work-plan', key: 'plan' }, async ($, e, next) => {
    const r = await next(e)
    if ('value' in r && r.value?.isSet) await syncPlan($, e.value)
    return r
  }).catch(($, e, next) => next(e)) // 표시가 실패해도 work-plan 의 기록은 그대로 선다

  // prompt-coach 가 질문의 답을 기다리면 결정 필요로 보인다. 입력창을 채우면 null 이 오고 앞 상태로 돌아간다.
  // prompt-coach 가 없으면 오지 않는다. 계획 관찰처럼 hook 순서와 상관없다
  on('state.set', { plugin: 'prompt-coach', key: 'pending' }, async ($, e, next) => {
    const r = await next(e)
    if ('value' in r && r.value?.isSet) await coachPending($, typeof e.value === 'string' ? e.value : null)
    return r
  }).catch(($, e, next) => next(e)) // 표시가 실패해도 prompt-coach 의 기록은 그대로 선다

  on('turn.start', async ($, e, next) => {
    // 보조 에이전트의 시작도 여기로 온다. 메인을 작업 중으로 바꾸지 않는다
    if (e.agentId) return next(e)
    await save($, { state: 'working', step: '생각 중', question: '' })
    return next(e)
  })

  // 메인 스레드의 모델 요청마다 프롬프트 캐시 수명이 다시 시작된다. 서브에이전트 요청은 다른 prefix 다.
  // 도구 호출 기록처럼 1.5초에 한 번까지만 쓰고, 미룬 것은 다음 틱에 쓴다.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) await save($, { cacheAt: await $.clock.now() })
    return yield* next(e)
  })

  // 보조 에이전트(서브에이전트·워크플로·팀원)의 시작. 관찰만 하므로 실패해도 띄우기를 막지 않는다
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (!r.agentId || !self.beat) return r
    const desc = e.workflow ? `워크플로 ${e.workflow.agentIndex + 1}` : e.description || e.name || ''
    const type = e.workflow ? 'workflow' : e.isTeammate ? 'teammate' : e.subagentType || 'agent'
    const id = r.agentId
    const at = await $.clock.now()
    await setAgents($, list => agentStart(list, { id, desc, type, model: r.model, at }), true)
    return r
  }).catch(($, e, next) => next(e))

  // compact 뒤에는 대화 앞부분이 바뀌어 캐시가 없다. 다음 메인 요청에서 다시 잰다.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) await save($, { cacheAt: null }, true)
    return r
  })

  // 숨은 실패: exit 0 인데 출력에 실패 흔적. 같은 명령이 깨끗하게 다시 돌면 지운다.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    // 돈 명령의 오류는 'Exit code N' 으로 시작한다. 돌지 않은 것(auto 모드 분류기 판정 없음, 권한·사용자 거절, 다른 hook 오류)은 검증도 실패도 아니다
    const didRun = ran.isError !== true || /^Exit code \d+/.test(ran.text ?? '')
    // 중단했거나 백그라운드로 시작만 한 것은 끝난 검증이 아니다
    const ended = ran.isError === true || !ran.result || !(ran.result.interrupted || ran.result.backgroundTaskId !== undefined)
    // 검증 명령을 끝까지 돌렸으면(통과·실패와 상관없이) 검증 없음을 지운다 (T34 B1)
    if (ran.deny === undefined && didRun && ended && isVerify(e.command)) {
      self.unchecked.clear()
      if (self.beat?.unverified) await save($, { unverified: null }, true)
    }
    // 같은 실패 반복 (T34 A4): 메인이 수정 없이 같은 명령을 3번 연속 실패. 3번째에 Claude 에게 한 줄, 카드에 막힘. 돌지 않은 것은 세지도 끊지도 않는다
    if (!e.agentId && self.beat && ran.deny === undefined && didRun) {
      const key = commandKey(e.command) || oneLine(e.command, 60)
      if (ran.isError === true) {
        self.failRun = key === self.failRun.key ? { key, count: self.failRun.count + 1 } : { key, count: 1 }
        if (self.failRun.count >= 3) {
          const at = await $.clock.now()
          await save($, { stuck: { at, key, count: self.failRun.count } }, true)
          if (self.failRun.count === 3) {
            const memo = `team-board: \`${key}\` 이(가) 코드 수정 없이 3번 연속 실패했습니다. 같은 시도를 되풀이하지 말고 원인을 다시 보거나 다른 방법을 쓰거나, 막혔으면 사용자에게 물으세요.`
            return { ...ran, context: [...(ran.context ?? []), memo] }
          }
        }
      } else if (key === self.failRun.key) {
        self.failRun = { key: '', count: 0 }
        if (self.beat.stuck) await save($, { stuck: null }, true)
      }
    }
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
      // 질문은 도구 입력에만 있고, 앞선 안내 글은 직전 대화로 둔다
      self.lastRecent = recentTurns(await $.session.messages(), false)
      await note($, 'ask', asked.split('\n')[0] ?? '', { state: 'asking', step: '질문 중', question: asked, recent: self.lastRecent, lastTool: self.lastTool }, true, asked)
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
        await save($, { tasks, planEnded: false, planStartAt: undefined, step: cur ? `할 일: ${cur.subject}` : describeTool(e.tool, input) })
      }
      return r
    }

    if (e.tool === PLAN_TOOL) return next(e)

    const step = describeTool(e.tool, input)
    if (main) self.lastTool = step
    if (EDIT_TOOLS.has(e.tool) && main) self.failRun = { key: '', count: 0 }
    if (EDIT_TOOLS.has(e.tool)) {
      const p = touchPath(self.root, String(input.file_path ?? input.notebook_path ?? ''))
      if (needsVerify(p)) {
        self.unchecked.add(p)
        self.uncheckedAt = await $.clock.now()
      }
    }
    if (EDIT_TOOLS.has(e.tool) && main && self.beat) {
      const full = String(input.file_path ?? input.notebook_path ?? '')
      const file = basename(full)
      const files = [file, ...self.beat.files.filter(f => f !== file)].slice(0, 12)
      const path = touchPath(self.root, full)
      const now = await $.clock.now()
      const touched = pushTouch(self.beat.touched ?? [], path, now)
      await save($, { step, edits: self.beat.edits + 1, files, touched })
      // 같은 파일을 다른 세션도 1시간 안에 고쳤으면 Claude 에게 한 번 알린다 (T34 D1). 세션 목록은 3초마다 읽은 것
      const told = overlaps(self.beat, await read($, beats), now).filter(o => o.path === path && !self.overlapTold.has(`${path}|${o.name}`))
      if (!told.length) return next(e)
      for (const o of told) self.overlapTold.add(`${path}|${o.name}`)
      const r = await next(e)
      if (r.deny !== undefined) return r
      const memo = `team-board: 같은 저장소의 다른 세션도 이 파일(${path})을 최근에 고쳤습니다: ${told.map(o => `${o.name} ${ago(now - o.at)}`).join(', ')}. 같은 부분을 고치고 있지 않은지 확인하세요 (git diff, /board ${told[0]!.name}).`
      return { ...r, context: [...(r.context ?? []), memo] }
    } else if (main) {
      await save($, { step })
    } else if (self.beat && e.agentId) {
      // 보조 에이전트의 도구는 메인 단계를 덮지 않고 그 에이전트 줄에만 쓴다
      const id = e.agentId
      await setAgents($, list => agentPatch(list, id, a => ({ ...a, tool: step })))
    }
    if (e.tool === 'Agent' && main) {
      // 앞에서 돈 보조 에이전트는 도구 결과에 엔진이 센 토큰이 온다 (뒤에서 도는 것은 async_launched 라 없다)
      const r = await next(e)
      const out = (r as { result?: { agentId?: unknown; totalTokens?: unknown } }).result
      const id = out?.agentId
      const tokens = out?.totalTokens
      if (typeof id === 'string' && typeof tokens === 'number') await setAgents($, list => agentPatch(list, id, a => ({ ...a, tokens })), true)
      return r
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId) {
      const reason = (e as { reason?: string }).reason
      const ok = !e.isAborted && reason !== 'error' && reason !== 'refusal'
      const id = e.agentId
      const at = await $.clock.now()
      await setAgents($, list => agentEnd(list, id, ok, at), true)
      return r
    }

    const usage = await $.session.usage().catch(() => null)
    const contextPct = usage?.context?.percent ?? null
    // 작업 폴더의 git 상태 (T34 B2)와 고친 코드를 검증 없이 턴이 끝났는지 (T34 B1). 아래 어느 쪽 기록에도 함께 쓰인다
    if (self.beat) self.beat.git = await readGit($, self.beat.cwd)
    if (self.beat) self.beat.unverified = self.unchecked.size ? { at: self.uncheckedAt, files: self.unchecked.size } : null
    const answer = 'answer' in e && typeof e.answer === 'string' ? e.answer : ''
    const undo = self.undo
    self.undo = null

    // 결정의 답으로 보낸 요청을 아무 진행 없이 중단했다: 그 결정을 지우고 같은 질문의 결정 대기로 돌아간다
    if (undo && e.isAborted && !answer && self.beat) {
      const at = await $.clock.now()
      const kept = self.beat.timeline.filter(t => !(t.kind === 'decide' && t.at === undo.decide.at && t.text === undo.decide.text))
      const timeline = pushCapped(kept, event(at, 'abort', '중단됨'), MAX_TIMELINE)
      await save($, { state: 'asking', step: '', contextPct, question: undo.question, recent: self.lastRecent, decisions: undo.decisions, timeline }, true)
      await syncPlan($)
      return r
    }
    // HTML 요청 턴(중단 포함)이 끝나면 결정 대기로 되돌린다. 답(링크)은 질문으로 보지 않는다
    if (self.htmlKeep) {
      const question = self.htmlKeep
      self.htmlKeep = ''
      await save($, { state: 'asking', step: '', contextPct, question, recent: self.lastRecent }, true)
      await syncPlan($)
      return r
    }
    if (e.isAborted || !answer) {
      await note($, 'abort', '중단됨', { state: 'idle', step: '', contextPct, last: '중단됨' })
    } else if (looksLikeQuestion(answer)) {
      const q = questionText(answer)
      self.lastRecent = recentTurns(await $.session.messages(), true)
      await note($, 'ask', questionSummary(q), { state: 'asking', step: '', contextPct, last: oneLine(answer, 100), question: q, recent: self.lastRecent }, false, q)
    } else {
      await note($, 'done', answer, { state: 'idle', step: '', contextPct, last: oneLine(answer, 100), question: '' })
    }
    await syncPlan($)
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
        const sent = await notifyOs($, `${self.beat?.name ?? '이'}: 알림 시험`)
        await announce($, `${self.beat?.name ?? '이'} 세션이 결정을 기다립니다`)
        return { text: `알림 소리를 재생했어요. 음성은 macOS 에서만, chime 은 Windows(PowerShell)·Linux(paplay 또는 aplay)에서도 들립니다.\n${sent}${sent.includes('안 나감') ? `\n${NOTIFY_HINT}` : ''}` }
      }
      const off = rest[0] === 'off'
      await $.store.set(SOUND_KEY, off)
      return { text: off ? '결정 대기 알림(소리·OS 알림)을 껐어요.' : '결정 대기 알림을 켰어요. 결정을 20초 넘게 기다리면 그 세션이 소리와 OS 알림으로 알려 줍니다. OS 알림이 나가는지는 /board sound test' }
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
    const opened = await $.ui.open({ id: PANE, title: '팀 상황판', focus: true, closeOnEscape: true })
    // 열렸지만 그려지지 않으면 엔진이 준 이유를 그대로 보여 준다
    if (!opened.isPlaced) return { text: `팀 상황판을 그리지 못했어요: ${opened.reason}` }
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
    const flowPress = /^flow-(.+)-(\d+)-([a-z]+)$/.exec(key)
    if (tabKey) await pressExplain($, tabKey[1] as 'tab' | 'regen', tabKey[2] as ExplainKind, tabKey[3]!)
    else if (key.startsWith('html-')) await pressHtml($, key.slice('html-'.length))
    else if (key.startsWith('detail-')) await update($, focus, () => key.slice('detail-'.length))
    else if (key === 'back') await update($, focus, () => null)
    else if (flowPress) await copyFlow($, flowPress[1]!, Number(flowPress[2]), flowPress[3]!, e.surface)
    else if (key === 'band-board') await $.command.run({ command: 'board', args: '' })
    else if (key.startsWith('view-')) {
      // 보조 대화 보기 (T34 D3): 사람이 누른 것이라 엔진이 보기를 옮긴다. 안 되면 엔진이 준 이유를 그대로
      const agentId = key === 'view-main' ? undefined : key.slice('view-'.length)
      // $.ui.view 는 CLI 2.1.300 부터: 그 전 엔진의 거절도 이유로 보인다
      const r = await $.ui.view(agentId ? { agentId } : {}).catch((err: unknown) => ({ deny: err instanceof Error ? err.message : String(err) }))
      if (r.deny) await $.ui.toast(`${agentId ? '보조 대화' : '메인 대화'}를 열지 못했어요: ${r.deny}`)
    }
    else return next(e)
    return { element: key }
  })

  // 입력창 위 띠: 다른 mod 의 띠 아래에 붙인다 (가리지 않음).
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || (await read($, bandOff))) return next(e)
    const now = await $.clock.now()
    const list = visible(withMe(await read($, beats), await read($, me)), now)
    const below = await next(e)
    // 세션 하나: /board band solo off 면 숨김 (기본은 보임)
    if (!list.length || (list.length < 2 && (await read($, bandSoloOff)))) return below

    const { Box, Text, Button } = $.ui.resolve(e)
    const asking = list.filter(b => b.state === 'asking' && !isStale(b, now)).length
    const tone = (b: Beat) => (isStale(b, now) ? pal.dim : b.state === 'asking' ? pal.ask : b.state === 'working' || waitsOnAgents(b) ? pal.work : pal.dim)
    const markOf = (b: Beat) => (isStale(b, now) ? '·' : b.state === 'asking' ? '⚑' : b.state === 'working' ? '●' : waitsOnAgents(b) ? '◐' : '○')
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
    // 대기는 보조 기다림을 빼고 센다
    const count = (st: Beat['state']) => list.filter(b => b.state === st && !isStale(b, now) && !(st === 'idle' && waitsOnAgents(b))).length
    // 팀 전체에서 지금 도는 보조 에이전트 수
    const helpers = list.filter(b => !isStale(b, now)).reduce((n, b) => n + agentCounts(b.agents).working, 0)
    const SEG = { done: pal.ok, now: pal.work, left: pal.dim, end: pal.text } as const

    const stateOf = (b: Beat) => {
      const stale = isStale(b, now)
      const hot = b.state === 'asking' && !stale
      const bad = !hot && failed(b)
      const cool = !stale && !hot && !bad && cacheWarn(b, now)
      return { stale, hot, bad, cool }
    }
    // 이름 앞 상태 배지: 폭 6칸으로 같아서 칸마다 이름 시작 위치가 맞는다
    const badgeOf = (b: Beat) => {
      const s = stateOf(b)
      const [text, bg, fg] = s.stale ? ['  zz  ', pal.frame, pal.dim]
        : s.hot ? [' 결정 ', pal.ask, pal.onBadge]
          : s.bad ? [' 실패 ', pal.bad, pal.onBadge]
            : b.state === 'working' ? [' 작업 ', pal.work, pal.onBadge]
              : waitsOnAgents(b) ? [' 보조 ', pal.work, pal.onBadge]
              : s.cool ? [' 캐시 ', pal.ask, pal.onBadge]
                : [' 대기 ', pal.dim, pal.onBadge]
      return <Text backgroundColor={bg} color={fg} bold>{text}</Text>
    }
    const minutesOf = (b: Beat) => <Text color={pal.ask}>{cacheMinutes(cacheLeft(b.cacheAt, now)!)}</Text>

    // 띠 칸의 알약 막대. 결정·실패는 secondOf 가 먼저 글로 보이므로 여기는 작업·멈춤·끝남만. 좁으면 null (경로선으로)
    const pillBarOf = (b: Beat, width: number) => {
      const pb = pillBar(b.tasks, width - 8, pillToneOf(b, isStale(b, now)), turnTook(b.timeline))
      return pb ? pillOf(Text, pb) : null
    }

    const secondOf = (b: Beat, width: number) => {
      const hot = b.state === 'asking' && !isStale(b, now)
      const bad = !hot && failed(b)
      const { done, total } = progress(b.tasks)
      return hot
        ? <Text color={pal.ask} wrap="truncate-end">{questionSummary(b.question)}</Text>
        : bad
          ? <Text color={pal.bad} wrap="truncate-end">{signLine(b.fail!.signs[0] ?? b.fail!.key)}</Text>
        : total
          ? pillBarOf(b, width) ?? (
              <Text wrap="truncate-end">
                {routeLine(b.tasks, Math.max(8, width - 8)).map(sg => <Text color={SEG[sg.tone]}>{sg.text}</Text>)}
                <Text color={pal.text}>{` ${done}/${total}`}</Text>
              </Text>
            )
          : waitsOnAgents(b)
            ? <Text color={pal.work} wrap="truncate-end">{`보조 ${agentCounts(b.agents).working}개 기다리는 중`}</Text>
          : <Text color={b.state === 'working' ? pal.work : pal.dim} wrap="truncate-end">{b.state === 'working' ? b.step || '생각 중' : b.last || b.prompt || '새 요청 대기'}</Text>
    }

    // 결정 칸: 바탕은 다른 칸과 같고 왼쪽 여백 자리에 노란 막대 ▌. 배지 노랑 · 이름 흰 글자 · 질문 노란 글자로 나눈다
    // (T32: 칸 전체를 노랗게 칠하면 배지·이름·질문이 한 색이라 구분되지 않았다)
    const slot = (b: Beat) => {
      const { hot, cool } = stateOf(b)
      return (
        <Box
          key={`slot-${b.id}`}
          width={slotW}
          flexDirection="row"
          paddingLeft={hot ? 0 : 1}
          paddingRight={1}
          {...(pal.card ? { backgroundColor: isMe(b) ? pal.frame : pal.card } : {})}
        >
          {hot ? (
            <Box width={1} flexShrink={0} flexDirection="column">
              <Text color={pal.ask}>▌</Text>
              {layout.mode === 'full' ? <Text color={pal.ask}>▌</Text> : null}
            </Box>
          ) : null}
          <Box flexDirection="column" flexGrow={1} flexShrink={1}>
            <Box flexDirection="row" columnGap={1}>
              <Box flexShrink={0}>{badgeOf(b)}</Box>
              <Text color={hot ? pal.text : tone(b)} bold wrap="truncate-end">
                {`${b.name}${isMe(b) ? '*' : ''}`}
              </Text>
              {cool ? <Box flexShrink={0}>{minutesOf(b)}</Box> : null}
            </Box>
            {layout.mode === 'full' ? <Box>{secondOf(b, slotW)}</Box> : null}
          </Box>
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
            {helpers ? <Text color={pal.work} bold>{`보조 ${helpers}`}</Text> : null}
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
              <Box flexShrink={1}>{secondOf(b, Math.min(64, slotW - 40))}</Box>
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

  // 결정 질문 대화상자 위 맥락 (T34 A1): 무엇을 하던 중에 왜 묻는지. 엔진 노드는 한 번, 아래에는 아무것도 두지 않는다.
  // 터미널은 대화상자 둘레 12줄까지(40칸마다 한 줄로 셈, 넘으면 엔진 것만 그려진다 — 탐침). 줄마다 78칸으로 잘라 머리 1 + 3×2 = 7줄 안
  on('ui.render', { component: 'AskUserQuestion' }, async ($, e, next) => {
    const node = await next(e)
    const b = self.beat
    if (!b) return node
    const plan = tasksFromPlan(await read($, workPlan))
    const lines = askContext(b, plan && !plan.ended ? plan.tasks : b.tasks)
    if (!lines.length) return node
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Text color={pal.ask} bold>◆ 결정 맥락 · team-board</Text>
        {lines.map(l => (
          <Text color={l.startsWith('직전') ? pal.dim : pal.text}>{l}</Text>
        ))}
        {node}
      </Box>
    )
  })

  // 턴이 도는 동안 프롬프트 위 Spinner 줄에 지금 단계 (T24): `2/5 테스트 실행…` (지금 단계의 순번/전체). 경과·토큰은 엔진이 그대로 붙인다.
  // 엔진이 자기 상태 문구(message)를 띄운 동안은 두고, 계획이 없거나 지금 단계가 없으면 손대지 않는다.
  // work-plan atom 을 읽어 보고가 오면 바로 다시 그린다 (할 일 도구로 만든 목록이면 세션 상태의 것).
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.props.message !== null) return next(e)
    const r = tasksFromPlan(await read($, workPlan))
    // 끝난 계획은 새 보고 전까지 이 턴의 단계가 아니다 (T27)
    if (r?.ended) return next(e)
    const tasks = r?.tasks ?? self.beat?.tasks ?? []
    const { total, current } = progress(tasks)
    if (!current) return next(e)
    return next({ ...e, props: { ...e.props, message: `${tasks.indexOf(current) + 1}/${total} ${current.subject}` } })
  })

  // /board 패널: 전체 보기 또는 한 세션 자세히
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Raster = 'Raster' in els ? els.Raster : undefined
    const now = await $.clock.now()
    const list = visible(withMe(await read($, beats), await read($, me)), now)
    const ex = await read($, explain)
    const steEx = await read($, steExplain)
    const tabNow = await read($, tab)
    const jobs = await read($, queue)
    const htmlSent = await read($, html)
    const focusId = await read($, focus)
    const folded = await read($, collapsed)
    const focused = focusId ? list.find(b => b.id === focusId) : undefined
    const cols = Math.max(30, e.props.bodyColumns ?? 60)
    const noop = () => {}

    const stateTone = (b: Beat) =>
      isStale(b, now) ? pal.dim : b.state === 'asking' ? pal.ask : b.fail?.level === 'high' ? pal.bad : b.state === 'working' || waitsOnAgents(b) ? pal.work : pal.frame

    // 자세히의 할 일 한 줄 (T25, plan-progress 띠 모양): 줄 끝까지 상태색을 옅게 깐 바탕, 점, 순번, 이름, 오른쪽 끝 상태 글.
    // 이름 색 팔레트(theme)는 섞을 수 없어 바탕 없이 점과 끝 글 색으로만 나눈다
    const STRIP_HUE: Record<PillTone, string> = { run: pal.work, ask: pal.ask, err: pal.bad, ok: pal.ok, stop: pal.ask }
    const todoRowOf = (r: TodoStrip, width: number) => {
      const hue = r.tone === 'todo' ? pal.dim : STRIP_HUE[r.tone]
      const bg = r.tone !== 'todo' && pal.isRaw ? { backgroundColor: mix(hue, pal.card || '#000000', 0.78) } : {}
      const head = ` ● ${r.n}  `
      const tail = r.end ? `  ${r.end}${r.time ? ` ${r.time}` : ''} ` : ' '
      const room = Math.max(4, width - widthOf(head) - widthOf(tail))
      const label = widthClip(r.label, room)
      return (
        <Text key={`todo-${r.n}`} wrap="truncate-end">
          <Text color={hue} {...bg}>{' ● '}</Text>
          <Text color={pal.dim} {...bg}>{`${r.n}  `}</Text>
          <Text color={pal.text} {...bg}>{label + ' '.repeat(Math.max(0, room - widthOf(label)))}</Text>
          <Text color={hue} {...bg}>{tail}</Text>
        </Text>
      )
    }

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
      const cache = b.cacheAt != null ? cacheText(cacheLeft(b.cacheAt, now)) : null
      const hot = cacheWarn(b, now)
      // 좁으면 배지가 두 줄로 깨지지 않게 오른쪽부터 덜어 낸다 (N2)
      const fit = headParts(rightWidth, { badge, name: b.name, me: b.id === self.beat?.id, pct: b.contextPct, cache, cacheHot: hot, ago: ago(now - b.updatedAt) })
      return (
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Box flexDirection="row" columnGap={1} flexShrink={1}>
            <Box flexShrink={0}>
              <Text backgroundColor={tone === pal.frame ? pal.dim : tone} color={pal.onBadge} bold>{` ${badge} `}</Text>
            </Box>
            <Text color={pal.text} bold wrap="truncate-end">{b.name}</Text>
            {fit.me ? <Box flexShrink={0}><Text color={pal.dim}>{fit.me}</Text></Box> : null}
          </Box>
          {fit.ctx || fit.cache || fit.ago ? (
            <Box flexDirection="row" columnGap={1} flexShrink={0}>
              {fit.ctx ? (
                <Text color={contextTone(b.contextPct, pal)}>
                  {b.contextPct === null ? 'ctx --' : fit.bar ? `ctx ${bar(b.contextPct, 100, 5)} ${b.contextPct}%` : `ctx ${b.contextPct}%`}
                </Text>
              ) : null}
              {fit.cache && cache ? <Text color={hot ? pal.ask : pal.dim}>{fit.ctx ? `· ${cache}` : cache}</Text> : null}
              {fit.ago ? <Text color={pal.dim}>{`· ${ago(now - b.updatedAt)}`}</Text> : null}
            </Box>
          ) : null}
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
      const stale = isStale(b, now)
      const pb = pillBar(b.tasks, Math.min(46, rightWidth - 6 - 6), pillToneOf(b, stale), turnTook(b.timeline))
      if (pb) return row('진행', pillOf(Text, pb))
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
      const kind = stale ? 'stale' : b.state === 'asking' || broke ? 'asking' : b.state === 'working' || waitsOnAgents(b) ? 'working' : 'idle'
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
          ? row('질문', <Text color={pal.ask} bold wrap="truncate-end">{questionSummary(b.question)}</Text>)
          : b.state === 'working' && b.step
            ? row('지금', <Text color={pal.work} wrap="truncate-end">{b.step}</Text>)
            : b.last
              ? row('최근', <Text color={pal.dim} wrap="truncate-end">{b.last}</Text>)
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
              {agentStrips(b.agents, now).map((r, i) => row(i === 0 ? '보조' : '', stripOf(Text, r, rightWidth - 6), `strip-${b.id}-${i}`))}
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

    // 같은 파일 겹침 (T34 D1): 가장 최근 것 하나와 남은 수
    const overlapRow = (b: Beat) => {
      if (isStale(b, now)) return null
      const os = overlaps(b, list, now)
      if (!os.length) return null
      const o = os[0]!
      return row('겹침', <Text color={pal.ask} wrap="truncate-end">{`⚠ ${o.path} · ${o.name} ${ago(now - o.at)}${os.length > 1 ? ` 외 ${os.length - 1}건` : ''}`}</Text>, `overlap-${b.id}`)
    }

    // 변경 요약 (T34 B2). 전체 보기에서는 다른 작업 폴더(워크트리)의 세션만: 같은 폴더면 모든 카드가 같은 줄이다
    const gitRow = (b: Beat, always: boolean) => {
      const text = b.git ? gitText(b.git) : ''
      if (!text || isStale(b, now) || (!always && b.cwd === self.beat?.cwd)) return null
      return row('변경', <Text color={pal.text} wrap="truncate-end">{text}</Text>, `git-${b.id}`)
    }

    // 같은 실패 반복 (T34 A4)
    const stuckRow = (b: Beat) => {
      const s = b.stuck
      if (!s || isStale(b, now)) return null
      return row('막힘', <Text color={pal.bad} wrap="truncate-end">{`✕ ${s.key} · 수정 없이 ${s.count}번 연속 실패`}</Text>, `stuck-${b.id}`)
    }

    // 검증 없음 (T34 B1)
    const uncheckedRow = (b: Beat) => {
      const u = b.unverified
      if (!u || isStale(b, now)) return null
      return row('검증', <Text color={pal.ask} wrap="truncate-end">{`△ 마지막 코드 수정 뒤 테스트·빌드 없음 · 파일 ${u.files} · ${ago(now - u.at)}`}</Text>, `unverified-${b.id}`)
    }

    // 복귀 요약 (T34 D2): 마지막 요청 뒤 무엇이 바뀌었나. 요청한 지 5분이 안 됐으면 보고 있던 참이라 뺀다
    const sinceRow = (b: Beat) => {
      const s = sinceLastPrompt(b)
      if (!s || now - s.at < 5 * 60_000) return null
      return row('그새', <Text color={pal.text} wrap="truncate-end">{sinceText(s, now)}</Text>, `since-${b.id}`)
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
      // 지금 이 결정이 필요한 이유 한 줄. 0.17 전에 만든 설명(상태는 모듈을 다시 불러와도 남는다)에는 why 가 없다
      const whyRow = (why: string | undefined) =>
        why ? (
          <Box flexDirection="row" marginBottom={1}>
            <Box width={10} flexShrink={0}><Text color={pal.onBadge} backgroundColor={pal.ask} bold>{' 왜 지금 '}</Text></Box>
            <Box flexGrow={1} flexShrink={1} paddingLeft={1}><Text color={pal.text} bold wrap="wrap">{why}</Text></Box>
          </Box>
        ) : null
      if (t.kind === 'ste' && steEx?.data) {
        return (
          <Box flexDirection="column" borderStyle="round" borderColor={t.hue} paddingX={1} marginTop={1}>
            {whyRow(steEx.data.why)}
            {steEx.data.items.map((it, i) => (
              <Box flexDirection="column" marginTop={i ? 1 : 0}>
                <Text color={pal.text} bold wrap="wrap">{`${i + 1}. ${it.title}`}</Text>
                {it.decide ? (
                  <Box flexDirection="row">
                    <Box width={2} flexShrink={0}><Text color={pal.work}>▶</Text></Box>
                    <Box flexGrow={1} flexShrink={1}><Text color={pal.text} bold wrap="wrap">{it.decide}</Text></Box>
                  </Box>
                ) : null}
                {/* 0.14 가 만들어 둔 설명(상태는 모듈을 다시 불러와도 남는다)에는 options 가 없다 */}
                {(it.options ?? []).map(op => {
                  // 이름 칸 폭은 항목에서 가장 긴 선택지 이름에 맞춘다: 문장이 같은 줄에서 시작한다.
                  // 좁아서 이름 칸이 글 칸을 누르면 이름을 위에 두고 글을 아래에 들여 쓴다 (N2)
                  const labelW = Math.max(...it.options.map(o => widthOf(o.label)))
                  return steStacked(labelW, artWidth) ? (
                    <Box flexDirection="column">
                      <Text color={pal.work} bold wrap="wrap">{`   ▸ ${op.label}`}</Text>
                      <Box flexDirection="column" paddingLeft={5}>
                        {op.ste.map(l => <Text color={pal.text} wrap="wrap">{l}</Text>)}
                      </Box>
                    </Box>
                  ) : (
                    <Box flexDirection="row">
                      <Box width={labelW + 7} flexShrink={0}><Text color={pal.work} bold>{`   ▸ ${op.label}`}</Text></Box>
                      <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                        {op.ste.map(l => <Text color={pal.text} wrap="wrap">{l}</Text>)}
                      </Box>
                    </Box>
                  )
                })}
                {it.suggest ? (
                  <Box flexDirection="row">
                    <Box width={2} flexShrink={0}><Text color={pal.ask}>★</Text></Box>
                    <Box flexGrow={1} flexShrink={1}><Text color={pal.ask} wrap="wrap">{it.suggest}</Text></Box>
                  </Box>
                ) : null}
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
          {whyRow(d.why)}
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

    // 탭 줄: [ 12살 ▴ ] ↻ │ [ ASD-STE100 ] ↻ │ [ HTML ]. 고른 탭은 배지처럼 색 바탕, ▴/▾ 는 고른 탭에만
    // (초점 반전이 걸린 고른 탭이 안 고른 탭처럼 보일 수 있어 기호로 구분한다).
    // 좁은 패널에서는 묶음(탭 + 그 ↻) 사이에서만 줄바꿈한다. │ 는 둘째 묶음부터 앞에 붙여 줄 끝에 남지 않게
    const tabRow = (b: Beat) => {
      const shown = hasAny(b)
      const bar = (k: string) => <Text key={`bar-${k}-${b.id}`} color={pal.dim}>│</Text>
      return (
        <Box key={`tabs-${b.id}`} flexDirection="row" columnGap={1} flexWrap="wrap">
          {TABS.map((t, i) => {
            const picked = shown && tabNow === t.kind
            return (
              <Box key={`tabgrp-${t.kind}-${b.id}`} flexDirection="row" columnGap={1} flexShrink={0}>
                {i > 0 ? bar(t.kind) : null}
                <Button key={`tab-${t.kind}-${b.id}`} plain onPress={noop}>
                  {picked ? (
                    <Text color={pal.onBadge} backgroundColor={t.hue} bold>{` ${t.label} ${folded.includes(b.id) ? '▾' : '▴'} `}</Text>
                  ) : (
                    <Text color={t.hue} bold>{`[ ${t.label} ]`}</Text>
                  )}
                </Button>
                {/* 재생성은 만든 탭에만, 만드는 중에는 숨긴다 (눌러도 무시되므로) */}
                {partOf(b, t.kind) && !makingOf(b, t.kind) ? <Button key={`regen-${t.kind}-${b.id}`} plain dimColor label=" ↻ " onPress={noop} /> : null}
              </Box>
            )
          })}
          <Box key={`tabgrp-html-${b.id}`} flexDirection="row" columnGap={1} flexShrink={0}>
            {bar('html')}
            {htmlSent && htmlSent.id === b.id && htmlSent.question === b.question ? (
              <Text color={pal.dim}>HTML 요청함</Text>
            ) : (
              <Button key={`html-${b.id}`} variant="secondary" label="HTML" onPress={noop} />
            )}
          </Box>
        </Box>
      )
    }

    const askBlock = (b: Beat, maxLines: number) => {
      if (b.state !== 'asking' || !b.question) return null
      const all = b.question.split('\n').filter(l => l.trim())
      const shown = all.slice(-maxLines)
      return (
        <Box flexDirection="column" marginTop={1}>
          <Text color={pal.ask} bold>⚑ 결정할 것</Text>
          {/* 질문은 보통 답변 끝에 있으니 끝부분을 보여준다 */}
          {all.length > maxLines ? <Text color={pal.dim}>{`│ … 앞 ${all.length - maxLines}줄 (자세히에서 전체)`}</Text> : null}
          {/* 줄을 직접 접어 접힌 줄에도 막대를 잇고 둘째 줄부터 내어 쓴다. 묻는 줄은 굵은 막대 ┃, 그 앞에 빈 줄 하나 (T32).
              접는 폭: 카드 안쪽(cols - 6) 에서 막대 칸 2 */}
          {shown.map((l, i) => {
            const asks = isAskingLine(l)
            return (
              <Box flexDirection="column" marginTop={asks && i > 0 && !isAskingLine(shown[i - 1]!) ? 1 : 0}>
                {wrapCells(l, cols - 8).map(part => (
                  <Box flexDirection="row">
                    <Box width={2} flexShrink={0}>
                      <Text color={pal.ask}>{asks ? '┃' : '│'}</Text>
                    </Box>
                    <Box flexGrow={1} flexShrink={1}>
                      <Text wrap="truncate-end" color={asks ? pal.ask : pal.text} bold={asks}>{part}</Text>
                    </Box>
                  </Box>
                ))}
              </Box>
            )
          })}
          {/* 질문과 탭 줄을 나눈다. 카드 테두리가 이미 노랑이라 흐리게. truncate 는 끝에 … 를 붙여서,
              줄바꿈시키고 한 줄 높이 Box 가 넘친 줄을 숨긴다 */}
          <Box key={`sep-${b.id}`} height={1} overflow="hidden" marginTop={1}>
            <Text color={pal.dim} wrap="wrap">{'─'.repeat(cols)}</Text>
          </Box>
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
          {e.props.view?.agentId ? (
            <Box marginBottom={1}>
              <Button key="view-main" label="← 메인 대화" onPress={noop} />
            </Box>
          ) : null}
          <Box {...cardProps(b)}>
            {headOf(b)}
            {b.prompt ? row('요청', <Text color={pal.text} wrap="truncate-end">{b.prompt}</Text>) : null}
            {b.startedAt !== undefined ? row('시작', <Text color={pal.dim}>{`${ago(now - b.startedAt)} 시작`}</Text>) : null}
            {sinceRow(b)}
            {gitRow(b, true)}
            {failRows(b, true)}
            {stuckRow(b)}
            {uncheckedRow(b)}
            {overlapRow(b)}
            {b.files.length ? row('편집', <Text color={pal.dim} wrap="truncate-end">{`${b.edits}회 · ${b.files.slice(0, 6).join(', ')}`}</Text>) : null}
            {askBlock(b, 40)}
          </Box>

          {total ? (
            <Box flexDirection="column" marginTop={1}>
              <Text>
                <Text color={pal.accent} bold>할 일 </Text>
                <Text color={pal.dim}>{`${done}/${total}`}</Text>
              </Text>
              {todoStrips(b.tasks, b.state, b.planEnded, { planStartAt: b.planStartAt, now }).map(r => todoRowOf(r, cols - 2))}
            </Box>
          ) : null}

          {b.agents.length ? (
            <Box flexDirection="column" marginTop={1}>
              <Text>
                <Text color={pal.accent} bold>보조 에이전트 </Text>
                <Text color={pal.dim}>{agentSummary(b.agents)}</Text>
              </Text>
              {b.agents.map(a => (
                <Box flexDirection="row" columnGap={1}>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text wrap="truncate-end">
                      <Text color={a.status === 'working' ? pal.work : a.status === 'done' ? pal.ok : pal.bad}>
                        {a.status === 'working' ? '  ● ' : a.status === 'done' ? '  ✓ ' : '  ✗ '}
                      </Text>
                      <Text color={a.status === 'working' ? pal.text : pal.dim}>{a.desc || a.id}</Text>
                      <Text color={pal.dim}>{`  ${agentMeta(a, now)}`}</Text>
                    </Text>
                  </Box>
                  {/* 자기 세션의 보조만 그 대화를 열 수 있다 (T34 D3) */}
                  {b.id === self.beat?.id ? <Box flexShrink={0}><Button key={`view-${a.id}`} plain label=" 보기 " onPress={noop} /></Box> : null}
                </Box>
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
                  <Text color={pal.ok}>  ✓ </Text>
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
                  {/* 누르면 원문 복사. 마우스를 올리면 엔진이 Button 을 반전한다 */}
                  <Box flexGrow={1} flexShrink={1} height={1} overflow="hidden">
                    <Button key={`flow-${b.id}-${ev.at}-${ev.kind}`} plain onPress={noop}>
                      <Text color={c}>{`${EVENT_MARK[ev.kind]}  `}</Text>
                      {/* Button 글에는 truncate 가 걸리지 않아 칸 수로 직접 자른다: 바깥 여백 2 · 시각 10 · 표시 · 반전 끝 한 칸 */}
                      <Text color={pal.text}>{widthClip(ev.text, cols - 13 - widthOf(`${EVENT_MARK[ev.kind]}  `))}</Text>
                    </Button>
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
    // 대기는 보조 기다림을 빼고 센다
    const count = (s: Beat['state']) => list.filter(b => b.state === s && !isStale(b, now) && !(s === 'idle' && waitsOnAgents(b))).length
    const waiting = list.filter(b => !isStale(b, now) && waitsOnAgents(b)).length
    const helpers = list.filter(b => !isStale(b, now)).reduce((n, b) => n + agentCounts(b.agents).working, 0)
    const overlapped = new Set(list.filter(b => !isStale(b, now)).flatMap(b => overlaps(b, list, now).map(o => o.path))).size
    return (
      <Box flexDirection="column" paddingX={1}>
        <Box flexDirection="row" columnGap={2} flexWrap="wrap" marginBottom={1}>
          <Text color={pal.accent} bold>TEAM BOARD</Text>
          {count('asking') ? <Text backgroundColor={pal.ask} color={pal.onBadge} bold>{` 결정 대기 ${count('asking')} `}</Text> : null}
          {list.some(b => b.fail?.level === 'high' && !isStale(b, now)) ? <Text backgroundColor={pal.bad} color={pal.onBadge} bold>{` ⚠ 숨은 실패 ${list.filter(b => b.fail?.level === 'high' && !isStale(b, now)).length} `}</Text> : null}
          {list.some(b => b.unverified && !isStale(b, now)) ? <Text backgroundColor={pal.ask} color={pal.onBadge} bold>{` △ 검증 없음 ${list.filter(b => b.unverified && !isStale(b, now)).length} `}</Text> : null}
          {overlapped ? <Text backgroundColor={pal.ask} color={pal.onBadge} bold>{` ⚠ 겹침 ${overlapped} `}</Text> : null}
          <Text color={pal.work}>{`● 작업 ${count('working')}`}</Text>
          {waiting ? <Text color={pal.work}>{`◐ 보조 기다림 ${waiting}`}</Text> : null}
          <Text color={pal.dim}>{`○ 대기 ${count('idle')}`}</Text>
          {helpers ? <Text color={pal.work}>{`● 보조 ${helpers}`}</Text> : null}
        </Box>

        {list.map(b => {
          const lastDecision = b.decisions[b.decisions.length - 1]
          return (
            <Box key={b.id} {...cardProps(b)}>
              {headOf(b)}
              {lastDecision
                ? row(
                    '답함',
                    <Text wrap="truncate-end">
                      <Text color={pal.ok}>✓ </Text>
                      <Text color={pal.text}>{lastDecision.question}</Text>
                      <Text color={pal.ok} bold>{` → ${lastDecision.answer}`}</Text>
                      {b.decisions.length > 1 ? <Text color={pal.dim}>{`  외 ${b.decisions.length - 1}건`}</Text> : null}
                    </Text>,
                  )
                : null}
              {sinceRow(b)}
              {gitRow(b, false)}
              {failRows(b, false)}
              {stuckRow(b)}
              {uncheckedRow(b)}
              {overlapRow(b)}
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
