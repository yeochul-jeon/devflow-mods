import { describe, expect, test } from 'claude-code/testing'

import { cells, flowArt } from '../hooks/diagram'
import { buildPrompt, buildTopicPrompt, lastAnswer, parseEli12, stripMarkdown } from '../hooks/prompt'

const PANE = { component: 'Pane', requestId: 'eli12', props: { bodyColumns: 60 } } as any
const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const REPLY = JSON.stringify({
  summary: '검문소',
  analogy: '**택배**가 지나가는 검문소예요.',
  flows: [{ label: '요청 흐름', steps: ['요청', '검문소', '도착'] }],
  remember: ['하나', '둘', '셋'],
})

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

  test('그림은 글자로 그리지 않고 단계로 받는다', async () => {
    for (const p of [buildPrompt('설명', ''), buildTopicPrompt('주제')]) {
      expect(p).toContain('"flows"')
      expect(p).toContain('상자나 화살표를 글자로 그리지 않는다')
    }
  })

  test('JSON 을 꺼내고 상한·빈 값·마크다운을 정리한다', async () => {
    const raw = '앞글 ' + JSON.stringify({
      summary: ' **요약** ',
      flows: [
        { label: 'a', steps: ['1', '2', '3', '4', '5', '6', '7'] },
        { label: 'empty', steps: [' '] },
        { label: 'b', steps: ['x', 'y'] },
        { label: 'c', steps: ['p', 'q'] },
      ],
      remember: ['1', '', '2', '3', '4'],
      real: '실제',
    }) + ' 뒷글'
    const d = parseEli12(raw)!
    expect(d.summary).toBe('요약')
    expect(d.flows.map(f => f.label)).toEqual(['a', 'b'])
    expect(d.flows[0]!.steps.length).toBe(6)
    expect(d.remember).toEqual(['1', '2', '3'])
    expect(d.analogy).toBe('')
    expect(d.real).toBe('실제')
    expect(parseEli12('그림 없음')).toBeNull()
    expect(parseEli12('{"flows": []}')).toBeNull()
  })

  test('한글 단계도 상자 세 줄의 폭이 같다', async () => {
    const lines = flowArt(['결제 요청', '실패', '다시 시도'], 56)
    expect(lines.length).toBe(3)
    expect(new Set(lines.map(cells)).size).toBe(1)
    // 한글 한 글자 = 2칸: '결제 요청' 은 9칸이라 윗줄 가로선이 11개
    expect(lines[0]!.startsWith('┌' + '─'.repeat(11) + '┐')).toBe(true)
  })
})

describe('표시용 정리', () => {
  test('마크다운 기호를 걷어낸다', async () => {
    expect(stripMarkdown('**1. 한 줄 요약**\n```\n# 제목')).toBe('1. 한 줄 요약\n\n제목')
  })

  test('Python 식별자의 밑줄 두 개는 그대로 둔다', async () => {
    expect(stripMarkdown('if __name__ == "__main__":')).toBe('if __name__ == "__main__":')
    expect(stripMarkdown('`__init__` 를 고쳤습니다')).toBe('__init__ 를 고쳤습니다')
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
    let cap = 0
    on('model.complete', ($, e) => {
      asked = e.prompt
      cap = e.maxTokens ?? 0
      return { value: { isAnswered: true, text: REPLY, usage: USAGE } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'eli12', args: '미들웨어' } as any)

    expect(text).toContain('옆 패널')
    expect(asked).toContain('미들웨어입니다')
    expect(asked).toContain('"미들웨어"')
    // 생각 토큰만 2천을 넘은 실측이 있다
    expect(cap).toBeGreaterThanOrEqual(8000)

    const ui = await $.ui.mount({ plugin: 'eli12', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /^검문소$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^택배가 지나가는/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /│ 검문소 │ → │ 도착 │/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^셋$/ })).toBeDefined()
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
      const text = JSON.stringify({ summary: '말이 통하는 구역', analogy: '반', flows: [], mismatch: '경계는 코드에 있다', real: '도메인 모델의 경계' })
      return { value: { isAnswered: true, text, usage: USAGE } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'eli12', args: '바운디드 컨텍스트' } as any)

    expect(text).toContain('옆 패널')
    expect(asked).toContain('"바운디드 컨텍스트" 를 12살도')

    const ui = await $.ui.mount({ plugin: 'eli12', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /말이 통하는 구역/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /비유가 안 맞는 곳/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /도메인 모델의 경계/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /그림/ })).toBeUndefined()
    await ui.unmount()
  })

  test('답이 JSON 이 아니면 패널에 이유를 보여준다', async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: '긴 설명', toolUses: [] }] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('model.complete', () => ({ value: { isAnswered: true, text: '┌──┐ 상자 그림', usage: USAGE } }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'eli12', args: '' } as any)
    expect(text).toContain('형식(JSON)')

    const ui = await $.ui.mount({ plugin: 'eli12', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /형식\(JSON\)/ })).toBeDefined()
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

  test('모델 호출 자체가 거부되면(reject) 로딩에 머물지 않고 이유를 보여준다', async ($, on) => {
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: '긴 설명', toolUses: [] }] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    // 던진 훅은 건너뛰고 그 아래 답할 구현이 없으므로 $.model.complete 가 reject 된다
    on('model.complete', () => {
      throw new Error('blocked model')
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'eli12', args: '' } as any)
    expect(text).toContain('모델 호출 실패')

    const ui = await $.ui.mount({ plugin: 'eli12', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /모델 호출 실패/ })).toBeDefined()
    await ui.unmount()
  })
})
