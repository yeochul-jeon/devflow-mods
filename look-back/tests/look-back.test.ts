import { describe, expect, mock, test } from 'claude-code/testing'

import type { Entry } from '../types'
import {
  buildReport, clockText, dayOf, summaryPrompt, dayStartIso, durationText, nextDay, parseGitLog, parseOffset, periodDays, requestText, tokensText, upsert,
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

const PANE = { component: 'Pane', requestId: 'look-back', props: { bodyColumns: 80 } } as any
const USAGE = { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 }

function boot(on: any, interactive = true) {
  const files = new Map<string, string>()
  const gitCalls: string[][] = []
  const clock = mock.clock(on, { now: NOW })
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.cwd', () => ({ value: '/repo/order-svc/sub' }))
  on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
  on('session.id', () => ({ value: 'abcdef12-3456' }))
  on('env.get', () => ({ value: '/home/me' }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('fs.write', ($: any, e: any) => { files.set(e.path, e.text); return { value: undefined } })
  on('fs.read', ($: any, e: any) => ({ value: files.get(e.path) ?? '' }))
  on('fs.list', ($: any, e: any) => ({
    value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
  }))
  on('process.run', ($: any, e: any) => {
    if (e.argv[0] === 'date') return { value: { stdout: '+0900\n', stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
    gitCalls.push(e.argv)
    return { value: { stdout: `${Math.floor(NOW / 1000) - 60}\tabc1234\tadd order api\n`, stderr: '', exitCode: 0, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('prompt.submit', ($: any, e: any) => (e.text.includes('막힘') ? { drop: 'blocked' } : { text: e.text }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('turn.step', async function* ($: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { ...USAGE, model: 'm' } }
  })
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  on('tool.call', { tool: 'Read' }, () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  return { files, gitCalls, clock, interactive }
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
      entries: [{ at: NOW, text: '주문 API 추가해 줘 TOKEN=***', root: '/repo/order-svc', turnId: 't1', end: 'answer', ms: 90_000, tokens: 1120, files: ['/repo/order-svc/api.ts'] }],
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

    expect((await $.command.run({ command: 'lookback', args: '지난달' } as any)).text).toBe('/lookback [오늘|어제|7일|30일]')
    const { text } = await $.command.run({ command: 'lookback', args: '' } as any)
    expect(text).toContain('옆 패널')
    expect(gitCalls).toEqual([['git', '-C', '/repo/order-svc', 'log', '--since=2026-10-18T00:00:00+09:00', '--until=2026-10-19T00:00:00+09:00', '--format=%ct%x09%h%x09%s']])

    const ui = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /^돌아보기 · 2026-10-18$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^요청 1 · Claude 작업 5분 · 커밋 1 · 프로젝트 1$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^order-svc$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /abc1234.*add order api/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /10\/18 22:59 .*■ .*결제 버그 고쳐 줘/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /어제 요청/ })).toBeUndefined()
    await ui.unmount()

    await $.command.run({ command: 'lookback', args: '7일' } as any)
    const ui2 = await $.ui.mount({ plugin: 'look-back', surface: 'terminal', ...PANE })
    expect(await ui2.find({ type: 'Text', text: /^돌아보기 · 2026-10-12 ~ 2026-10-18$/ })).toBeDefined()
    expect(await ui2.find({ type: 'Text', text: /^wiki$/ })).toBeDefined()
    expect(await ui2.find({ type: 'Text', text: /어제 요청/ })).toBeDefined()
    await ui2.unmount()
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
