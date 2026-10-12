import { describe, expect, mock, test } from 'claude-code/testing'

import { buildRefine, parseRefined } from '../hooks/refine'

const USAGE = { input_tokens: 500, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND = { plugin: 'prompt-coach', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as any
const DRAFT = '로그인 고쳐줘 에러남 auth.ts'
const REFINED = '목표: auth.ts 의 로그인 오류를 고친다.\n맥락: 로그인할 때 에러가 난다.\n완료 기준: 로그인이 성공한다.'

describe('refine (순수 함수)', () => {
  test('초안만 태그에 넣고, 사실은 지키고 언어는 초안을 따르라고 한다', async () => {
    const { system, prompt } = buildRefine(DRAFT)
    expect(prompt).toBe(`<draft>\n${DRAFT}\n</draft>`)
    expect(system).toContain('goal')
    expect(system).toContain('language the draft is written in')
    expect(system).toContain('<refined>')
  })

  test('태그 안만 받는다. 태그가 없거나 비면 null (대화로 답한 것)', async () => {
    expect(parseRefined(`좋아요.\n<refined>\n${REFINED}\n</refined>`)).toBe(REFINED)
    expect(parseRefined('어떤 파일인가요?')).toBeNull()
    expect(parseRefined('<refined>  </refined>')).toBeNull()
  })
})

describe('prompt-coach', () => {
  test('/coach <초안>: 다듬어 입력창에 채우고, undo 로 되돌리고, 사용량을 보인다', async ($, on) => {
    mock.store(on)
    const fills: string[] = []
    let asked: any = null
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('model.complete', ($, e: any) => { asked = e; return { value: { isAnswered: true, text: `<refined>${REFINED}</refined>`, usage: USAGE } } })
    on('prompt.fill', ($, e: any) => { fills.push(e.text); return { isFilled: true } })
    on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)

    const r = await $.command.run({ command: 'coach', args: DRAFT } as any)
    expect(asked.model).toBe('haiku')
    expect(asked.prompt).toContain(DRAFT)
    expect(fills).toEqual([REFINED])
    expect(r.text).toContain('입력창')

    await $.command.run({ command: 'coach', args: 'undo' } as any)
    expect(fills.at(-1)).toBe(DRAFT)

    const status = await $.command.run({ command: 'coach', args: '' } as any)
    expect(status.text).toContain('1회')
    expect(status.text).toContain('500')

    // 너무 짧으면 부르지 않는다
    const short = await $.command.run({ command: 'coach', args: '고쳐' } as any)
    expect(short.text).toContain('짧')
    expect(fills).toHaveLength(2)
  })

  test('[다듬기]: 초안이 있을 때만 버튼, 누르면 지금 초안을 다듬고, 그사이 바뀌었으면 덮지 않는다', async ($, on) => {
    mock.store(on)
    const fills: string[] = []
    const toasts: string[] = []
    let box = ''
    let changeWhileThinking = false
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('model.complete', () => {
      if (changeWhileThinking) box = DRAFT + ' 그리고 테스트도'
      return { value: { isAnswered: true, text: `<refined>${REFINED}</refined>`, usage: USAGE } }
    })
    on('prompt.fill', ($, e: any) => { fills.push(e.text); box = e.text; return { isFilled: true } })
    on('prompt.read', () => ({ value: { text: box, cursor: box.length } }))
    on('prompt.edit', ($, e: any) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
    on('prompt.submit', ($, e: any) => ({ text: e.text }))
    on('ui.toast', ($, e: any) => { toasts.push(e.text); return { value: undefined } })
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    // prompt.edit 은 testing 의 Engine 타입(EventCalls)에 빠져 있다. 실행은 된다
    const type = (text: string) => { box = text; return ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: text }) }

    // 빈 입력창: 버튼 없음
    let band = await $.ui.mount(BAND)
    expect(await band.find({ key: 'coach-refine' })).toBeUndefined()
    await band.unmount()

    await type(DRAFT)
    band = await $.ui.mount(BAND)
    expect(await band.find({ type: 'Text', text: /OTHER-MOD-BAND/ })).toBeDefined() // 다른 mod 의 띠를 가리지 않는다
    expect(await band.find({ key: 'coach-refine' })).toBeDefined()
    await band.press({ key: 'coach-refine' })
    expect(fills).toEqual([REFINED])
    await band.unmount()

    // 모델이 일하는 동안 초안을 고쳤으면 덮지 않고 알린다
    await type(DRAFT)
    changeWhileThinking = true
    band = await $.ui.mount(BAND)
    await band.press({ key: 'coach-refine' })
    await band.unmount()
    expect(fills).toHaveLength(1)
    expect(toasts.join('\n')).toContain('바뀌')

    // 보내면 버튼이 사라진다
    await $.prompt.submit({ text: box, origin: { kind: 'composer' } } as any)
    band = await $.ui.mount(BAND)
    expect(await band.find({ key: 'coach-refine' })).toBeUndefined()
    await band.unmount()
  })

  test('모델이 태그 없이 답하거나 실패하면 입력창을 그대로 두고 이유를 보인다', async ($, on) => {
    mock.store(on)
    const fills: string[] = []
    let reply: any = { isAnswered: true, text: '어떤 오류인가요?', usage: USAGE }
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('model.complete', () => ({ value: reply }))
    on('prompt.fill', ($, e: any) => { fills.push(e.text); return { isFilled: true } })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)

    expect((await $.command.run({ command: 'coach', args: DRAFT } as any)).text).toContain('다듬지 못했')
    reply = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
    expect((await $.command.run({ command: 'coach', args: DRAFT } as any)).text).toContain('api-error')
    expect(fills).toEqual([])
  })
})
