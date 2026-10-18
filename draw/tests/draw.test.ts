import { describe, expect, test } from 'claude-code/testing'

import { cells, flowArt } from '../hooks/diagram'
import { buildPrompt, parseDraw } from '../hooks/prompt'

const PANE = { component: 'Pane', requestId: 'draw', props: { bodyColumns: 60 } } as any
const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ANSWER = 'prompt.submit 이 규칙을 붙이고, session.compact 뒤에 pending 을 켭니다.'

function boot(on: any, reply: string) {
  const asked: string[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: '어떻게 동작해?', toolUses: [] },
      { role: 'assistant', text: ANSWER, toolUses: [] },
    ],
  }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', ($: any, e: any) => {
    asked.push(e.prompt)
    return { value: { isAnswered: true, text: reply, usage: USAGE } }
  })
  return asked
}

describe('prompt (순수 함수)', () => {
  test('원문과 초점이 프롬프트에 들어간다', async () => {
    const p = buildPrompt(ANSWER, 'compact')
    expect(p).toContain(ANSWER)
    expect(p).toContain('"compact"')
  })

  test('JSON 을 꺼내고 개수 상한과 빈 값을 정리한다', async () => {
    const raw = '앞글 ' + JSON.stringify({
      title: ' 규칙 주입 ',
      flows: [
        { label: 'a', steps: ['1', '2', '3', '4', '5', '6', '7'] },
        { label: 'empty', steps: [' '] },
      ],
      notes: ['n'],
    }) + ' 뒷글'
    const d = parseDraw(raw)!
    expect(d.title).toBe('규칙 주입')
    expect(d.flows.length).toBe(1)
    expect(d.flows[0]!.steps.length).toBe(6)
    expect(d.notes).toEqual(['n'])
    expect(parseDraw('그림 없음')).toBeNull()
    expect(parseDraw('{"flows": 1}')).toBeNull()
  })
})

describe('그림', () => {
  test('한 줄에 들어가면 상자 세 줄의 폭이 같다', async () => {
    const lines = flowArt(['prompt.submit', '규칙 붙임', 'pending'], 80)
    expect(lines.length).toBe(3)
    expect(new Set(lines.map(cells)).size).toBe(1)
  })

  test('6단계까지 그리고 좁으면 줄을 바꿔 폭을 넘지 않는다', async () => {
    const lines = flowArt(['하나', '둘', '셋', '넷', '다섯', '여섯', '일곱'], 30)
    const text = lines.join('\n')
    expect(text).toContain('여섯')
    expect(text).not.toContain('일곱')
    for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(30)
  })

  test('긴 식별자는 상자 대신 세로로 그려 이름을 자르지 않는다', async () => {
    const id = 'ArsCustomerService.saveCustomerDeliveryAddress'
    const lines = flowArt(['/Store.action', id], 60)
    expect(lines).toEqual(['┌─ /Store.action', `└→ ${id}`])
  })

  test('세로 그림에서 폭을 넘는 이름은 다음 줄로 이어 쓴다', async () => {
    const lines = flowArt(['배포 전 캡처 (--env qa --when before)', '끝'], 20)
    expect(lines).toEqual(['┌─ 배포 전 캡처', '│  (--env qa --when', '│  before)', '└→ 끝'])
    for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(20)
  })
})

describe('/draw', () => {
  test('직전 답변을 Haiku 에 보내고 흐름을 패널에 그린다', async ($, on) => {
    const reply = JSON.stringify({ title: '규칙 주입', flows: [{ label: '첫 프롬프트', steps: ['prompt.submit', '규칙 붙임'] }], notes: ['compact 뒤 다시'] })
    const asked = boot(on, reply)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'draw', args: '' } as any)

    expect(text).toContain('옆 패널')
    expect(asked.length).toBe(1)
    expect(asked[0]).toContain(ANSWER)

    const ui = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /^규칙 주입$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /│ prompt\.submit │ → │ 규칙 붙임 │/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /compact 뒤 다시/ })).toBeDefined()
    await ui.unmount()
  })

  test('JSON 이 아니면 이유를 패널과 답에 보인다', async ($, on) => {
    boot(on, '그림을 못 그렸어요')

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'draw', args: '' } as any)

    expect(text).toContain('JSON')
    const ui = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /JSON/ })).toBeDefined()
    await ui.unmount()
  })

  test('답변이 없으면 모델을 부르지 않는다', async ($, on) => {
    let called = false
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.messages', () => ({ value: [{ role: 'user', text: '안녕', toolUses: [] }] }))
    on('model.complete', () => {
      called = true
      return { value: { isAnswered: true, text: '{}', usage: USAGE } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'draw', args: '' } as any)

    expect(text).toContain('그릴 답변이 없어요')
    expect(called).toBe(false)
  })
})
