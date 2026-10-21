import { describe, expect, mock, test } from 'claude-code/testing'

import { contextFor, emptyPlan, GATE_DENY, GATE_RULE, isOpen, MAX_STEPS, normalizeSteps, NUDGE, NUDGE_AFTER, RULE, TOOL_DESCRIPTION, withEnded, withStale, withSteps } from '../hooks/plan'

const NOW = 1_800_000_000_000

describe('plan (순수 함수)', () => {
  test('입력을 단계 목록으로: 배열이 아니면 null, 공백 정리, 빈 제목 버림, 모르는 상태는 todo', async () => {
    expect(normalizeSteps(undefined)).toBeNull()
    expect(normalizeSteps('a')).toBeNull()
    expect(normalizeSteps({ steps: [] })).toBeNull()
    expect(normalizeSteps([])).toEqual([])
    expect(
      normalizeSteps([
        { title: '  math.py 만들기 ', status: 'done' },
        { title: '   ', status: 'doing' },
        { status: 'doing' },
        null,
        { title: '테스트 쓰기', status: 'started' },
        { title: '실행', status: 'blocked' },
      ]),
    ).toEqual([
      { title: 'math.py 만들기', status: 'done' },
      { title: '테스트 쓰기', status: 'todo' },
      { title: '실행', status: 'blocked' },
    ])
  })

  test('제목은 60자(코드 포인트)로 자르고, 단계는 30개까지', async () => {
    const [step] = normalizeSteps([{ title: '가'.repeat(70) + '😀', status: 'todo' }])!
    expect([...step!.title]).toHaveLength(60)
    expect(normalizeSteps([{ title: 'x'.repeat(59) + '😀😀', status: 'todo' }])![0]!.title).toBe('x'.repeat(59) + '😀')
    const many = Array.from({ length: 40 }, (_, i) => ({ title: `s${i}`, status: 'todo' }))
    expect(normalizeSteps(many)).toHaveLength(MAX_STEPS)
  })

  test('새 보고는 목록을 바꾸고 낡음·턴 끝을 지운다, 턴 끝과 압축은 단계를 건드리지 않는다', async () => {
    const steps = [{ title: 'a', status: 'doing' as const }]
    const p0 = emptyPlan(NOW)
    expect(p0).toEqual({ v: 1, steps: [], updatedAt: NOW, stale: false, ended: null })

    const p1 = withSteps(withStale(withEnded(p0, 'answer', NOW)), steps, NOW + 1)
    expect(p1).toEqual({ v: 1, steps, updatedAt: NOW + 1, stale: false, ended: null })

    const p2 = withEnded(p1, 'aborted', NOW + 2)
    expect(p2.ended).toEqual({ reason: 'aborted', at: NOW + 2 })
    expect(p2.steps).toBe(steps)
    expect(p2.updatedAt).toBe(NOW + 1)

    const p3 = withStale(p1)
    expect(p3.stale).toBe(true)
    expect(p3.steps).toBe(steps)
  })

  test('첫 프롬프트 문맥: 시작이면 규칙만, 압축 뒤면 규칙 + 지금 계획', async () => {
    const plan = withSteps(emptyPlan(NOW), [{ title: 'math.py 만들기', status: 'done' }, { title: '테스트 쓰기', status: 'doing' }], NOW)
    expect(contextFor(plan, 'start')).toBe(RULE)
    expect(contextFor(emptyPlan(NOW), 'compact')).toBe(RULE)
    const text = contextFor(plan, 'compact')
    expect(text.startsWith(RULE)).toBe(true)
    expect(text).toContain('- [done] math.py 만들기\n- [doing] 테스트 쓰기')
  })

  test('규칙과 도구 설명은 보고 전용 요청을 막는 v2 문구', async () => {
    expect(RULE).toContain('Never send a response whose only tool call is plan_update')
    expect(RULE).toContain('two or more work tool calls')
    expect(RULE).toContain('even when all of them go in one response')
    expect(RULE).toContain('first plan_update in the same response as your first work tool call')
    expect(RULE).toContain('language the user writes in')
    expect(TOOL_DESCRIPTION).toContain('never alone')
    expect(TOOL_DESCRIPTION).toContain('language the user writes in')
  })

  test('게이트: 문맥에 한 줄 더한다', async () => {
    const plan = withSteps(emptyPlan(NOW), [{ title: 'a', status: 'doing' }], NOW)
    expect(contextFor(plan, 'start', true)).toBe(`${RULE}\n${GATE_RULE}`)
    expect(contextFor(plan, 'compact', true).startsWith(`${RULE}\n${GATE_RULE}\n\n`)).toBe(true)
  })
})

