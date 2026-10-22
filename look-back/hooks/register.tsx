// look-back: 사람 요청마다 한 줄을 하루·세션별 파일에 남기고, /lookback 으로 기간별로 모아 보여준다.
// 기록은 엔진 이벤트만 쓴다 (모델 호출·프롬프트 변경 없음). 요약 버튼을 누를 때만 Haiku 를 부른다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import type { DayFile, Decision, Entry, Kind, LookView, Minutes, Period, ProjectReport } from '../types'
import {
  bigDigits, blockRow, buildReport, cells, chartOf, pad, clipText, clockText, questionText, dayOf, dayStartIso, decisionsIn, durationText, END_MARK, hoursText, kindAfter, MINUTES, modelName,
  nextDay, parseGitLog, parseOffset, periodDays, repoKey, requestText, streakOf, summaryPrompt, tokensText, upsert, workOf,
} from './ledger'

const PANE = 'look-back'
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: 'yesterday', label: '어제' },
  { key: 'week', label: '7일' },
  { key: 'month', label: '30일' },
  { key: 'year', label: '올해' },
]
const TITLE: Record<Period, string> = { today: '오늘 한 일', yesterday: '어제 한 일', week: '7일 동안 한 일', month: '30일 동안 한 일', year: '올해 한 일' }
const KIND_LABEL: Record<Kind | 'unknown', string> = { edit: '코드 수정', run: '실행', research: '조사', chat: '대화', unknown: '기록 전' }
const KIND_COLOR: Record<Kind | 'unknown', string> = { edit: 'yellow', run: 'cyan', research: 'green', chat: 'white', unknown: 'gray' }
const REPORT_KEY = 'report-off'
const MAX_REQUESTS = 12
const MAX_COMMITS = 8
const MAX_DECISIONS = 8

const IDLE: LookView = { status: 'idle', report: null, text: '', summaries: {}, loadedAt: 0 }
const view = atom({ plugin: 'look-back', key: 'view' } as const, IDLE)
const reportOff = atom({ plugin: 'look-back', key: 'reportOff' } as const, false)
/** 종류별 분: 설정(userConfig)으로 바꾼다 */
let minutes: Minutes = MINUTES

// 이 프로세스의 기록 상태. 같은 세션이 두 프로세스에서 돌 수 있어(재개, 상위 세션이 띄운 세션) 파일 이름에 꼬리표를 붙인다.
const self = {
  on: false,
  home: '',
  dir: '',
  root: '',
  offset: 0,
  tag: crypto.randomUUID().slice(0, 4),
  /** 요청은 왔지만 턴이 아직 시작하지 않은 것. raw 는 턴과 맞춰 볼 글, during 은 다른 턴이 도는 중에 보낸 요청 */
  pending: [] as { entry: Entry; raw: string; during: boolean }[],
  /** 진행 중인 턴 → 그 요청 */
  open: new Map<string, Entry>(),
  current: '',
  cache: new Map<string, Entry[]>(),
  chain: Promise.resolve() as Promise<void>,
  /** 마지막 쓰기 실패. 패널 아래에 보인다 */
  writeError: '',
}

/** 요청 한 줄을 그 날짜·세션 파일에 쓴다. 쓰기는 한 줄로 이어 순서를 지킨다. */
function persist($: EngineInterface, entry: Entry): Promise<void> {
  const snapshot = { ...entry, files: [...entry.files] }
  self.chain = self.chain
    .then(async () => {
      // /resume 으로 세션 id 가 바뀔 수 있어 쓸 때마다 묻는다
      const sid = (await $.session.id()).slice(0, 8)
      const path = `${self.dir}/${dayOf(snapshot.at, self.offset)}/${sid}-${self.tag}.json`
      let list = self.cache.get(path)
      if (!list) {
        const raw = await $.fs.read(path).catch(() => '')
        list = raw ? ((JSON.parse(raw) as DayFile).entries ?? []) : []
      }
      list = upsert(list, snapshot)
      self.cache.set(path, list)
      await $.fs.write(path, JSON.stringify({ v: 1, entries: list } satisfies DayFile))
    })
    .catch((err: unknown) => {
      // 기록 실패가 대화를 막지 않게 하되, 패널에서 알 수 있게 남긴다
      self.writeError = err instanceof Error ? err.message : String(err)
    })
  return self.chain
}

