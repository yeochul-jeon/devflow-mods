import { describe, expect, mock, test } from 'claude-code/testing'

import type { Entry } from '../types'
import {
  bigDigits, buildReport, chartOf, clockText, dayOf, kindAfter, MINUTES, modelName, questionText, streakOf, summaryPrompt, dayStartIso, durationText, nextDay, parseGitLog,
  parseOffset, periodDays, requestText, tokensText, upsert, workOf,
} from '../hooks/ledger'

const KST = 540
// 2026-10-18 23:59:30 KST
const NOW = Date.parse('2026-10-18T14:59:30Z')
const entry = (at: number, root: string, more: Partial<Entry> = {}): Entry => ({ at, text: 'x', root, turnId: '', end: 'answer', ms: 1000, tokens: 10, files: [], ...more })

describe('ledger (순수 함수)', () => {
  test('시간대와 날짜: 모드 런타임 시간대가 아니라 offset 으로 계산한다', async () => {
    expect(parseOffset('+0900\n')).toBe(540)
    expect(parseOffset('-0330')).toBe(-210)
    expect(parseOffset('')).toBe(0)
    expect(dayOf(NOW, KST)).toBe('2026-10-18')
    expect(dayOf(NOW + 60_000, KST)).toBe('2026-10-19') // 자정 넘김
    expect(dayOf(NOW, 0)).toBe('2026-10-18')
    expect(periodDays('today', NOW, KST)).toEqual(['2026-10-18'])
    expect(periodDays('yesterday', NOW, KST)).toEqual(['2026-10-17'])
    expect(periodDays('week', NOW, KST)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
    expect(periodDays('month', NOW, KST)).toHaveLength(30)
    expect(periodDays('month', NOW, KST)[0]).toBe('2026-09-19')
    expect(dayStartIso('2026-10-12', KST)).toBe('2026-10-12T00:00:00+09:00')
    expect(dayStartIso('2026-10-12', -210)).toBe('2026-10-12T00:00:00-03:30')
    expect(nextDay('2026-10-31')).toBe('2026-11-01')
    expect(clockText(NOW, KST)).toBe('10/18 23:59')
  })

  test('요청 글: 줄바꿈을 펴고 비밀 값을 가리고 200자로 자른다', async () => {
    expect(requestText('  배포 해줘\n  API_TOKEN=abc123 으로 ')).toBe('배포 해줘 API_TOKEN=*** 으로')
    expect(requestText('curl -H "Authorization: Bearer xyz" https://u:pw@host')).toBe('curl -H "Authorization: Bearer ***" https://u:***@host')
    const long = requestText('가'.repeat(300))
    expect([...long]).toHaveLength(200)
    expect(long.endsWith('…')).toBe(true)
    // 붙여 넣은 글은 엔진이 <pasted_content id="…"> 로 감싸 보낸다. 태그는 빼고 글만 남긴다 (2026-10-21 시험 F7)
    expect(requestText('<pasted_content id="1f0b">\n시험용 요청\n둘째 줄\n</pasted_content id="1f0b">')).toBe('시험용 요청 둘째 줄')
    expect(requestText('앞 글 <pasted_content id="a1">붙인 글</pasted_content id="a1"> 뒤 글')).toBe('앞 글 붙인 글 뒤 글')
  })

  test('같은 요청은 바꾸고 시각 순으로 둔다, git log 를 읽는다', async () => {
    const a = entry(2, '/r', { end: null })
    const b = entry(1, '/r')
    expect(upsert(upsert([a], b), { ...a, end: 'answer' })).toEqual([b, { ...a, end: 'answer' }])
    expect(parseGitLog('1792300000\te1d306d\twork-plan 0.2.0: add\tgate\n\nbad line\n')).toEqual([
      { at: 1792300000_000, hash: 'e1d306d', subject: 'work-plan 0.2.0: add\tgate' },
    ])
  })

  test('프로젝트별로 묶고 최근에 일한 프로젝트를 먼저 둔다', async () => {
    const rep = buildReport('week', ['2026-10-12', '2026-10-18'], [entry(3, '/a/one'), entry(1, '/b/two', { ms: 60_000, tokens: 5 }), entry(2, '/b/two')], {
      '/a/one': { commits: [], error: '커밋 못 읽음' },
      '/b/two': { commits: [{ at: 9, hash: 'h2', subject: 's2' }, { at: 4, hash: 'h1', subject: 's1' }], error: '' },
    })
    expect(rep.from).toBe('2026-10-12')
    expect(rep.to).toBe('2026-10-18')
    expect(rep.projects.map(p => p.name)).toEqual(['two', 'one'])
    expect(rep.projects[0]).toMatchObject({ ms: 61_000, tokens: 15, commitError: '' })
    expect(rep.projects[0]!.commits.map(c => c.hash)).toEqual(['h1', 'h2'])
    expect(rep.projects[1]!.commitError).toBe('커밋 못 읽음')
  })

  test('요약 요청: 요청마다 결과를 붙이고 커밋 제목을 담는다', async () => {
    const rep = buildReport('today', ['2026-10-18'], [entry(1, '/r/shop', { text: 'cart 만들기' }), entry(2, '/r/shop', { text: 'README 쓰기', end: 'aborted' }), entry(3, '/r/shop', { text: '배포', end: null })], {
      '/r/shop': { commits: [{ at: 4, hash: 'h', subject: 'add cart' }], error: '' },
    })
    const p = summaryPrompt(rep.projects[0]!, '오늘')
    expect(p).toContain('- [답함] cart 만들기\n- [중단] README 쓰기\n- [결과 모름] 배포')
    expect(p).toContain('커밋:\n- add cart')
    expect(p).toContain('"shop" 프로젝트에서 오늘')
    expect(p).toContain('결정:\n(없음)')
    expect(summaryPrompt({ ...rep.projects[0]!, decisions: [{ at: 1, question: 'A 로 할까요?', answer: 'A' }] }, '오늘')).toContain('결정:\n- A 로 할까요? → A')
  })

  test('결정 질문 앞 목록 기호를 뗀다', async () => {
    expect(questionText('2. claude-mods-setup 을 넣을까요?')).toBe('claude-mods-setup 을 넣을까요?')
    expect(questionText('- D3: 안 A 로 할까요?')).toBe('D3: 안 A 로 할까요?')
    expect(questionText('1) - 진행할까요?')).toBe('진행할까요?')
    expect(questionText('3.5 버전으로 올릴까요?')).toBe('3.5 버전으로 올릴까요?')
  })

  test('시간과 토큰 표기', async () => {
    expect(durationText(40_000)).toBe('40초')
    expect(durationText(12 * 60_000)).toBe('12분')
    expect(durationText(65 * 60_000)).toBe('1시간 5분')
    expect(durationText(120 * 60_000)).toBe('2시간')
    expect(tokensText(950)).toBe('950')
    expect(tokensText(12_340)).toBe('1.2만')
    expect(tokensText(4_560)).toBe('4.6천')
  })
})

describe('Work Report (순수 함수)', () => {
  test('종류: 쓴 도구로 정하고 앞 것(수정 > 실행 > 조사)이 이긴다', async () => {
    expect(kindAfter(undefined, 'Read', true)).toBe('research')
    expect(kindAfter('research', 'Bash', true)).toBe('run')
    expect(kindAfter('run', 'Edit', true)).toBe('edit')
    expect(kindAfter('edit', 'Grep', true)).toBe('edit')
    expect(kindAfter(undefined, 'Edit', false)).toBeUndefined() // 거부·실패한 수정은 수정이 아니다
    expect(kindAfter(undefined, 'WebFetch', true)).toBe('research')
    expect(kindAfter(undefined, 'Agent', true)).toBe('research')
    expect(kindAfter(undefined, 'mcp__x__y', true)).toBeUndefined() // 모르는 도구는 종류를 바꾸지 않는다
  })

  test('종류: 읽기만 하는 Bash 는 조사, 하나라도 실행·쓰기가 섞이면 실행', async () => {
    expect(kindAfter(undefined, 'Bash', true, "cd /r && sed -n 1,40p a.ts | grep -n foo")).toBe('research')
    expect(kindAfter(undefined, 'Bash', true, 'git log --oneline -5; git status --short')).toBe('research')
    expect(kindAfter(undefined, 'Bash', true, 'for f in *.ts; do wc -l $f; done')).toBe('research')
    expect(kindAfter(undefined, 'Bash', true, 'cat a.txt && bun test')).toBe('run')
    expect(kindAfter(undefined, 'Bash', true, 'git show HEAD > out.txt')).toBe('run') // 파일로 쓰면 읽기만이 아니다
    expect(kindAfter(undefined, 'Bash', true, "sed -i '' s/a/b/ a.txt")).toBe('run')
    expect(kindAfter(undefined, 'Bash', true, "python3 -c 'print(1)'")).toBe('run')
    expect(kindAfter('run', 'Bash', true, 'ls')).toBe('run') // 앞 것이 이긴다
    expect(kindAfter(undefined, 'Bash', true)).toBe('run') // 명령을 모르면 실행
  })

  test('올해: 1월 1일부터 오늘까지', async () => {
    const days = periodDays('year', NOW, KST)
    expect(days[0]).toBe('2026-01-01')
    expect(days.at(-1)).toBe('2026-10-18')
    expect(days).toHaveLength(291)
  })

  test('모아 보기: 끝낸 요청만 세고, 아낀 시간은 종류별 분, 옛 기록은 기록 전', async () => {
    const list = [
      entry(1, '/r', { kind: 'edit', model: 'claude-opus-5-5', ms: 120_000 }),
      entry(2, '/r', { kind: 'edit', model: 'claude-opus-5-5', ms: 60_000 }),
      entry(3, '/r', { kind: 'research', model: 'claude-haiku-5-5' }),
      entry(4, '/r', { kind: 'chat', end: 'aborted' }), // 중단은 세지 않는다
      entry(5, '/r'), // 0.3.0 전 기록
    ]
    const w = workOf(list, MINUTES)
    expect(w.done).toBe(4)
    expect(w.ms).toBe(120_000 + 60_000 + 1000 + 1000)
    expect(w.savedMin).toBe(20 + 20 + 15 + 0)
    expect(w.byKind).toEqual([
      { kind: 'edit', count: 2, min: 40 },
      { kind: 'research', count: 1, min: 15 },
      { kind: 'unknown', count: 1, min: 0 },
    ])
    expect(w.byModel).toEqual([
      { model: 'claude-opus-5-5', count: 2 },
      { model: 'claude-haiku-5-5', count: 1 },
      { model: '', count: 1 },
    ])
    expect(workOf(list, { ...MINUTES, edit: 30 }).savedMin).toBe(75)
    // 기록 전이 더 많아도 맨 뒤
    expect(workOf([...list, entry(6, '/r'), entry(7, '/r')], MINUTES).byKind.map(k => k.kind)).toEqual(['edit', 'research', 'unknown'])
  })

  test('연속 일수: 오늘부터(오늘이 비면 어제부터) 끊기지 않은 날', async () => {
    expect(streakOf(['2026-10-16', '2026-10-17', '2026-10-18'], '2026-10-18')).toBe(3)
    expect(streakOf(['2026-10-15', '2026-10-17'], '2026-10-18')).toBe(1)
    expect(streakOf(['2026-10-14'], '2026-10-18')).toBe(0)
    expect(streakOf(['2026-09-30', '2026-10-01'], '2026-10-01')).toBe(2) // 달 넘김
  })

  test('차트: 7일은 요일, 30일은 날짜, 올해는 달. 지금(오늘·이번 달)을 표시', async () => {
    const at = (day: string) => Date.parse(`${day}T03:00:00Z`)
    const list = [entry(at('2026-10-18'), '/r', { kind: 'edit' }), entry(at('2026-10-18'), '/r', { kind: 'chat' }), entry(at('2026-10-13'), '/r', { kind: 'run' }), entry(at('2026-03-02'), '/r', { kind: 'edit' })]
    const w = chartOf('week', list, NOW, KST, MINUTES)
    expect(w.map(b => b.label)).toEqual(['월', '화', '수', '목', '금', '토', '일'])
    expect(w.map(b => b.min)).toEqual([0, 10, 0, 0, 0, 0, 25])
    expect(w.map(b => b.now)).toEqual([false, false, false, false, false, false, true])
    expect(chartOf('today', list, NOW, KST, MINUTES).map(b => b.min)).toEqual(w.map(b => b.min)) // 오늘·어제도 최근 7일
    const m = chartOf('month', list, NOW, KST, MINUTES)
    expect(m).toHaveLength(30)
    expect(m[0]!.label).toBe('19')
    expect(m.at(-1)).toMatchObject({ label: '18', min: 25, now: true })
    const y = chartOf('year', list, NOW, KST, MINUTES)
    expect(y.map(b => b.label)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'])
    expect(y[2]!.min).toBe(20)
    expect(y[9]).toMatchObject({ min: 35, now: true })
    expect(y[10]).toMatchObject({ min: 0, future: true })
  })

  test('큰 숫자: 3줄, 숫자는 3칸 · 점은 1칸 + 사이 1칸', async () => {
    expect(bigDigits('6.1')).toEqual(['┌─╴   ╶┐ ', '├─┐    │ ', '└─┘ . ╶┴╴'])
    expect(bigDigits('10')).toEqual(['╶┐  ┌─┐', ' │  │ │', '╶┴╴ └─┘']) // 1 은 받침이 있어 세로줄 셋(111)과 구별된다
  })

  test('모델 이름', async () => {
    expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
    expect(modelName('claude-haiku-5-5-20261001')).toBe('Haiku 5.5')
    expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
    expect(modelName('gpt-x')).toBe('gpt-x')
    expect(modelName('')).toBe('기록 전')
  })
})

const PANE = { component: 'Pane', requestId: 'look-back', props: { bodyColumns: 80 } } as any
const USAGE = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }

function boot(on: any, interactive = true) {
  const files = new Map<string, string>()
  const mtimes = new Map<string, number>()
  const gitCalls: string[][] = []
  const git = { stderr: '' }
  const clock = mock.clock(on, { now: NOW })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo/order-svc/sub' }))
  on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
  on('session.id', () => ({ value: 'abcdef12-3456' }))
  on('env.get', () => ({ value: '/home/me' }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('fs.write', ($: any, e: any) => { files.set(e.path, e.text); return { value: undefined } })
  on('fs.read', ($: any, e: any) => ({ value: files.get(e.path) ?? '' }))
  // 바로 아래 항목만: 더 깊은 경로가 있으면 폴더
  on('fs.list', ($: any, e: any) => {
    const seen = new Map<string, 'file' | 'dir'>()
    for (const k of files.keys()) {
      if (!k.startsWith(e.path + '/')) continue
      const [name, ...rest] = k.slice(e.path.length + 1).split('/')
      seen.set(name!, rest.length ? 'dir' : 'file')
    }
    return { value: [...seen].map(([name, kind]) => ({ name, kind, mtimeMs: mtimes.get(`${e.path}/${name}`) ?? NOW, size: 0, isLink: false })) }
  })
  on('process.run', ($: any, e: any) => {
    if (e.argv[0] === 'date') return { value: { stdout: '+0900\n', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
    gitCalls.push(e.argv)
    if (git.stderr) return { value: { stdout: '', stderr: git.stderr, exitCode: 128, isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { stdout: `${Math.floor(NOW / 1000) - 60}\tabc1234\tadd order api\n`, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', ($: any, e: any) => (e.text.includes('막힘') ? { drop: 'blocked' } : { text: e.text }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { ...USAGE, model: 'm' } }
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Bash' }, ($: any, e: any) => (e.command === 'npm test' ? { result: '1 failed', isError: true } : { result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  const store = new Map<string, unknown>()
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  return { files, mtimes, gitCalls, clock, interactive, git }
}

const submit = ($: any, text: string, kind = 'composer', turnId?: string) => $.prompt.submit({ text, origin: { kind }, wait: false, ...(turnId ? { turnId } : {}) } as any)
const start = ($: any, turnId: string, text = '') => $.turn.start({ text, turnId } as any)
const step = async ($: any, turnId: string, agentId?: string) => {
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'm', messageCount: 3, ...(agentId ? { agentId } : {}) } as any)) { /* 조각 없음 */ }
}
const complete = ($: any, turnId: string, reason = 'answer', durationMs = 90_000, agentId?: string) =>
  $.turn.complete({ reason, answer: '끝', durationMs, isAborted: reason === 'aborted', turnId, ...(agentId ? { agentId } : {}) } as any)

describe('look-back (hook)', () => {
  test('사람 요청마다 한 줄: 턴으로 결과·시간·토큰·수정 파일을 잇고, 시작한 날짜 파일에 쓴다', async ($, on) => {
    const { files, clock } = boot(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc/sub' } as any)

    await submit($, '/model') // 슬래시 명령은 빼고
    await submit($, '다른 세션 메시지', 'peer') // 사람이 쓰지 않은 입력도 뺀다
    await submit($, '주문 API 추가해 줘\nTOKEN=secret1')
    await start($, 't1', '주문 API 추가해 줘\nTOKEN=secret1')
    await step($, 't1')
    await step($, 't1', 'sub-1') // 서브에이전트 요청은 더하지 않는다
    await $.tool.call({ tool: 'Edit', file_path: '/repo/order-svc/api.ts', tool_use_id: 'u1' } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/order-svc/api.ts', tool_use_id: 'u2' } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/order-svc/x.ts', agentId: 'sub-1', tool_use_id: 'u3' } as any)
    await $.tool.call({ tool: 'Read', file_path: '/repo/order-svc/y.ts', tool_use_id: 'u4' } as any)
    await clock.advance(60_000) // 자정 넘어 끝나도 요청한 날짜에 남는다
    await complete($, 't1')

    // 요청 없이 시작한 턴(작업 알림)은 기록하지 않는다
    await start($, 't2', '<task-notification>done</task-notification>')
    await complete($, 't2')

    const path = '/home/me/.claude/look-back/2026-10-18/abcdef12-'
    const key = [...files.keys()].find(k => k.startsWith(path))!
    expect(key).toMatch(/\/2026-10-18\/abcdef12-[0-9a-f]{4}\.json$/)
    expect([...files.keys()]).toHaveLength(1)
    expect(JSON.parse(files.get(key)!)).toEqual({
      v: 1,
      entries: [{ at: NOW, text: '주문 API 추가해 줘 TOKEN=***', root: '/repo/order-svc', turnId: 't1', end: 'answer', ms: 90_000, tokens: 1120, files: ['/repo/order-svc/api.ts'], kind: 'edit', model: 'm' }],
    })
  })

  test('턴 중에 보낸 요청이 그 턴 안으로 전달돼도 다음 요청들의 결과가 밀리지 않는다, 막힌 요청은 남기지 않는다', async ($, on) => {
    const { files, clock } = boot(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    const rows = () => JSON.parse([...files.values()][0]!).entries.map((e: Entry) => `${e.text}:${e.turnId}:${e.end}:${e.ms}`)

    await submit($, 'A 해 줘')
    await start($, 't1', 'A 해 줘')
    await clock.advance(1000)
    await submit($, 'B 도 같이', 'composer', 't1') // 턴 중 입력: 자기 turn.start 없이 t1 안으로 전달
    await complete($, 't1', 'answer', 10_000)
    await start($, 't2', '<task-notification>done</task-notification>') // 작업 알림 턴은 B 를 가져가지 않는다
    await complete($, 't2', 'answer', 2_000)
    await clock.advance(1000)
    await submit($, '막힘 테스트')
    await submit($, 'C 해 줘')
    await start($, 't3', 'C 해 줘')
    await complete($, 't3', 'aborted', 3_000)

    expect(rows()).toEqual(['A 해 줘:t1:answer:10000', 'B 도 같이::null:0', 'C 해 줘:t3:aborted:3000'])
  })

  test('앞에 공백이 있는 / 글은 엔진이 일반 메시지로 보내므로 요청으로 남긴다 (2026-10-20 시험 F5)', async ($, on) => {
    const { files } = boot(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await submit($, ' /lookback 오늘')
    await start($, 't1', ' /lookback 오늘')
    await complete($, 't1', 'answer', 5_000)

    expect(JSON.parse([...files.values()][0]!).entries.map((e: Entry) => `${e.text}:${e.turnId}:${e.end}`)).toEqual(['/lookback 오늘:t1:answer'])
  })

  test('다른 mod 가 글을 바꿔도 쉬는 중에 보낸 요청 하나면 그 턴에 잇는다', async ($, on) => {
    const { files } = boot(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await submit($, '원래 글')
    await start($, 't1', '다듬어진 글')
    await complete($, 't1')
    expect(JSON.parse([...files.values()][0]!).entries[0]).toMatchObject({ text: '원래 글', turnId: 't1', end: 'answer' })
  })

  test('비대화형(claude -p) 세션은 기록하지 않는다', async ($, on) => {
    const { files } = boot(on)
    await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/repo/order-svc' } as any)
    await submit($, '1+1?', 'sdk')
    await start($, 't1', '1+1?')
    await complete($, 't1')
    expect(files.size).toBe(0)
  })

  test('/lookback: 기간의 기록과 그 저장소의 커밋을 프로젝트별로 패널에 보인다', async ($, on) => {
    const { files, gitCalls } = boot(on)
    // 다른 세션이 어제·오늘 쓴 파일
    files.set('/home/me/.claude/look-back/2026-10-18/other000-aaaa.json', JSON.stringify({ v: 1, entries: [entry(NOW - 3_600_000, '/repo/order-svc', { text: '결제 버그 고쳐 줘', end: 'aborted', ms: 300_000 })] }))
    files.set('/home/me/.claude/look-back/2026-10-17/other000-aaaa.json', JSON.stringify({ v: 1, entries: [entry(NOW - 86_400_000, '/repo/wiki', { text: '어제 요청' })] }))
    files.set('/home/me/.claude/look-back/2026-10-18/broken-bbbb.json', '{"v":1,"entr')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc/sub' } as any)

    expect((await $.command.run({ command: 'lookback', args: '지난달' } as any)).text).toBe('/lookback [오늘|어제|7일|30일|올해] · /lookback report on|off')
    const { text } = await $.command.run({ command: 'lookback', args: '' } as any)
    expect(text).toContain('옆 패널')
    expect(gitCalls).toEqual([['git', '-C', '/repo/order-svc', 'log', '--since-as-filter=2026-10-18T00:00:00+09:00', '--until=2026-10-19T00:00:00+09:00', '--format=%ct%x09%h%x09%s']])

    const ui = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /^오늘 한 일$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2026-10-18$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^요청 1 · Claude 작업 5분 · 결정 0 · 커밋 1 · 프로젝트 1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^order-svc$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^프로젝트 ─+$/ })).toBeDefined() // 합계 줄 위 가로줄
    expect(await ui.find({ type: 'Text', text: /^order-svc ─+$/ })).toBeDefined() // 프로젝트마다 이름 붙은 가로줄
    expect(await ui.find({ type: 'Text', text: /^─ 커밋$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^─ 요청$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^─ 결정$/ })).toBeUndefined() // 빈 묶음은 머리도 없다
    expect(await ui.find({ type: 'Text', text: /abc1234.*add order api/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /10\/18 22:59 .*■ .*결제 버그 고쳐 줘/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /어제 요청/ })).toBeUndefined()
    await ui.unmount()

    await $.command.run({ command: 'lookback', args: '7일' } as any)
    const ui2 = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', ...PANE })
    expect(await ui2.find({ type: 'Text', text: /^2026-10-12 ~ 2026-10-18$/ })).toBeDefined()
    expect(await ui2.find({ type: 'Text', text: /^wiki$/ })).toBeDefined()
    expect(await ui2.find({ type: 'Text', text: /어제 요청/ })).toBeDefined()
    await ui2.unmount()
  })

  test('/lookback: git 이 --since-as-filter 를 모르면(2.37 전) 이유를 적는다', async ($, on) => {
    const { files, git } = boot(on)
    files.set('/home/me/.claude/look-back/2026-10-18/other000-aaaa.json', JSON.stringify({ v: 1, entries: [entry(NOW - 3_600_000, '/repo/order-svc', { text: '결제 버그 고쳐 줘' })] }))
    git.stderr = 'fatal: unrecognized argument: --since-as-filter=2026-10-18T00:00:00+09:00\n'
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.command.run({ command: 'lookback', args: '' } as any)

    const ui = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: '커밋 못 읽음 (git 2.37 이상 필요)' })).toBeDefined()
    await ui.unmount()
  })

  test('/lookback: team-board 가 기록한 결정을 기간으로 걸러 프로젝트별로 보인다', async ($, on) => {
    const { files, mtimes } = boot(on)
    const tb = '/home/me/.claude/team-board'
    files.set('/home/me/.claude/look-back/2026-10-18/s1-aaaa.json', JSON.stringify({ v: 1, entries: [entry(NOW - 600_000, '/repo/order-svc', { text: '배포 준비' })] }))
    // look-back 기록이 있는 저장소: 오늘 결정 1, 어제 결정 1(기간 밖)
    files.set(`${tb}/repo-order-svc/s1.json`, JSON.stringify({ cwd: '/repo/order-svc/sub', decisions: [
      { at: NOW - 86_400_000, question: '어제 질문', answer: '어제 답' },
      { at: NOW - 300_000, question: '커밋, push, 설치를 진행할까요?', answer: '커밋하고 push 후 설치까지 진행해주세요' },
    ] }))
    // look-back 기록이 없는 저장소(설치 전 세션): 그 세션 폴더를 루트로
    files.set(`${tb}/repo-wiki/s2.json`, JSON.stringify({ cwd: '/repo/wiki', decisions: [{ at: NOW - 120_000, question: 'A 로 할까요?', answer: 'A' }] }))
    // 기간 전에 마지막으로 쓴 파일은 읽지 않는다, 모양이 다른 파일은 건너뛴다
    files.set(`${tb}/repo-old/s3.json`, JSON.stringify({ cwd: '/repo/old', decisions: [{ at: NOW - 60_000, question: '안 읽힘', answer: 'x' }] }))
    mtimes.set(`${tb}/repo-old/s3.json`, NOW - 3 * 86_400_000)
    files.set(`${tb}/repo-wiki/broken.json`, '{"dec')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.command.run({ command: 'lookback', args: '' } as any)

    const ui = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /^요청 1 · Claude 작업 1초 · 결정 2 · 커밋 2 · 프로젝트 2$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /23:54 \? 커밋, push, 설치를 진행할까요\? → 커밋하고 push 후 설치까지 진행해주세요/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^wiki$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^결정 1 · 커밋 1$/ })).toBeDefined() // 요청 기록이 없으면 요청·시간·토큰을 빼고
    expect(await ui.find({ type: 'Text', text: /^─ 결정$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /A 로 할까요\? → A/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /어제 질문|안 읽힘/ })).toBeUndefined()
    await ui.unmount()
  })

  test('종류: 도구를 안 쓴 요청은 대화, Bash 만 쓴 요청은 실행(실패한 명령도). 서브에이전트 도구는 세지 않는다', async ($, on) => {
    const { files, clock } = boot(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await submit($, '안녕')
    await start($, 't1', '안녕')
    await complete($, 't1')
    await clock.advance(1000)
    await submit($, '테스트 돌려 줘')
    await start($, 't2', '테스트 돌려 줘')
    await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b1' } as any)
    await $.tool.call({ tool: 'Edit', file_path: '/repo/order-svc/x.ts', agentId: 'sub-1', tool_use_id: 'b2' } as any)
    await complete($, 't2')
    expect(JSON.parse([...files.values()][0]!).entries.map((e: Entry) => `${e.text}:${e.kind}`)).toEqual(['안녕:chat', '테스트 돌려 줘:run'])
  })

  test('/lookback: 한눈에 칸(타일·종류·모델·차트), /lookback report off 로 끄고 on 으로 켠다', { options: { minutes_edit: 30 } }, async ($, on) => {
    const { files } = boot(on)
    files.set('/home/me/.claude/look-back/2026-10-18/s1-aaaa.json', JSON.stringify({ v: 1, entries: [
      entry(NOW - 600_000, '/repo/order-svc', { text: '수정', kind: 'edit', model: 'claude-opus-5-5', ms: 600_000 }),
      entry(NOW - 300_000, '/repo/order-svc', { text: '조사', kind: 'research', model: 'claude-opus-5-5', ms: 60_000 }),
    ] }))
    files.set('/home/me/.claude/look-back/2026-10-17/s1-aaaa.json', JSON.stringify({ v: 1, entries: [entry(NOW - 86_400_000, '/repo/order-svc', { text: '어제', kind: 'chat' })] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.command.run({ command: 'lookback', args: '' } as any)

    const ui = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /^오늘 한 일$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^아낀 시간$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^끝낸 요청$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Claude 작업$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /코드 수정 .* 1 +30분$/ })).toBeDefined() // 설정한 분(30)
    expect(await ui.find({ type: 'Text', text: /조사 .* 1 +15분$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Opus 5\.5 .* 2$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^최근 7일 아낀 시간 50분 · 연속 2일$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^(─+┴){7}$/ })).toBeDefined() // 막대 아래 기준선, 칸 사이 ┴
    expect(await ui.find({ type: 'Text', text: /^( +│){5}/ })).toBeDefined() // 0분인 날도 세로줄로 칸이 보인다
    expect(await ui.find({ type: 'Text', text: /아낀 시간은 추정/ })).toBeDefined()
    await ui.unmount()

    expect((await $.command.run({ command: 'lookback', args: 'report off' } as any)).text).toContain('껐어요')
    await $.command.run({ command: 'lookback', args: '' } as any)
    const off = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', ...PANE })
    expect(await off.find({ type: 'Text', text: /^아낀 시간$/ })).toBeUndefined()
    expect(await off.find({ type: 'Text', text: /^돌아보기 · 2026-10-18$/ })).toBeDefined() // 끄면 지금 화면 그대로
    expect(await off.find({ type: 'Text', text: /수정/ })).toBeDefined()
    await off.unmount()

    expect((await $.command.run({ command: 'lookback', args: 'report on' } as any)).text).toContain('켰어요')
    await $.command.run({ command: 'lookback', args: '올해' } as any)
    const year = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', ...PANE })
    expect(await year.find({ type: 'Text', text: /^올해 한 일$/ })).toBeDefined()
    expect(await year.find({ type: 'Text', text: /^가장 많은 달 10월 · 50분 · 일한 날 2일$/ })).toBeDefined()
    await year.unmount()
  })

  test('/lookback: 좁은 패널에서도 한눈에 칸을 그리고, 끝낸 요청이 없으면 빈 안내', async ($, on) => {
    boot(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.command.run({ command: 'lookback', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', component: 'Pane', requestId: 'look-back', props: { bodyColumns: 30 } } as any)
    expect(await ui.find({ type: 'Text', text: /^오늘 끝낸 요청이 아직 없어요\. 첫 요청이 끝나면 여기에 보여요\.$/ })).toBeDefined()
    await ui.unmount()
  })

  test('/lookback 30일: 기록이 모두 0.3.0 전 것이면 가장 많은 날을 고르지 않는다', async ($, on) => {
    const { files } = boot(on)
    files.set('/home/me/.claude/look-back/2026-10-17/s1-aaaa.json', JSON.stringify({ v: 1, entries: [entry(NOW - 86_400_000, '/repo/order-svc', { text: '옛 요청' })] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.command.run({ command: 'lookback', args: '30일' } as any)
    const ui = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /^일한 날 1일$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /가장 많은/ })).toBeUndefined()
    await ui.unmount()
  })

  test('/lookback: 기록이 없으면 빈 상태 안내', async ($, on) => {
    boot(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.command.run({ command: 'lookback', args: '어제' } as any)
    const ui = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /기록된 요청이 없어요/ })).toBeDefined()
    await ui.unmount()
  })
})