const TOOL = 'mcp__work-plan__plan_update'
const MSGS = [{ role: 'user', text: '요약', toolUses: [] }]
const STEPS = [
  { title: 'math.py 만들기', status: 'doing' },
  { title: '테스트 쓰기', status: 'todo' },
]

// 엔진 $ 에는 state 가 없다. 옆에 실은 plugin 이 work-plan atom 을 읽어 Peek 도구 결과로 돌려준다.
const PEEK = {
  name: 'peek',
  register(on: any) {
    on('tool.call', { tool: 'Peek' }, async ($: any) => ({ result: JSON.stringify((await $.state.get({ plugin: 'work-plan', key: 'plan' })).value ?? null) }))
  },
}
const peek = async ($: any) => JSON.parse(((await $.tool.call({ tool: 'Peek', tool_use_id: 'peek' })) as any).result)

describe('work-plan (hook)', () => {
  test('도구를 등록하고, 보고를 저장하고 문자열로 답한다. 서브에이전트 보고와 잘못된 입력은 저장하지 않는다', { plugins: [PEEK] }, async ($, on) => {
    mock.clock(on, { now: NOW })
    const registered: any[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('tool.register', ($, e: any) => {
      registered.push(e)
      return { value: { tool: `mcp__work-plan__${e.name}` } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({ name: 'plan_update', isDeferred: false, description: TOOL_DESCRIPTION })

    const plan = () => peek($)

    const r: any = await $.tool.call({ tool: TOOL, steps: STEPS, tool_use_id: 'p1' } as any)
    expect(r.result).toBe('ok: 2 steps')
    expect(await plan()).toEqual({ v: 1, steps: STEPS, updatedAt: NOW, stale: false, ended: null })

    const sub: any = await $.tool.call({ tool: TOOL, steps: [{ title: '서브 단계', status: 'doing' }], agentId: 'sub-1', tool_use_id: 'p2' } as any)
    expect(sub.result).toBe('ok: 1 steps')
    expect((await plan()).steps).toEqual(STEPS)

    const bad: any = await $.tool.call({ tool: TOOL, steps: 'x', tool_use_id: 'p3' } as any)
    expect(bad).toEqual({ deny: 'plan_update: steps must be an array of { title, status }' })
    expect((await plan()).steps).toEqual(STEPS)
  })

  test('규칙은 첫 프롬프트에 한 번, compaction 뒤엔 규칙 + 계획, /clear 뒤엔 규칙만 다시 붙는다', { plugins: [PEEK] }, async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const contexts: (readonly string[] | undefined)[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('tool.register', ($, e: any) => ({ value: { tool: `mcp__work-plan__${e.name}` } }))
    on('prompt.submit', ($, e: any) => {
      contexts.push(e.context)
      return { text: e.text }
    })
    on('turn.complete', () => ({ text: '' }))
    on('session.compact', ($, e: any) => ({ messages: e.messages }))
    on('session.end', ($, e: any) => ({ sessionId: e.sessionId }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)

    const plan = () => peek($)
    const submit = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as any)
    const complete = (reason: string, agentId?: string) =>
      $.turn.complete({ reason, answer: '끝', durationMs: 1, isAborted: reason === 'aborted', turnId: 't', ...(agentId ? { agentId } : {}) } as any)

    // 슬래시 명령은 건너뛰고, 첫 일반 프롬프트에 규칙만. 두 번째 프롬프트엔 없음
    await submit('/model')
    await submit('math.py 만들어 줘')
    await submit('계속')
    expect(contexts).toEqual([undefined, [RULE], undefined])

    // 계획이 없으면 턴 끝을 적지 않는다 (atom 은 한 번도 쓰이지 않아 빈 값)
    await complete('answer')
    expect(await plan()).toBeNull()

    await $.tool.call({ tool: TOOL, steps: STEPS, tool_use_id: 'p1' } as any)
    await clock.advance(1_000)
    await complete('answer', 'sub-1') // 서브에이전트 턴은 무시
    expect((await plan()).ended).toBeNull()
    await complete('aborted')
    expect((await plan()).ended).toEqual({ reason: 'aborted', at: NOW + 1_000 })
    expect((await plan()).steps).toEqual(STEPS)

    // precompute·서브에이전트 compaction 은 대화를 바꾸지 않는다
    await $.session.compact({ trigger: 'precompute', messages: MSGS } as any)
    await $.session.compact({ trigger: 'auto', agentId: 'sub-1', messages: MSGS } as any)
    expect((await plan()).stale).toBe(false)
    await submit('이어서')
    expect(contexts.at(-1)).toBeUndefined()

    // 메인 compaction: 낡음 표시, 다음 프롬프트에 규칙 + 지금 계획
    await $.session.compact({ trigger: 'manual', messages: MSGS } as any)
    expect((await plan()).stale).toBe(true)
    await submit('이어서 해 줘')
    expect(contexts.at(-1)).toEqual([contextFor(await plan(), 'compact')])
    expect(contexts.at(-1)![0]).toContain('- [doing] math.py 만들기')
    await $.tool.call({ tool: TOOL, steps: STEPS, tool_use_id: 'p2' } as any)
    expect((await plan()).stale).toBe(false)

    // 다른 이유의 session.end 는 계획을 그대로 둔다
    await $.session.end({ reason: 'other', sessionId: 's', resume: {} } as any)
    expect((await plan()).steps).toEqual(STEPS)

    // /clear: 빈 계획, 다음 프롬프트에 규칙만
    await $.session.end({ reason: 'clear', sessionId: 's', resume: {} } as any)
    expect(await plan()).toMatchObject({ v: 1, steps: [], stale: false, ended: null })
    await submit('새 작업')
    expect(contexts.at(-1)).toEqual([RULE])
  })
})

describe('work-plan planGate (hook)', () => {
  // 엔진 바닥: 도구는 그대로 답한다
  function engine(on: any) {
    mock.clock(on, { now: NOW })
    on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
    on('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__work-plan__${e.name}` } }))
    on('prompt.submit', ($: any, e: any) => ({ text: e.text, context: e.context }))
    on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
    for (const t of ['Edit', 'Write', 'NotebookEdit', 'Bash']) on('tool.call', { tool: t }, () => ({ result: `${t} ok` }))
  }
  const call = ($: any, tool: string, agentId?: string) => $.tool.call({ tool, tool_use_id: tool, ...(agentId ? { agentId } : {}) } as any)
  const start = ($: any, turnId: string, agentId?: string) => $.turn.start({ text: '', turnId, ...(agentId ? { agentId } : {}) } as any)
  const report = ($: any, steps: unknown, agentId?: string) => $.tool.call({ tool: TOOL, steps, tool_use_id: 'p', ...(agentId ? { agentId } : {}) } as any)

  test('기본값(꺼짐): 계획 없이도 Edit 를 막지 않고 규칙에 게이트 줄이 없다', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    const r: any = await $.prompt.submit({ text: '고쳐 줘', origin: { kind: 'composer' }, wait: false } as any)
    expect(r.context).toEqual([RULE])
    await start($, 't1')
    expect(((await call($, 'Edit')) as any).result).toBe('Edit ok')
  })

  test('켜짐: 이번 턴 계획 보고 전 파일 변경 도구만 거부, 보고 뒤 풀림, 턴마다 다시, 3번 거부 뒤 풀림', { options: { planGate: true } }, async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    const r: any = await $.prompt.submit({ text: '고쳐 줘', origin: { kind: 'composer' }, wait: false } as any)
    expect(r.context).toEqual([`${RULE}\n${GATE_RULE}`])

    await start($, 't1')
    expect(await call($, 'Edit')).toEqual({ deny: GATE_DENY })
    expect(((await call($, 'Bash')) as any).result).toBe('Bash ok')
    expect(((await call($, 'Edit', 'sub-1')) as any).result).toBe('Edit ok') // 서브에이전트는 막지 않는다

    // 빈 계획 보고, 잘못된 보고, 서브의 보고는 풀지 않는다
    await report($, [])
    await report($, 'x')
    await report($, STEPS, 'sub-1')
    expect(await call($, 'Write')).toEqual({ deny: GATE_DENY })

    // 메인의 보고 뒤로는 통과
    await report($, STEPS)
    expect(((await call($, 'Edit')) as any).result).toBe('Edit ok')
    expect(((await call($, 'NotebookEdit')) as any).result).toBe('NotebookEdit ok')

    // 서브의 턴 시작은 메인 판정을 지우지 않고, 메인의 새 턴은 지운다
    await start($, 's1', 'sub-1')
    expect(((await call($, 'Edit')) as any).result).toBe('Edit ok')
    await start($, 't2')
    expect(await call($, 'Edit')).toEqual({ deny: GATE_DENY })

    // fail-open: 이 턴에서 세 번째 거부 뒤에는 통과
    expect(await call($, 'Write')).toEqual({ deny: GATE_DENY })
    expect(await call($, 'Edit')).toEqual({ deny: GATE_DENY })
    expect(((await call($, 'Edit')) as any).result).toBe('Edit ok')
    await start($, 't3')
    expect(await call($, 'Edit')).toEqual({ deny: GATE_DENY })
  })
})

describe('work-plan 갱신 알림 (hook)', () => {
  function engine(on: any) {
    mock.clock(on, { now: NOW })
    on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
    on('tool.register', ($: any, e: any) => ({ value: { tool: `mcp__work-plan__${e.name}` } }))
    on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    for (const t of ['Edit', 'Write', 'NotebookEdit', 'Bash', 'Read']) on('tool.call', { tool: t }, () => ({ result: `${t} ok` }))
  }
  const call = ($: any, tool: string, agentId?: string) => $.tool.call({ tool, tool_use_id: tool, ...(agentId ? { agentId } : {}) } as any)
  const report = ($: any, steps: unknown) => $.tool.call({ tool: TOOL, steps, tool_use_id: 'p' } as any)
  // n 번 부르고 알림이 붙은 차례(1부터)를 돌려준다
  const nudgedAt = async ($: any, tools: string[], agentId?: string) => {
    const hits: number[] = []
    for (const [i, t] of tools.entries()) if (((await call($, t, agentId)) as any).context?.includes(NUDGE)) hits.push(i + 1)
    return hits
  }

  test('isOpen: 단계가 있고, 턴이 안 끝났고, 남은 단계가 있을 때만', async () => {
    expect(isOpen(emptyPlan(NOW))).toBe(false)
    const open = withSteps(emptyPlan(NOW), [{ title: 'a', status: 'done' }, { title: 'b', status: 'doing' }], NOW)
    expect(isOpen(open)).toBe(true)
    expect(isOpen(withEnded(open, 'answer', NOW))).toBe(false)
    expect(isOpen(withSteps(open, [{ title: 'a', status: 'done' }], NOW))).toBe(false)
  })

  test('계획이 열린 동안 작업 도구 5번째마다 한 줄, 보고하면 셈이 0', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)

    // 계획 없으면 붙지 않는다
    expect(await nudgedAt($, ['Bash', 'Bash', 'Bash', 'Bash', 'Bash', 'Bash'])).toEqual([])

    await report($, STEPS)
    // Read 는 세지 않는다. Edit·Write·NotebookEdit·Bash 를 센다
    expect(await nudgedAt($, ['Bash', 'Read', 'Edit', 'Write', 'NotebookEdit', 'Bash', 'Bash', 'Bash', 'Bash', 'Bash', 'Bash'])).toEqual([6, 11])
    expect(NUDGE_AFTER).toBe(5)

    // 보고가 셈을 지운다
    await nudgedAt($, ['Bash', 'Bash', 'Bash', 'Bash'])
    await report($, STEPS)
    expect(await nudgedAt($, ['Bash', 'Bash', 'Bash', 'Bash', 'Bash'])).toEqual([5])

    // 결과는 그대로 두고 context 만 더한다
    await nudgedAt($, ['Bash', 'Bash', 'Bash', 'Bash'])
    const r: any = await call($, 'Edit')
    expect(r.result).toBe('Edit ok')
    expect(r.context).toEqual([NUDGE])
  })

  test('서브에이전트 호출은 세지 않고, 턴이 끝난 계획이나 모두 끝난 계획에는 붙지 않는다', async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    await report($, STEPS)
    expect(await nudgedAt($, ['Bash', 'Bash', 'Bash', 'Bash', 'Bash', 'Bash'], 'sub-1')).toEqual([])
    expect(await nudgedAt($, ['Bash', 'Bash', 'Bash', 'Bash'])).toEqual([])

    await report($, [{ title: 'a', status: 'done' }])
    expect(await nudgedAt($, ['Bash', 'Bash', 'Bash', 'Bash', 'Bash'])).toEqual([])

    await report($, STEPS)
    await $.turn.complete({ reason: 'answer', answer: '끝', durationMs: 1, isAborted: false, turnId: 't' } as any)
    expect(await nudgedAt($, ['Bash', 'Bash', 'Bash', 'Bash', 'Bash'])).toEqual([])
  })

  test('게이트가 거부한 호출은 세지 않는다', { options: { planGate: true } }, async ($, on) => {
    engine(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    await report($, STEPS)
    await $.turn.start({ text: '', turnId: 't2' } as any)
    // 새 턴: 계획 보고 전이라 Edit 는 거부된다 (계획 자체는 열려 있음)
    expect(await nudgedAt($, ['Edit', 'Edit', 'Bash', 'Bash', 'Bash', 'Bash'])).toEqual([])
    expect(await nudgedAt($, ['Bash'])).toEqual([1])
  })
})