async function load($: EngineInterface, period: Period): Promise<void> {
  const now = await $.clock.now()
  const days = periodDays(period, now, self.offset)
  // 차트는 오늘·어제도 최근 7일을 그리므로 그 날짜까지 읽는다
  const chartDays = period === 'today' || period === 'yesterday' ? periodDays('week', period === 'yesterday' ? now - 86_400_000 : now, self.offset) : days
  const inPeriod = new Set(days)
  const all: Entry[] = []
  for (const day of new Set([...chartDays, ...days])) {
    const files = await $.fs.list(`${self.dir}/${day}`).catch(() => [])
    for (const f of files) {
      if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
      const raw = await $.fs.read(`${self.dir}/${day}/${f.name}`).catch(() => '')
      try {
        all.push(...((JSON.parse(raw) as DayFile).entries ?? []))
      } catch {
        // 쓰는 중이던 파일은 건너뛴다
      }
    }
  }
  const entries = all.filter(e => inPeriod.has(dayOf(e.at, self.offset)))
  // 연속 일수: 기록 폴더 이름이 곧 요청이 있었던 날
  const activeDays = (await $.fs.list(self.dir).catch(() => [])).filter(f => f.kind === 'dir').map(f => f.name)
  const since = dayStartIso(days[0]!, self.offset)
  const until = dayStartIso(nextDay(days[days.length - 1]!), self.offset)
  const commits: Record<string, { commits: ReturnType<typeof parseGitLog>; error: string }> = {}
  const decisions = await teamBoardDecisions($, entries, Date.parse(since), Date.parse(until))
  for (const root of new Set([...entries.map(e => e.root), ...Object.keys(decisions)])) {
    const r = await $.process
      // --since 는 기간 전 커밋을 만나면 걷기를 멈춰서, committer 날짜가 부모보다 이른 커밋이 HEAD 쪽에 있으면 0건이 된다. 거르기만 하는 --since-as-filter (git 2.37+)
      .run(['git', '-C', root, 'log', `--since-as-filter=${since}`, `--until=${until}`, '--format=%ct%x09%h%x09%s'], { timeoutMs: 5000 })
      .catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }))
    if (r.exitCode === 0) commits[root] = { commits: parseGitLog(r.stdout), error: '' }
    // 저장소가 아닌 폴더는 커밋이 없을 뿐이다
    else if (/not a git repository/.test(r.stderr)) commits[root] = { commits: [], error: '' }
    else if (/unrecognized argument: --since-as-filter/.test(r.stderr)) commits[root] = { commits: [], error: '커밋 못 읽음 (git 2.37 이상 필요)' }
    else commits[root] = { commits: [], error: '커밋 못 읽음' }
  }
  const report = buildReport(period, days, entries, commits, decisions)
  const work = workOf(entries, minutes)
  const bars = chartOf(period, all, now, self.offset, minutes)
  await update($, view, (): LookView => ({ status: 'done', report, text: '', summaries: {}, loadedAt: now, work, bars, activeDays }))
}

/**
 * team-board 가 세션마다 남긴 결정 기록에서 [from, to) 안의 것을 저장소 루트별로 모은다. 감지 규칙은 team-board 의 것을 그대로 쓴다.
 * team-board 가 없으면 빈 목록. 세션 파일은 결정을 최근 20개만 둔다.
 */
