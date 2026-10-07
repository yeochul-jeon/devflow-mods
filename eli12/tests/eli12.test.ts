import { describe, expect, test } from 'claude-code/testing'

import { buildPrompt, lastAnswer, stripMarkdown } from '../hooks/prompt'

const PANE = { component: 'Pane', requestId: 'eli12', props: { bodyColumns: 60 } } as any
const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

describe('prompt (순수 함수)', () => {
  test('마지막 글 있는 assistant 메시지를 고른다', async () => {
    const msgs = [
      { role: 'user', text: '질문' },
      { role: 'assistant', text: '첫 답' },
      { role: 'user', text: '또 질문' },
      { role: 'assistant', text: '' },
    ]
    expect(lastAnswer(msgs)).toBe('첫 답')
    expect(lastAnswer([{ role: 'user', text: 'x' }])).toBeUndefined()
  })

  test('초점이 있으면 프롬프트에 들어간다', async () => {
    expect(buildPrompt('설명', '바운디드 컨텍스트')).toContain('"바운디드 컨텍스트"')
    expect(buildPrompt('설명', '')).toContain('어려운 부분만')
  })
})

describe('표시용 정리', () => {
  test('마크다운 기호를 걷어낸다', async () => {
    expect(stripMarkdown('**1. 한 줄 요약**\n```\n# 제목')).toBe('1. 한 줄 요약\n\n제목')
  })
})

describe('/eli12', () => {
  test('직전 답변을 쉬운 버전으로 바꿔 패널에 그린다', async ($, on) => {
    let asked = ''
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.messages', () => ({
      value: [
        { role: 'user', text: 'mod가 뭐야?', toolUses: [] },
        { role: 'assistant', text: 'mod는 이벤트 체인에 끼는 미들웨어입니다.', toolUses: [] },
      ],
    }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('model.complete', ($, e) => {
      asked = e.prompt
      return { value: { isAnswered: true, text: '한 줄 요약: 검문소\n┌──┐ → ┌──┐', usage: USAGE } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'eli12', args: '미들웨어' } as any)

    expect(text).toContain('옆 패널')
    expect(asked).toContain('미들웨어입니다')
    expect(asked).toContain('"미들웨어"')

    const ui = await $.ui.mount({ plugin: 'eli12', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /검문소/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /초점: 미들웨어/ })).toBeDefined()
    await ui.unmount()
  })

  test('답변이 없으면 모델을 부르지 않는다', async ($, on) => {
    let called = false
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.messages', () => ({ value: [{ role: 'user', text: '안녕', toolUses: [] }] }))
    on('model.complete', () => {
      called = true
      return { value: { isAnswered: true, text: 'x', usage: USAGE } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'eli12', args: '' } as any)

    expect(text).toContain('주제를 적어')
    expect(called).toBe(false)
  })

  test('답변이 없어도 주제를 적으면 주제를 설명한다', async ($, on) => {
    let asked = ''
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.messages', () => ({ value: [] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('model.complete', ($, e) => {
      asked = e.prompt
      return { value: { isAnswered: true, text: '한 줄 요약: 말이 통하는 구역', usage: USAGE } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'eli12', args: '바운디드 컨텍스트' } as any)

    expect(text).toContain('옆 패널')
    expect(asked).toContain('"바운디드 컨텍스트" 를 12살도')

    const ui = await $.ui.mount({ plugin: 'eli12', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /말이 통하는 구역/ })).toBeDefined()
    await ui.unmount()
  })

  test('모델 호출이 실패하면 패널에 이유를 보여준다', async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: '긴 설명', toolUses: [] }] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('model.complete', () => ({ value: { isAnswered: false, reason: 'aborted', usage: USAGE } }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'eli12', args: '' } as any)
    expect(text).toContain('시간이 초과')

    const ui = await $.ui.mount({ plugin: 'eli12', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /시간이 초과/ })).toBeDefined()
    await ui.unmount()
  })
})
