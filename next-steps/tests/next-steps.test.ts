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
  test('답이 끝나면 제안을 띄우고, 숫자는 Button hotkey 로 받고, 0·전송·새 턴에 지운다', async ($, on) => {
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
    expect((await band.find({ key: 'close' }))?.text).toBe('닫기 ') // 번호 '0: ' 은 엔진이 hotkey 로 그린다
    // 위 대화와 나누는 이름 붙은 가로줄. 띠 폭(bodyColumns 120)을 채운다
    expect(await band.find({ type: 'Text', text: /^── next-steps ─{106}$/ })).toBeDefined()
    // 다른 mod 띠가 먼저(위), 이 mod 는 그 아래
    expect(JSON.stringify(((await band.find({ type: 'Box' })) as any).children[0])).toContain('OTHER-MOD-BAND')
    // 숫자는 Button hotkey: 엔진이 빈 입력창의 숫자를 화면에 보이는 띠 Button 으로 보낸다. 띠가 가려지면 다른 띠(Heads up 등)의 숫자를 가져가지 않는다
    expect((await band.find({ key: 'step-1' }))?.props).toMatchObject({ hotkey: '1', plain: true })
    expect((await band.find({ key: 'step-2' }))?.props).toMatchObject({ hotkey: '2' })
    expect((await band.find({ key: 'close' }))?.props).toMatchObject({ hotkey: '0' })
    // 입력창 글은 가로채지 않는다
    expect((await key('2')).text).toBe('2')

    // 0 은 닫기
    await band.press({ key: 'close' })
    await band.unmount()
    band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /테스트를 다시 돌려 줘/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: /next-steps/ })).toBeUndefined()
    await band.unmount()

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

  test('제안 줄을 누르면 커서 자리에 끼워 넣고 보내지 않는다. 줄은 마우스를 올리면 음영, 한 줄 모드도 같다', async ($, on) => {
    mock.store(on)
    const fills: any[] = []
    const submits: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('agent.list', () => ({ value: [] }))
    on('session.messages', () => ({ value: [] }))
    on('model.complete', () => ({ value: { isAnswered: true, text: '테스트를 다시 돌려 줘\nPR 초안을 만들어 줘', usage: USAGE } }))
    on('turn.complete', () => ({ text: '' }))
    on('prompt.fill', ($, e: any) => { fills.push({ text: e.text, mode: e.mode }); return { isFilled: true } })
    on('prompt.submit', ($, e: any) => { submits.push(e.text); return { text: e.text } })
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    await $.turn.complete({ reason: 'answer', answer: LONG_ANSWER, durationMs: 1, isAborted: false, turnId: 't1' } as any)
    await settle()

    let band = await $.ui.mount(BAND)
    // 번호까지 한 Button 이라 마우스 반전이 줄 전체에 걸린다. 반전은 화면에서 본다
    // 끝의 공백 한 칸: 반전이 오른쪽 끝에서 한 칸 모자라 마지막 넓은 글자가 반만 덮이던 것을 그 칸이 받는다
    expect((await band.find({ key: 'step-2' }))?.text).toBe('PR 초안을 만들어 줘 ')
    await band.press({ key: 'step-2' })
    expect(fills).toEqual([{ text: 'PR 초안을 만들어 줘', mode: 'insert' }])
    expect(submits).toEqual([])
    await band.unmount()

    // 줄이 모자라 한 줄에 모아도 누를 수 있다
    band = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 3 } })
    // 폭이 넘치면 줄어드는 건 라벨·구분 기호뿐이라 사라졌다. 엔진은 hotkey 번호(`1: `)를 뺀 폭으로 재서 버튼 앞 글자가 번호 폭만큼 덮였다.
    // 글자마다 줄지 않는 Box 에 담아 오른쪽 끝에서만 잘리게 한다
    const row = await band.find({ key: 'one-row' })
    const parts = row?.children.filter((c: any) => c.type === 'Box') ?? []
    expect(parts.length).toBe(6) // 다음:, 제안 2, 구분 2, 닫기
    expect(parts.every((c: any) => c.props.flexShrink === 0)).toBe(true)
    expect(row?.text).toMatch(/^다음: 테스트를 다시 돌려 줘 {2}· {2}PR 초안을 만들어 줘 {2}· {2}닫기 $/)
    await band.press({ key: 'step-1' })
    expect(fills.at(-1)).toEqual({ text: '테스트를 다시 돌려 줘', mode: 'insert' })
    // 0 닫기도 Button 이라 누르면 닫힌다
    expect((await band.find({ key: 'close' }))?.text).toBe('닫기 ') // 번호 '0: ' 은 엔진이 hotkey 로 그린다
    await band.press({ key: 'close' })
    await band.unmount()
    band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /테스트를 다시 돌려 줘/ })).toBeUndefined()
    await band.unmount()

    // 여러 줄 모양의 0 닫기도 누를 수 있다. 안내 글은 버튼 밖
    await $.turn.complete({ reason: 'answer', answer: LONG_ANSWER, durationMs: 1, isAborted: false, turnId: 't2' } as any)
    await settle()
    band = await $.ui.mount(BAND)
    expect((await band.find({ key: 'close' }))?.text).toBe('닫기 ') // 번호 '0: ' 은 엔진이 hotkey 로 그린다
    expect(await band.find({ type: 'Text', text: /클릭이나 빈 입력창에서 숫자/ })).toBeDefined()
    await band.press({ key: 'close' })
    await band.unmount()
    band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /PR 초안/ })).toBeUndefined()
    await band.unmount()
  })

  test('제안 띠 줄 수를 먼저 떼고 남은 줄만 다른 mod 띠에 넘긴다. 제안이 없거나 작업 중이면 그대로 넘긴다', async ($, on) => {
    mock.store(on)
    const seen: number[] = []
    const own: (number | undefined)[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('agent.list', () => ({ value: [] }))
    on('session.messages', () => ({ value: [] }))
    on('model.complete', () => ({ value: { isAnswered: true, text: '테스트를 다시 돌려 줘\nPR 초안을 만들어 줘', usage: USAGE } }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => { seen.push(e.props.maxRows); own.push(e.props.nextStepsRows); return $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }) })
    const rowsAt = async (maxRows: number, props: any = {}) => {
      const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows, ...props } })
      await band.unmount()
      return seen.at(-1)
    }

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    expect(await rowsAt(10)).toBe(10) // 제안이 없으면 다 넘긴다
    expect(own.at(-1)).toBeUndefined()

    await $.turn.complete({ reason: 'answer', answer: LONG_ANSWER, durationMs: 1, isAborted: false, turnId: 't1' } as any)
    await settle()
    expect(await rowsAt(10)).toBe(6) // 여러 줄: 가로줄 + 제안 2 + 닫기 줄 = 4
    // 뗀 줄 수를 안쪽 mod 에 알린다. team-board 가 이 줄을 다시 빼지 않는다 (T55)
    expect(own.at(-1)).toBe(4)
    expect(await rowsAt(4)).toBe(2) // 한 줄 모양: 가로줄 + 한 줄 = 2
    expect(await rowsAt(2)).toBe(1) // 3줄도 안 되면 가로줄을 빼 한 줄만 쓴다. 다른 mod 와 한 줄씩 나눈다
    expect(await rowsAt(1)).toBe(0)
    // 받은 줄이 없으면 그리지 않는다. 그려서 넘치면 엔진이 "↓ n more" 에 한 줄을 더 써 위 띠까지 가려진다
    expect(await rowsAt(0)).toBe(0)
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 0 } })
    expect(await band.find({ type: 'Text', text: /테스트를 다시 돌려 줘/ })).toBeUndefined()
    await band.unmount()
    expect(await rowsAt(10, { isWorking: true })).toBe(10)
    expect(own.at(-1)).toBeUndefined()
    expect(await rowsAt(10, { hasSurvey: true })).toBe(10)
  })

  test('다른 띠(엔진 Heads up 등)에 숫자 hotkey 가 있으면 숫자를 달지 않고 클릭만 받는다', async ($, on) => {
    mock.store(on)
    let other = true
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('agent.list', () => ({ value: [] }))
    on('session.messages', () => ({ value: [] }))
    on('model.complete', () => ({ value: { isAnswered: true, text: '테스트를 다시 돌려 줘\nPR 초안을 만들어 줘', usage: USAGE } }))
    on('turn.complete', () => ({ text: '' }))
    // Heads up 처럼 Box 안에 숫자 hotkey Button 을 그리는 띠
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => {
      const { Box, Text, Button } = $.ui.resolve(e)
      return Box({ flexDirection: 'column', children: [Text({ children: 'HEADS-UP' }), Box({ children: other ? [Button({ key: 'learn', label: 'Learn more', hotkey: '1', plain: true, onPress: () => {} })] : [] })] })
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    await $.turn.complete({ reason: 'answer', answer: LONG_ANSWER, durationMs: 1, isAborted: false, turnId: 't1' } as any)
    await settle()

    // 같은 숫자는 나중에 그린 이 띠가 이긴다. 그러면 위 띠의 1·2·0 을 빼앗으므로 양보한다
    let band = await $.ui.mount(BAND)
    expect((await band.find({ key: 'step-1' }))?.props.hotkey).toBeUndefined()
    expect((await band.find({ key: 'close' }))?.props.hotkey).toBeUndefined()
    expect(await band.find({ type: 'Text', text: /클릭으로 고르기/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /빈 입력창에서 숫자/ })).toBeUndefined()
    await band.unmount()

    // 위 띠의 숫자 버튼이 사라지면 다시 숫자를 단다
    other = false
    band = await $.ui.mount(BAND)
    expect((await band.find({ key: 'step-1' }))?.props).toMatchObject({ hotkey: '1' })
    expect(await band.find({ type: 'Text', text: /빈 입력창에서 숫자/ })).toBeDefined()
    await band.unmount()
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

// prompt-coach 흉내: 도구 호출로 질문 대기 값을 바꾼다
const PROMPT_COACH = {
  name: 'prompt-coach',
  register(on: any) {
    on('tool.call', { tool: 'SetPending' }, async ($: any, e: any) => {
      await $.state.set({ plugin: 'prompt-coach', key: 'pending' }, e.question)
      return { result: 'ok' }
    })
  },
}

describe('prompt-coach 와 함께', () => {
  test('prompt-coach 가 질문을 띄우면 제안을 지운다. 숫자는 prompt-coach 의 답으로 남는다', { plugins: [PROMPT_COACH] }, async ($, on) => {
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('agent.list', () => ({ value: [] }))
    on('session.messages', () => ({ value: [] }))
    // hold 면 release() 를 부를 때까지 답을 미룬다
    let hold = false
    let release = () => {}
    on('model.complete', () => {
      if (!hold) return { value: { isAnswered: true, text: '테스트를 다시 돌려 줘\nPR 초안을 만들어 줘', usage: USAGE } }
      return new Promise(r => { release = () => r({ value: { isAnswered: true, text: '늦은 제안', usage: USAGE } }) })
    })
    on('turn.complete', () => ({ text: '' }))
    on('prompt.edit', ($, e: any) => ({ text: e.text + e.inputText, cursor: e.text.length + e.inputText.length }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }))
    const pending = (question: string | null) => $.tool.call({ tool: 'SetPending', question } as any)
    const key = (inputText: string) => ($ as any).prompt.edit({ origin: { kind: 'composer' }, key: { name: inputText }, text: '', cursor: 0, start: 0, end: 0, inputText } as any)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    await $.turn.complete({ reason: 'answer', answer: LONG_ANSWER, durationMs: 1, isAborted: false, turnId: 't1' } as any)
    await settle()
    let band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /테스트를 다시 돌려 줘/ })).toBeDefined()
    await band.unmount()

    await pending('prompt-coach: 범위는?')
    band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /테스트를 다시 돌려 줘/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: /OTHER-MOD-BAND/ })).toBeDefined()
    await band.unmount()
    expect((await key('1')).text).toBe('1')

    // 질문이 끝나도(null) 지운 제안은 돌아오지 않는다
    await pending(null)
    expect((await key('1')).text).toBe('1')

    // 제안을 만드는 동안 질문이 뜨면, 늦게 온 제안은 버린다
    hold = true
    await $.turn.complete({ reason: 'answer', answer: LONG_ANSWER, durationMs: 1, isAborted: false, turnId: 't2' } as any)
    await settle()
    await pending('prompt-coach: 완료 기준은?')
    release()
    await settle()
    band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /늦은 제안/ })).toBeUndefined()
    await band.unmount()
  })
})