async function teamBoardDecisions($: EngineInterface, entries: readonly Entry[], from: number, to: number): Promise<Record<string, Decision[]>> {
  const base = `${self.home}/.claude/team-board`
  const rootOf = new Map(entries.map(e => [repoKey(e.root), e.root]))
  const out: Record<string, Decision[]> = {}
  for (const dir of await $.fs.list(base).catch(() => [])) {
    if (dir.kind !== 'dir') continue
    for (const f of await $.fs.list(`${base}/${dir.name}`).catch(() => [])) {
      // 기간 시작 전에 마지막으로 쓴 파일에는 기간 안의 결정이 없다
      if (f.kind !== 'file' || !f.name.endsWith('.json') || f.mtimeMs < from) continue
      let beat: unknown
      try {
        beat = JSON.parse(await $.fs.read(`${base}/${dir.name}/${f.name}`))
      } catch {
        continue
      }
      const found = decisionsIn(beat, from, to)
      if (!found.length) continue
      // look-back 기록이 없는 저장소는 그 세션의 작업 폴더를 루트로 쓴다
      const cwd = (beat as { cwd?: unknown }).cwd
      const root = rootOf.get(dir.name) ?? (typeof cwd === 'string' && cwd ? cwd : dir.name)
      rootOf.set(dir.name, root)
      out[root] = [...(out[root] ?? []), ...found]
    }
  }
  return out
}

async function summarize($: EngineInterface, root: string): Promise<void> {
  const v = await read($, view)
  const p = v.report?.projects.find(x => x.root === root)
  if (!v.report || !p) return
  const label = PERIODS.find(x => x.key === v.report!.period)?.label ?? ''
  const stamp = v.loadedAt
  await update($, view, cur => ({ ...cur, summaries: { ...cur.summaries, [root]: '…' } }))
  let r: ModelCompleteResult | null = null
  let why = ''
  try {
    r = await $.model.complete({ model: 'haiku', prompt: summaryPrompt(p, label), maxTokens: 4000, timeoutMs: 60_000 })
  } catch (err) {
    why = err instanceof Error ? err.message : String(err)
  }
  const text = r?.isAnswered ? r.text.trim() : `요약 실패 (${why || r?.reason || '?'})`
  // 요약하는 동안 기간을 바꿨으면 새 보고서에 붙이지 않는다
  await update($, view, cur => (cur.loadedAt === stamp ? { ...cur, summaries: { ...cur.summaries, [root]: text } } : cur))
}

function periodOf(arg: string): Period | null {
  const a = arg.trim().toLowerCase()
  if (a === '' || a === '오늘' || a === 'today') return 'today'
  if (a === '어제' || a === 'yesterday') return 'yesterday'
  if (a === '7일' || a === '7' || a === 'week' || a === '주') return 'week'
  if (a === '30일' || a === '30' || a === 'month' || a === '달') return 'month'
  if (a === '올해' || a === 'year' || a === '년') return 'year'
  return null
}

