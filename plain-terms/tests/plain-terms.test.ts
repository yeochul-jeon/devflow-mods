import { describe, expect, test } from 'claude-code/testing'

import { RULE } from '../hooks/rule'

const MSGS = [{ role: 'user', text: '요약', toolUses: [] }]

describe('plain-terms', () => {
  test('규칙은 첫 일반 프롬프트에 한 번, 메인 compaction 뒤와 /clear·/resume 뒤에 다시 한 번', async ($, on) => {
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
    let seen: readonly string[] | undefined
    on('prompt.submit', ($, e: any) => {
      seen = e.context
      return { text: e.text }
    })
    await $.prompt.submit({ text: '질문', context: ['앞 문맥'], origin: { kind: 'composer' }, wait: false } as any)
    expect(seen).toEqual(['앞 문맥', RULE])
  })
})
