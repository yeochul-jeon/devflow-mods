import { describe, expect, mock, test } from 'claude-code/testing'

import { AWAY_MS, RETURN_NOTE, RULE } from '../hooks/rule'

const MSGS = [{ role: 'user', text: '요약', toolUses: [] }]

describe('plain-terms', () => {
  test('규칙은 첫 일반 프롬프트에 한 번, 메인 compaction 뒤와 /clear·/resume 뒤에 다시 한 번', async ($, on) => {
    mock.clock(on) // 규칙이 자리 비움을 보려고 시각을 읽는다
    const contexts: (readonly string[] | undefined)[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('prompt.submit', ($, e: any) => {
      contexts.push(e.context)
      return { text: e.text }
    })
    on('session.compact', ($, e: any) => ({ messages: e.messages }))
    on('session.end', ($, e: any) => ({ sessionId: e.sessionId }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    const submit = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as any)
    const last = () => contexts.at(-1)

    // 슬래시 명령은 건너뛰고 첫 일반 프롬프트에 규칙. 두 번째엔 없음
    await submit('/model')
    await submit('설명해 줘')
    await submit('계속')
    expect(contexts).toEqual([undefined, [RULE], undefined])

    // precompute·서브에이전트 compaction 은 대화를 바꾸지 않는다
    await $.session.compact({ trigger: 'precompute', messages: MSGS } as any)
    await $.session.compact({ trigger: 'auto', agentId: 'sub-1', messages: MSGS } as any)
    await submit('이어서')
    expect(last()).toBeUndefined()

    await $.session.compact({ trigger: 'manual', messages: MSGS } as any)
    await submit('이어서 해 줘')
    expect(last()).toEqual([RULE])

    // 다른 이유의 session.end 는 그대로
    await $.session.end({ reason: 'other', sessionId: 's', resume: {} } as any)
    await submit('또')
    expect(last()).toBeUndefined()

    await $.session.end({ reason: 'clear', sessionId: 's', resume: {} } as any)
    await submit('새 작업')
    expect(last()).toEqual([RULE])
    await $.session.end({ reason: 'resume', sessionId: 's', resume: {} } as any)
    await submit('다시')
    expect(last()).toEqual([RULE])
  })

  test('다른 mod 가 붙인 문맥은 그대로 두고 뒤에 붙인다', async ($, on) => {
    mock.clock(on) // 규칙이 자리 비움을 보려고 시각을 읽는다
    let seen: readonly string[] | undefined
    on('prompt.submit', ($, e: any) => {
      seen = e.context
      return { text: e.text }
    })
    await $.prompt.submit({ text: '질문', context: ['앞 문맥'], origin: { kind: 'composer' }, wait: false } as any)
    expect(seen).toEqual(['앞 문맥', RULE])
  })

  test('막힌 보내기(drop)는 규칙을 쓰지 않는다. 다음에 실제로 들어가는 프롬프트에 붙인다', async ($, on) => {
    mock.clock(on) // 규칙이 자리 비움을 보려고 시각을 읽는다
    const contexts: (readonly string[] | undefined)[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('prompt.submit', ($, e: any) => {
      contexts.push(e.context)
      return e.text.startsWith('HOLD') ? { drop: 'prompt-coach: 질문에 답하면 다듬어요' } : { text: e.text }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    const submit = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as any)
    await submit('HOLD 설명해 줘')
    await submit('다듬은 요청')
    await submit('계속')
    expect(contexts).toEqual([[RULE], [RULE], undefined])
  })

  test('30분 넘게 비웠다 돌아온 프롬프트에는 다시 풀라는 한 줄. 첫 프롬프트는 규칙만, 30분 안이면 없음', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const contexts: (readonly string[] | undefined)[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('prompt.submit', ($, e: any) => {
      contexts.push(e.context)
      return { text: e.text }
    })
    on('session.end', ($, e: any) => ({ sessionId: e.sessionId }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    const submit = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as any)

    expect(AWAY_MS).toBe(30 * 60_000)
    await submit('설명해 줘')
    await clock.advance(AWAY_MS - 60_000)
    await submit('계속')
    expect(contexts).toEqual([[RULE], undefined])

    // 슬래시 명령도 자리에 있었다는 표시다: 그 뒤 30분 안이면 붙이지 않는다
    await clock.advance(AWAY_MS - 60_000)
    await submit('/model')
    await clock.advance(60_000)
    await submit('이어서')
    expect(contexts.at(-1)).toBeUndefined()

    await clock.advance(AWAY_MS)
    await submit('돌아왔어')
    expect(contexts.at(-1)).toEqual([RETURN_NOTE])
    await submit('그다음')
    expect(contexts.at(-1)).toBeUndefined()

    // 규칙을 다시 붙일 때(/clear 뒤)는 규칙만. 규칙이 이미 처음부터 다시 풀게 한다
    await clock.advance(AWAY_MS)
    await $.session.end({ reason: 'clear', sessionId: 's', resume: {} } as any)
    await submit('새 작업')
    expect(contexts.at(-1)).toEqual([RULE])
  })

  test('돌아온 뒤 슬래시 명령을 먼저 쳤거나 첫 보내기가 막혀도 알림은 다음에 실제로 들어가는 프롬프트에 붙는다', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const contexts: (readonly string[] | undefined)[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('prompt.submit', ($, e: any) => {
      contexts.push(e.context)
      return e.text.startsWith('HOLD') ? { drop: 'prompt-coach: 질문에 답하면 다듬어요' } : { text: e.text }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    const submit = (text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as any)

    await submit('설명해 줘')
    await clock.advance(AWAY_MS + 60_000)
    await submit('/board')
    await submit('돌아왔어')
    expect(contexts.slice(1)).toEqual([undefined, [RETURN_NOTE]])

    await clock.advance(AWAY_MS)
    await submit('HOLD 다시 볼래')
    await submit('다듬은 요청')
    await submit('계속')
    expect(contexts.slice(3)).toEqual([[RETURN_NOTE], [RETURN_NOTE], undefined])
  })

  test('작업 알림·다른 세션 메시지는 자리 비움 시각을 옮기지 않고 알림도 쓰지 않는다', async ($, on) => {
    const clock = mock.clock(on, { now: 1_000_000 })
    const contexts: (readonly string[] | undefined)[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('prompt.submit', ($, e: any) => {
      contexts.push(e.context)
      return { text: e.text }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    const submit = (text: string, kind = 'composer') => $.prompt.submit({ text, origin: { kind }, wait: false } as any)

    await submit('설명해 줘')
    await clock.advance(AWAY_MS + 60_000)
    await submit('<task-notification>끝남</task-notification>', 'task-notification')
    await submit('다른 세션에서 온 말', 'peer')
    await submit('돌아왔어')
    expect(contexts.slice(1)).toEqual([undefined, undefined, [RETURN_NOTE]])
  })

  test('규칙은 대화에서 처음 한 번만 풀게 한다 (답마다 다시 풀지 않는다)', () => {
    expect(RULE).not.toContain('In each reply')
    expect(RULE).not.toContain('once per reply')
    expect(RULE).toContain('once per conversation')
  })
})