export const register: Register = (on, options) => {
  minutes = {
    edit: Number(options.minutes_edit ?? MINUTES.edit),
    run: Number(options.minutes_run ?? MINUTES.run),
    research: Number(options.minutes_research ?? MINUTES.research),
    chat: Number(options.minutes_chat ?? MINUTES.chat),
  }
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    // Work Report 켜기·끄기는 다음 세션에도 유지한다
    const stored = await $.store.get(REPORT_KEY).catch(() => undefined)
    await update($, reportOff, () => stored === true)
    await $.command.register({
      name: 'lookback',
      description: '기간 동안 한 일(한눈에 숫자·차트, 프로젝트별 요청·결정·커밋)을 옆 패널에',
      argumentHint: '[오늘|어제|7일|30일|올해] | report on|off',
    })
    const cwd = await $.session.cwd()
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? cwd
    self.home = home
    self.dir = `${home}/.claude/look-back`
    self.root = (await $.session.repo())?.root ?? cwd
    // 모드 런타임의 시간대를 믿지 않고 시스템 시간대를 묻는다 (날짜 경계)
    const z = await $.process.run(['date', '+%z'], { timeoutMs: 3000 }).catch(() => null)
    self.offset = parseOffset(z?.stdout ?? '')
    // claude -p 같은 비대화형 세션은 기록하지 않는다 (시험 실행이 섞이지 않게). 보기는 된다
    self.on = e.isInteractive === true
    return r
  })

  on('prompt.submit', async ($, e, next) => {
    const text = e.text.trim()
    // ' /lookback' 처럼 앞에 공백이 있으면 엔진이 명령이 아닌 일반 메시지로 보낸다. 그래서 / 는 다듬기 전 글로 본다
    if (!(self.on && text && !e.text.startsWith('/') && USER_ORIGINS.has(e.origin.kind))) return next(e)
    // 쉬는 중에 보낸 요청이면, 아직 턴을 못 만난 앞 요청들은 더 이상 자기 턴이 오지 않는다 (진행 중인 턴 안으로 전달됐다)
    if (!e.turnId) self.pending = []
    const p = { entry: { at: await $.clock.now(), text: requestText(text), root: self.root, turnId: '', end: null, ms: 0, tokens: 0, files: [] } as Entry, raw: text, during: !!e.turnId }
    // 턴이 next 안에서 시작해도 맞춰 볼 수 있게 먼저 넣는다
    self.pending.push(p)
    const r = await next(e)
    if (r.drop !== undefined) {
      // 다른 hook 이나 설정 hook 이 막은 요청은 남기지 않는다
      self.pending = self.pending.filter(x => x !== p)
      return r
    }
    // 다른 mod 가 글을 바꿨으면 턴은 바뀐 글로 시작한다
    if (r.text.trim() && r.text.trim() !== text) p.raw = r.text.trim()
    void persist($, p.entry)
    return r
  }).catch(($, e, next) => next(e)) // 기록이 실패해도 프롬프트를 막지 않는다

  // 요청과 턴은 글로 맞춘다: 턴 중에 보낸 요청은 그 턴 안으로 전달돼 자기 turn.start 가 없을 수 있어 순서로 잇지 않는다.
  // 요청 없이 시작한 턴(작업 알림, 이어 가기, 플러그인 프롬프트)은 기록하지 않는다
  on('turn.start', async ($, e, next) => {
    if (!e.agentId) {
      self.current = e.turnId
      const text = e.text.trim()
      let i = self.pending.findIndex(p => p.raw === text)
      // 글이 맞지 않아도, 쉬는 중에 보낸 요청 하나만 기다리고 있으면 그 요청의 턴이다
      if (i < 0 && text && self.pending.length === 1 && !self.pending[0]!.during) i = 0
      const p = i >= 0 ? self.pending.splice(i, 1)[0] : undefined
      if (p) {
        p.entry.turnId = e.turnId
        self.open.set(e.turnId, p.entry)
      }
    }
    return next(e)
  })

  // /clear·/resume 은 대화만 바뀐다 (session.start 가 다시 오지 않음). 끝나지 않은 요청은 결과 모름으로 둔다
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      self.pending = []
      self.open.clear()
    }
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    const entry = e.agentId ? undefined : self.open.get(e.turnId)
    if (entry && r.usage) entry.tokens += r.usage.input_tokens + r.usage.output_tokens + r.usage.cache_read_input_tokens + r.usage.cache_creation_input_tokens
    if (entry && e.model && !entry.model) entry.model = e.model
    return r
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const entry = e.agentId ? undefined : self.open.get(self.current)
    // 거부된 도구는 안 쓴 것. 수정은 성공해야 수정이고, 실패한 명령·검색도 한 일이다
    if (entry) {
      const command = (e as { command?: unknown }).command
      entry.kind = kindAfter(entry.kind, e.tool, r.deny === undefined && !(EDIT_TOOLS.has(e.tool) && r.isError), typeof command === 'string' ? command : undefined)
    }
    if (entry && EDIT_TOOLS.has(e.tool) && r.deny === undefined && !r.isError) {
      const input = e as { file_path?: unknown; notebook_path?: unknown }
      const path = typeof input.file_path === 'string' ? input.file_path : typeof input.notebook_path === 'string' ? input.notebook_path : ''
      if (path && !entry.files.includes(path)) entry.files.push(path)
    }
    return r
  }).catch(($, e, next) => next(e)) // 관찰만 하므로 실패해도 도구를 막지 않는다

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const entry = e.agentId ? undefined : self.open.get(e.turnId)
    if (entry) {
      self.open.delete(e.turnId)
      entry.end = e.reason
      entry.ms = e.durationMs
      entry.kind ??= 'chat'
      await persist($, entry)
    }
    return r
  })

  on('command.run', { command: 'lookback' }, async ($, e) => {
    const [sub, arg] = e.args.trim().split(/\s+/)
    if (sub === 'report' && (arg === 'on' || arg === 'off')) {
      const off = arg === 'off'
      await $.store.set(REPORT_KEY, off)
      await update($, reportOff, () => off)
      return { text: off ? '한눈에 칸(Work Report)을 껐어요. 기록은 계속해요. 다시 켜려면 /lookback report on' : '한눈에 칸(Work Report)을 켰어요.' }
    }
    const period = periodOf(e.args)
    if (!period) return { text: '/lookback [오늘|어제|7일|30일|올해] · /lookback report on|off' }
    await update($, view, (cur): LookView => ({ ...cur, status: 'loading' }))
    await $.ui.open({ id: PANE, title: '돌아보기', closeOnEscape: true })
    try {
      await load($, period)
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      await update($, view, (): LookView => ({ ...IDLE, status: 'error', text: why }))
      return { text: `/lookback: 기록을 읽지 못했어요 (${why})` }
    }
    // 이 줄은 모델도 읽으므로 짧게 둔다
    return { text: '돌아보기를 옆 패널에 띄웠어요. (Esc로 닫기)' }
  })

  // 그리기의 $ 로는 상태를 쓸 수 없어서, 누름은 여기서 받는다.
  on('ui.press', async ($, e, next) => {
    if (e.plugin !== 'look-back') return next(e)
    const key = String(e.element ?? '')
    const period = PERIODS.find(p => key === `period-${p.key}`)
    if (period) {
      await update($, view, (cur): LookView => ({ ...cur, status: 'loading' }))
      await load($, period.key).catch(async (err: unknown) => {
        await update($, view, (): LookView => ({ ...IDLE, status: 'error', text: err instanceof Error ? err.message : String(err) }))
      })
    } else if (key.startsWith('sum-')) {
      const root = (await read($, view)).report?.projects[Number(key.slice(4))]?.root
      if (root) await summarize($, root)
    } else return next(e)
    return { element: key }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const v = await read($, view)
    const hideReport = await read($, reportOff)
    const noop = () => {}
    const off = self.offset
    // 패널 안쪽 폭 (좌우 여백 1칸씩)
    const cols = Math.max(24, (e.props as { bodyColumns?: number }).bodyColumns ?? 80) - 2

    // 기간 칩: 고른 기간은 노란 바탕 + 어두운 굵은 글자, 나머지는 흐리게
    const chips = (
      <Box key="chips" flexDirection="row" flexWrap="wrap" columnGap={1}>
        {PERIODS.map(p => (
          <Button key={`period-${p.key}`} plain onPress={noop}>
            {v.report?.period === p.key ? <Text backgroundColor="yellow" color="black" bold>{` ${p.label} `}</Text> : <Text dimColor>{` ${p.label} `}</Text>}
          </Button>
        ))}
      </Box>
    )
    if (v.status === 'loading') return <Box flexDirection="column" paddingX={1}>{chips}<Text color="cyan">기록을 읽는 중…</Text></Box>
    if (v.status === 'error') return <Box flexDirection="column" paddingX={1}>{chips}<Text color="red">{v.text}</Text></Box>
    if (!v.report) return <Box paddingX={1}><Text dimColor>/lookback 을 입력하면 기간 동안 한 일이 여기에 나와요.</Text></Box>

    const rep = v.report
    const range = rep.from === rep.to ? rep.from : `${rep.from} ~ ${rep.to}`
    const reqs = rep.projects.reduce((n, p) => n + p.entries.length, 0)
    const ms = rep.projects.reduce((n, p) => n + p.ms, 0)
    const commits = rep.projects.reduce((n, p) => n + p.commits.length, 0)
    // 0.2.0 전에 만든 화면 상태에는 decisions 가 없다
    const decisionsOf = (p: ProjectReport) => p.decisions ?? []
    const decided = rep.projects.reduce((n, p) => n + decisionsOf(p).length, 0)

    const project = (p: ProjectReport, i: number) => {
      const shown = p.entries.slice(-MAX_REQUESTS)
      const sum = v.summaries[p.root]
      return (
        <Box key={`p${i}`} flexDirection="column" marginTop={1}>
          {/* 프로젝트마다 이름 붙은 가로줄, 그 아래 수치. 안의 커밋·결정·요청은 작은 머리로 나눈다 */}
          {ruled(`p${i}-h`, <Text><Text bold color="cyan">{p.name}</Text> </Text>, cells(p.name) + 1)}
          <Box flexDirection="row" gap={1}>
            <Text dimColor>
              {p.entries.length ? `요청 ${p.entries.length} · ${durationText(p.ms)} · ` : ''}
              {`결정 ${decisionsOf(p).length} · 커밋 ${p.commits.length}`}
              {p.entries.length ? ` · 토큰 ${tokensText(p.tokens)}` : ''}
            </Text>
            {sum === undefined || sum.startsWith('요약 실패') ? <Button key={`sum-${i}`} label="요약" variant="secondary" onPress={noop} /> : null}
          </Box>
          {sum !== undefined ? <Text color={sum.startsWith('요약 실패') ? 'red' : undefined}>{sum === '…' ? '요약하는 중…' : sum}</Text> : null}
          {p.commitError || p.commits.length ? <Text dimColor>─ 커밋</Text> : null}
          {p.commitError ? <Text dimColor>{p.commitError}</Text> : null}
          {p.commits.slice(-MAX_COMMITS).map(c => (
            <Text key={`c${c.hash}`} wrap="truncate-end">
              <Text color="green">{`  ${c.hash} `}</Text>
              {c.subject}
            </Text>
          ))}
          {p.commits.length > MAX_COMMITS ? <Text dimColor>{`  … 커밋 ${p.commits.length - MAX_COMMITS}개 더`}</Text> : null}
          {decisionsOf(p).length ? <Text dimColor>─ 결정</Text> : null}
          {decisionsOf(p).length > MAX_DECISIONS ? <Text dimColor>{`  … 앞선 결정 ${decisionsOf(p).length - MAX_DECISIONS}개`}</Text> : null}
          {decisionsOf(p).slice(-MAX_DECISIONS).map(d => (
            <Text key={`d${d.at}`} wrap="truncate-end">
              <Text dimColor>{`  ${clockText(d.at, off)} `}</Text>
              <Text color="yellow">{'? '}</Text>
              {clipText(questionText(d.question), 60)}
              <Text color="yellow">{' → '}</Text>
              {clipText(d.answer, 40)}
            </Text>
          ))}
          {p.entries.length ? <Text dimColor>─ 요청</Text> : null}
          {p.entries.length > MAX_REQUESTS ? <Text dimColor>{`  … 앞선 요청 ${p.entries.length - MAX_REQUESTS}개`}</Text> : null}
          {shown.map(r => (
            <Text key={`r${r.at}`} wrap="truncate-end">
              <Text dimColor>{`  ${clockText(r.at, off)} `}</Text>
              <Text>{`${r.end ? END_MARK[r.end] : '·'} `}</Text>
              {r.text}
              <Text dimColor>{r.ms ? `  ${durationText(r.ms)}` : ''}{r.files.length ? ` · 파일 ${r.files.length}` : ''}</Text>
            </Text>
          ))}
        </Box>
      )
    }

    // ── Work Report (한눈에) ──
    // 한 줄 높이 Box 안에서 줄바꿈시켜 넘친 가로줄을 숨긴다 (truncate 는 끝에 … 를 붙인다)
    const ruled = (key: string, lead: JSX.Element, leadW: number) => (
      <Box key={key} height={1} overflow="hidden">
        <Text wrap="wrap">
          {lead}
          <Text dimColor>{'─'.repeat(Math.max(0, cols - leadW))}</Text>
        </Text>
      </Box>
    )
    const section = (key: string, title: string) => (
      <Box key={key} marginTop={1} flexDirection="column">
        {ruled(`${key}-h`, <Text bold dimColor>{`${title} `}</Text>, cells(title) + 1)}
      </Box>
    )
    const report = () => {
      const w = v.work
      const bars = v.bars ?? []
      if (!w) return null
      const title = TITLE[rep.period]
      const head = (
        <Box key="wr-title" flexDirection="column" marginTop={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold>{title}</Text>
            <Text dimColor>{range}</Text>
          </Box>
          {ruled('wr-rule', <Text color="yellow">{'━'.repeat(cells(title))}</Text>, cells(title))}
        </Box>
      )
      if (w.done === 0) {
        return (
          <Box key="wr" flexDirection="column">
            {head}
            <Text dimColor>{rep.period === 'today' ? '오늘 끝낸 요청이 아직 없어요. 첫 요청이 끝나면 여기에 보여요.' : '이 기간에 끝낸 요청이 없어요.'}</Text>
          </Box>
        )
      }
      const hours = (min: number) => (min / 60 >= 100 ? String(Math.round(min / 60)) : (Math.round((min / 60) * 10) / 10).toFixed(1))
      // 타일: 머리글 · 3줄 큰 숫자 · 꼬리. 큰 숫자가 패널보다 넓으면 굵은 글자 한 줄. 좁으면 flexWrap 으로 3 → 2 → 1칸
      const tile = (key: string, label: string, value: string, foot: string, color: string) => {
        const big = bigDigits(value)
        const inner = Math.max(cells(label), cells(foot), cells(big[0]))
        const fits = inner + 4 <= cols
        return (
          <Box key={key} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1} flexShrink={0}>
            <Text dimColor bold>{label}</Text>
            {fits ? big.map((row, i) => <Text key={`${key}-${i}`} color={color}>{row}</Text>) : <Text bold color={color}>{value}</Text>}
            <Text dimColor>{foot}</Text>
          </Box>
        )
      }
      // 줄: ● 이름 · 막대 · 건수 · 시간. 막대는 가장 많은 것을 가득으로
      const nameW = 10
      const barW = Math.max(3, cols - nameW - 2 - 5 - 8)
      const row = (key: string, color: string, name: string, count: number, max: number, tail: string) => (
        <Text key={key} wrap="truncate-end">
          <Text color={color}>{'● '}</Text>
          {pad(name, nameW)}
          <Text color={color}>{pad('─'.repeat(Math.min(barW, Math.max(1, Math.round((count / max) * barW)))), barW)}</Text>
          {pad(String(count), 5, 'start')}
          {tail ? <Text dimColor>{pad(tail, 8, 'start')}</Text> : null}
        </Text>
      )
      // 막대 길이는 기록 전을 빼고 잰다: 0.3.0 전 기록이 많으면 새 막대가 1칸으로 눌린다 (기록 전 막대는 가득)
      const known = <T,>(list: T[], isKnown: (x: T) => boolean, count: (x: T) => number) => Math.max(1, ...list.filter(isKnown).map(count))
      const maxKind = known(w.byKind, k => k.kind !== 'unknown', k => k.count)
      const maxModel = known(w.byModel, m => m.model !== '', m => m.count)
      // 차트: 3줄 막대. 막대 칸 = 폭 / 막대 수, 2칸 이상이면 1칸은 흐린 세로줄로 칸을 나눈다. 막대 아래 가로 기준선
      const slot = Math.max(1, Math.floor(cols / Math.max(1, bars.length)))
      const bw = slot >= 2 ? slot - 1 : 1
      const gap = slot >= 2 ? '│' : ''
      const peak = Math.max(1, ...bars.map(b => b.min))
      const chartRow = (r: number) => (
        <Text key={`ch-${r}`} wrap="truncate-end">
          {bars.map((b, i) => (
            <Text key={`b${i}`}>
              <Text color={b.now ? 'yellow' : 'cyan'}>{blockRow(Math.round((b.min / peak) * 24), r).repeat(bw)}</Text>
              <Text dimColor>{gap}</Text>
            </Text>
          ))}
        </Text>
      )
      const labels =
        // 라벨 사이에 빈칸이 남을 때만 막대마다 쓴다 (30일은 '1920…' 처럼 붙어서 첫·끝만)
        slot >= 2 && bars.every(b => cells(b.label) < slot) ? (
          <Text key="ch-l">
            {bars.map((b, i) => (
              <Text key={`l${i}`} dimColor={!b.now} color={b.now ? 'yellow' : undefined}>
                {pad(b.label, slot)}
              </Text>
            ))}
          </Text>
        ) : (
          <Box key="ch-l" flexDirection="row" justifyContent="space-between">
            <Text dimColor>{`${bars[0]?.label ?? ''}${rep.period === 'year' ? '월' : '일'}`}</Text>
            <Text dimColor>{`${bars.at(-1)?.label ?? ''}${rep.period === 'year' ? '월' : '일'}`}</Text>
          </Box>
        )
      const today = dayOf(v.loadedAt, off)
      const days = (v.activeDays ?? []).filter(d => d >= rep.from && d <= rep.to)
      const top = bars.reduce((a, b) => (b.min > a.min ? b : a), bars[0] ?? { label: '', min: 0, now: false, future: false })
      // 아낀 시간이 모두 0이면(기록 전뿐) 가장 많은 날·달은 뜻이 없어 뺀다
      const summary =
        rep.period === 'month' || rep.period === 'year'
          ? `${top.min > 0 ? `가장 많은 ${rep.period === 'year' ? `달 ${top.label}월` : `날 ${top.label}일`} · ${hoursText(top.min)} · ` : ''}일한 날 ${days.length}일`
          : `최근 7일 아낀 시간 ${hoursText(bars.reduce((n, b) => n + b.min, 0))} · 연속 ${streakOf(v.activeDays ?? [], today)}일`
      const chartTitle = rep.period === 'month' ? '날마다' : rep.period === 'year' ? '달마다' : '최근 7일'
      return (
        <Box key="wr" flexDirection="column">
          {head}
          <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
            {tile('t-saved', '아낀 시간', hours(w.savedMin), '시간 · 추정', 'yellow')}
            {tile('t-done', '끝낸 요청', String(w.done), '건', 'cyan')}
            {tile('t-work', 'Claude 작업', hours(w.ms / 60_000), '시간 · 실측', 'green')}
          </Box>
          {section('s-kind', '어디에 썼나')}
          {w.byKind.map(k => row(`k-${k.kind}`, KIND_COLOR[k.kind], KIND_LABEL[k.kind], k.count, maxKind, k.kind === 'unknown' ? '' : hoursText(k.min)))}
          {section('s-model', '누가 했나')}
          {w.byModel.map(m => row(`m-${m.model || 'none'}`, m.model ? 'magenta' : 'gray', modelName(m.model), m.count, maxModel, ''))}
          {section('s-chart', chartTitle)}
          {[2, 1, 0].map(chartRow)}
          <Text key="ch-base" dimColor wrap="truncate-end">{bars.map(() => '─'.repeat(bw) + (gap ? '┴' : '')).join('')}</Text>
          {labels}
          <Text bold>{summary}</Text>
          <Text dimColor>{`아낀 시간은 추정입니다 (코드 수정 ${minutes.edit}분 · 실행 ${minutes.run}분 · 조사 ${minutes.research}분 · 대화 ${minutes.chat}분). 바꾸기: claude plugin configure look-back@devflow-mods`}</Text>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" paddingX={1}>
        {chips}
        {hideReport ? <Text bold>{`돌아보기 · ${range}`}</Text> : report()}
        {section('s-proj', '프로젝트')}
        <Text>{`요청 ${reqs} · Claude 작업 ${durationText(ms)} · 결정 ${decided} · 커밋 ${commits} · 프로젝트 ${rep.projects.length}`}</Text>
        {rep.projects.length === 0 ? <Text dimColor>이 기간에 기록된 요청이 없어요. 기록은 look-back 을 설치한 뒤 대화형 세션에서 보낸 요청부터 남아요.</Text> : null}
        {rep.projects.map(project)}
        {self.writeError ? <Text color="red">{`기록 쓰기 실패: ${self.writeError}`}</Text> : null}
        <Box marginTop={1}>
          <Text dimColor>✓ 답함 · ■ 중단 · ✗ 오류 · 점(·)은 결과 모름(턴 중에 보낸 요청 등) · ? 결정(team-board 기록) · 시간은 Claude 가 일한 시간, 토큰은 캐시 읽기 포함</Text>
        </Box>
      </Box>
    )
  })
}
