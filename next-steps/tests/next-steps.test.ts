import { describe, expect, mock, test } from 'claude-code/testing'

import { buildRequest, parseSteps } from '../hooks/steps'

const USAGE = { input_tokens: 1800, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND = { plugin: 'next-steps', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as any
// 제안은 턴을 붙잡지 않고 뒤에서 만들므로 잠깐 기다린다 (lib 에 DOM 이 없어 globalThis 로)
const settle = () => new Promise(r => (globalThis as any).setTimeout(r, 20))
const LONG_ANSWER = 'README 의 설치 절을 고쳤고 테스트 48개가 모두 통과했습니다.'

describe('steps (순수 함수)', () => {
  test('번호·글머리·따옴표를 걷고 3개까지, NONE 이면 없음, 너무 긴 줄은 자르지 않고 버린다', async () => {
    expect(parseSteps('1. 테스트를 다시 돌려 줘\n- `board.ts` 도 같은 검사를 넣어 줘\n"PR 초안을 만들어 줘"\n4) 네 번째')).toEqual([
      '테스트를 다시 돌려 줘',
      '`board.ts` 도 같은 검사를 넣어 줘',
      'PR 초안을 만들어 줘',
    ])
    expect(parseSteps('NONE')).toEqual([])
    expect(parseSteps('\n\n')).toEqual([])
    expect(parseSteps('짧은 것\n' + 'x'.repeat(121))).toEqual(['짧은 것'])
  })

  test('출력 상한에 닿아 끝났으면 마지막 줄은 잘렸을 수 있어 버린다', async () => {
    expect(parseSteps('테스트를 다시 돌려 줘\nPR 초안을 만들', true)).toEqual(['테스트를 다시 돌려 줘'])
    expect(parseSteps('테스트를 다시 돌려 줘\nPR 초안을 만들어 줘', false)).toHaveLength(2)
  })

  test('최근 대화와 최신 답을 잘라 넣고, 대화 언어를 따르라고 한다', async () => {
    const history = Array.from({ length: 9 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `m${i} ` + 'a'.repeat(900) }) as const)
    const { system, prompt } = buildRequest([...history], 'b'.repeat(3000))
    expect(prompt).not.toContain('m0 ') // 최근 6개만
    expect(prompt).toContain('m3 ')
    expect(prompt).not.toContain('a'.repeat(801)) // 메시지마다 800자
    expect(prompt).toContain('b'.repeat(2000))
    expect(prompt).not.toContain('b'.repeat(2001)) // 최신 답은 2000자
    expect(system).toContain('same language')
    expect(system).toContain('NONE')
    expect(system).toContain('under 60 characters')
  })
})

describe('next-steps', () => {
  test('답이 끝나면 제안을 띄우고, 숫자로 초안을 넣고, 0·전송·새 턴에 지운다', async ($, on) => {
    mock.store(on)
    let calls = 0
    let asked: any = null
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('agent.list', () => ({ value: [] }))
    on('session.messages', () => ({ value: [{ role: 'user', text: '설치 절 고쳐 줘', toolUses: [] }, { role: 'assistant', text: LONG_ANSWER, toolUses: [] }] }))
    on('model.complete', ($, e: any) => {
      calls += 1
      asked = e
      return { value: { isAnswered: true, text: '테스트를 다시 돌려 줘\nPR 초안을 만들어 줘', usage: USAGE } }
    })
    on('turn.complete', () => ({ text: '' }))
    on('turn.start', () => ({}) as any)
    on('prompt.submit', ($, e: any) => ({ text: e.text }))
    on('prompt.edit', ($, e: any) => ({ text: e.text + e.inputText, cursor: e.text.length + e.inputText.length }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    const complete = (turnId: string, answer = LONG_ANSWER, agentId?: string) =>
      $.turn.complete({ reason: 'answer', answer, durationMs: 1, isAborted: false, turnId, ...(agentId ? { agentId } : {}) } as any)
    // prompt.edit 은 testing 의 Engine 타입(EventCalls)에 빠져 있다. 실행은 된다
    const key = (inputText: string) => ($ as any).prompt.edit({ origin: { kind: 'composer' }, key: { name: inputText }, text: '', cursor: 0, start: 0, end: 0, inputText } as any)

    // 짧은 답·서브에이전트 턴은 부르지 않는다
    await complete('t0', '네.')
    await complete('s1', LONG_ANSWER, 'sub-1')
    await settle()
    expect(calls).toBe(0)

    await complete('t1')
    await settle()
    expect(calls).toBe(1)
    expect(asked.model).toBe('haiku')
    expect(asked.maxTokens).toBe(200)

    let band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /OTHER-MOD-BAND/ })).toBeDefined() // 다른 mod 의 띠를 가리지 않는다
    expect(await band.find({ type: 'Text', text: /테스트를 다시 돌려 줘/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /0 닫기/ })).toBeDefined()
    await band.unmount()

    // 빈 입력창의 2 → 두 번째 제안이 초안으로. 보내지는 않는다
    expect((await key('2')).text).toBe('PR 초안을 만들어 줘')
    // 없는 번호는 그냥 글자
    expect((await key('7')).text).toBe('7')

    // 0 은 닫기
    expect((await key('0')).text).toBe('')
    band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /테스트를 다시 돌려 줘/ })).toBeUndefined()
    await band.unmount()
    expect((await key('1')).text).toBe('1') // 닫은 뒤의 숫자는 그냥 글자

    // 전송하면 지운다
    await complete('t2')
    await settle()
    await $.prompt.submit({ text: '다른 걸 할게', origin: { kind: 'composer' } } as any)
    band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /PR 초안/ })).toBeUndefined()
    await band.unmount()

    // 사용량은 /next 로 본다
    const status = await $.command.run({ command: 'next', args: '' } as any)
    expect(status.text).toContain('2회')
    expect(status.text).toContain('3,600')

    // 끄면 부르지 않고, 다시 켜면 부른다. 상태는 저장된다
    expect((await $.command.run({ command: 'next', args: 'off' } as any)).text).toContain('껐어요')
    await complete('t3')
    await settle()
    expect(calls).toBe(2)
    expect((await $.command.run({ command: 'next', args: 'on' } as any)).text).toContain('켰어요')
    await complete('t4')
    await settle()
    expect(calls).toBe(3)
  })

  test('모델 호출이 실패하면 알리고, 제안은 띄우지 않는다', async ($, on) => {
    mock.store(on)
    const toasts: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('agent.list', () => ({ value: [] }))
    on('session.messages', () => ({ value: [] }))
    on('model.complete', () => ({ value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE } as any }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.toast', ($, e: any) => { toasts.push(e.text); return { value: undefined } })
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    await $.turn.complete({ reason: 'answer', answer: LONG_ANSWER, durationMs: 1, isAborted: false, turnId: 't1' } as any)
    await settle()
    expect(toasts.join('\n')).toContain('api-error')
    const band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /0 닫기/ })).toBeUndefined()
    await band.unmount()
  })
})
