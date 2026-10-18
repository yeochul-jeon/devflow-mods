// look-back: 사람 요청마다 한 줄을 하루·세션별 파일에 남기고, /lookback 으로 기간별로 모아 보여준다.
// 기록은 엔진 이벤트만 쓴다 (모델 호출·프롬프트 변경 없음). 요약 버튼을 누를 때만 Haiku 를 부른다.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelCompleteResult, Register } from 'claude-code'

import type { DayFile, Entry, LookView, Period, ProjectReport } from '../types'
import {
  buildReport, clockText, dayOf, dayStartIso, durationText, END_MARK, nextDay, parseGitLog, parseOffset, periodDays,
  requestText, summaryPrompt, tokensText, upsert,
} from './ledger'

const PANE = 'look-back'
const USER_ORIGINS = new Set(['composer', 'bridge', 'sdk'])
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit'])
const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: 'yesterday', label: '어제' },
  { key: 'week', label: '7일' },
  { key: 'month', label: '30일' },
]
const MAX_REQUESTS = 12
const MAX_COMMITS = 8

const IDLE: LookView = { status: 'idle', report: null, text: '', summaries: {}, loadedAt: 0 }
const view = atom({ plugin: 'look-back', key: 'view' } as const, IDLE)

// 이 프로세스의 기록 상태. 같은 세션이 두 프로세스에서 돌 수 있어(재개, 상위 세션이 띄운 세션) 파일 이름에 꼬리표를 붙인다.
const self = {
  on: false,
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
  const entries: Entry[] = []
  for (const day of days) {
    const files = await $.fs.list(`${self.dir}/${day}`).catch(() => [])
    for (const f of files) {
      if (f.kind !== 'file' || !f.name.endsWith('.json')) continue
      const raw = await $.fs.read(`${self.dir}/${day}/${f.name}`).catch(() => '')
      try {
        entries.push(...((JSON.parse(raw) as DayFile).entries ?? []))
      } catch {
        // 쓰는 중이던 파일은 건너뛴다
      }
    }
  }
  const since = dayStartIso(days[0]!, self.offset)
  const until = dayStartIso(nextDay(days[days.length - 1]!), self.offset)
  const commits: Record<string, { commits: ReturnType<typeof parseGitLog>; error: string }> = {}
  for (const root of new Set(entries.map(e => e.root))) {
    const r = await $.process
      .run(['git', '-C', root, 'log', `--since=${since}`, `--until=${until}`, '--format=%ct%x09%h%x09%s'], { timeoutMs: 5000 })
      .catch((err: unknown) => ({ exitCode: -1, stdout: '', stderr: err instanceof Error ? err.message : String(err) }))
    if (r.exitCode === 0) commits[root] = { commits: parseGitLog(r.stdout), error: '' }
    // 저장소가 아닌 폴더는 커밋이 없을 뿐이다
    else if (/not a git repository/.test(r.stderr)) commits[root] = { commits: [], error: '' }
    else commits[root] = { commits: [], error: '커밋 못 읽음' }
  }
  const report = buildReport(period, days, entries, commits)
  await update($, view, (): LookView => ({ status: 'done', report, text: '', summaries: {}, loadedAt: now }))
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
  return null
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'lookback',
      description: '기간 동안 프로젝트별로 한 요청과 커밋을 옆 패널에',
      argumentHint: '[오늘|어제|7일|30일]',
    })
    const cwd = await $.session.cwd()
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? cwd
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
    if (!(self.on && text && !text.startsWith('/') && USER_ORIGINS.has(e.origin.kind))) return next(e)
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
    return r
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    const entry = e.agentId ? undefined : self.open.get(self.current)
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
      await persist($, entry)
    }
    return r
  })

  on('command.run', { command: 'lookback' }, async ($, e) => {
    const period = periodOf(e.args)
    if (!period) return { text: '/lookback [오늘|어제|7일|30일]' }
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
    const noop = () => {}
    const off = self.offset

    const chips = (
      <Box key="chips" flexDirection="row" gap={1}>
        {PERIODS.map(p => (
          <Button key={`period-${p.key}`} label={p.label} variant={v.report?.period === p.key ? 'primary' : 'secondary'} onPress={noop} />
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

    const project = (p: ProjectReport, i: number) => {
      const shown = p.entries.slice(-MAX_REQUESTS)
      const sum = v.summaries[p.root]
      return (
        <Box key={`p${i}`} flexDirection="column" marginTop={1}>
          <Box flexDirection="row" gap={1}>
            <Text bold color="cyan">{p.name}</Text>
            <Text dimColor>{`요청 ${p.entries.length} · ${durationText(p.ms)} · 커밋 ${p.commits.length} · 토큰 ${tokensText(p.tokens)}`}</Text>
            {sum === undefined || sum.startsWith('요약 실패') ? <Button key={`sum-${i}`} label="요약" variant="secondary" onPress={noop} /> : null}
          </Box>
          {sum !== undefined ? <Text color={sum.startsWith('요약 실패') ? 'red' : undefined}>{sum === '…' ? '요약하는 중…' : sum}</Text> : null}
          {p.commitError ? <Text dimColor>{p.commitError}</Text> : null}
          {p.commits.slice(-MAX_COMMITS).map(c => (
            <Text key={`c${c.hash}`} wrap="truncate-end">
              <Text color="green">{`  ${c.hash} `}</Text>
              {c.subject}
            </Text>
          ))}
          {p.commits.length > MAX_COMMITS ? <Text dimColor>{`  … 커밋 ${p.commits.length - MAX_COMMITS}개 더`}</Text> : null}
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

    return (
      <Box flexDirection="column" paddingX={1}>
        {chips}
        <Text bold>{`돌아보기 · ${range}`}</Text>
        <Text>{`요청 ${reqs} · Claude 작업 ${durationText(ms)} · 커밋 ${commits} · 프로젝트 ${rep.projects.length}`}</Text>
        {rep.projects.length === 0 ? <Text dimColor>이 기간에 기록된 요청이 없어요. 기록은 look-back 을 설치한 뒤 대화형 세션에서 보낸 요청부터 남아요.</Text> : null}
        {rep.projects.map(project)}
        {self.writeError ? <Text color="red">{`기록 쓰기 실패: ${self.writeError}`}</Text> : null}
        <Box marginTop={1}>
          <Text dimColor>✓ 답함 · ■ 중단 · ✗ 오류 · 점(·)은 결과 모름(턴 중에 보낸 요청 등) · 시간은 Claude 가 일한 시간, 토큰은 캐시 읽기 포함</Text>
        </Box>
      </Box>
    )
  })
}
