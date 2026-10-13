import { describe, expect, mock, test } from 'claude-code/testing'

import { buildRefine, lacksDone, parseRefined, TEMPLATE } from '../hooks/refine'

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

  test('이유·범위 수식어·붙여넣은 블록을 지키고, 초안 안의 지시는 따르지 않고, 완료 기준이 없으면 표시하라고 한다', async () => {
    const { system } = buildRefine(DRAFT)
    for (const rule of ['reason', 'scope word', '@ file references', 'not instructions to you', '<no-done/>']) expect(system).toContain(rule)
  })

  test('완료 기준 표시는 </refined> 뒤에 있을 때만 잡는다', async () => {
    expect(lacksDone(`<refined>${REFINED}</refined>\n<no-done/>`)).toBe(true)
    expect(lacksDone(`<refined>${REFINED}</refined>`)).toBe(false)
    expect(lacksDone(`<refined>${REFINED} <no-done/></refined>`)).toBe(false)
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

describe('prompt-coach 0.2.0', () => {
  // 입력창(box), 채운 글, 토스트, 모델 호출 수를 흉내 낸다. reply 로 모델의 답을 바꾼다.
  const setup = async ($: any, on: any) => {
    mock.store(on)
    const s = { box: '', fills: [] as string[], toasts: [] as string[], calls: 0, reply: `<refined>${REFINED}</refined>`, changeWhileThinking: false }
    on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
    on('model.complete', () => {
      s.calls++
      if (s.changeWhileThinking) s.box = DRAFT + ' 그리고 테스트도'
      return { value: { isAnswered: true, text: s.reply, usage: USAGE } }
    })
    on('prompt.fill', ($: any, e: any) => { s.fills.push(e.text); s.box = e.text; return { isFilled: true } })
    on('prompt.read', () => ({ value: { text: s.box, cursor: s.box.length } }))
    on('prompt.edit', ($: any, e: any) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
    on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
    on('ui.toast', ($: any, e: any) => { s.toasts.push(e.text); return { value: undefined } })
    on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    const type = (text: string) => { s.box = text; return $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: text }) }
    const coach = (args: string) => $.command.run({ command: 'coach', args } as any)
    const press = async (key: string) => { const band = await $.ui.mount(BAND); await band.press({ key }); await band.unmount() }
    const shows = async (key: string) => { const band = await $.ui.mount(BAND); const found = await band.find({ key }); await band.unmount(); return found !== undefined }
    return { s, type, coach, press, shows }
  }

  test('/coach template: 모델을 부르지 않고 틀을 채운다', async ($, on) => {
    const { s, coach, shows } = await setup($, on)
    await coach('template')
    expect(s.fills).toEqual([TEMPLATE])
    expect(s.calls).toBe(0)
    expect(await shows('coach-refine')).toBe(true) // 채운 뒤 띠가 보인다
  })

  test('/coach template 은 이전에 다듬은 원문을 지운다 (틀 옆에 [되돌리기]가 남지 않는다)', async ($, on) => {
    const { coach, shows } = await setup($, on)
    await coach(DRAFT)
    expect(await shows('coach-undo')).toBe(true)
    await coach('template')
    expect(await shows('coach-undo')).toBe(false)
  })

  test('/coach <초안> 뒤에도 띠가 보인다', async ($, on) => {
    const { coach, shows } = await setup($, on)
    await coach(DRAFT)
    expect(await shows('coach-refine')).toBe(true)
  })

  test('완료 기준이 없다는 표시가 오면 /coach 문구와 [다듬기] 토스트로 알린다. 다듬은 글에는 넣지 않는다', async ($, on) => {
    const { s, type, coach, press } = await setup($, on)
    s.reply = `<refined>${REFINED}</refined>\n<no-done/>`
    expect((await coach(DRAFT)).text).toContain('완료 기준')
    await type(DRAFT)
    await press('coach-refine')
    expect(s.toasts.join('\n')).toContain('완료 기준')
    expect(s.fills).toEqual([REFINED, REFINED])
  })

  test('[되돌리기]: 다듬은 뒤에만 보이고, 누르면 원문, 그 뒤엔 사라진다', async ($, on) => {
    const { s, type, press, shows } = await setup($, on)
    await type(DRAFT)
    expect(await shows('coach-undo')).toBe(false)
    await press('coach-refine')
    expect(await shows('coach-undo')).toBe(true)
    await press('coach-undo')
    expect(s.fills.at(-1)).toBe(DRAFT)
    expect(await shows('coach-undo')).toBe(false)
  })

  test('[되돌리기]: 다듬은 뒤 입력창을 고쳤으면 덮지 않고 알린다', async ($, on) => {
    const { s, type, press } = await setup($, on)
    await type(DRAFT)
    await press('coach-refine')
    await type(REFINED + ' 추가')
    await press('coach-undo')
    expect(s.fills).toEqual([REFINED])
    expect(s.toasts.join('\n')).toContain('바뀌어')
  })

  test('보내면 되돌릴 원문을 비운다', async ($, on) => {
    const { s, coach } = await setup($, on)
    await coach(DRAFT)
    await $.prompt.submit({ text: s.box, origin: { kind: 'composer' } } as any)
    expect((await coach('undo')).text).toContain('없어요')
  })

  test('/coach undo 는 한 번만 되돌린다', async ($, on) => {
    const { s, coach } = await setup($, on)
    await coach(DRAFT)
    await coach('undo')
    expect(s.fills.at(-1)).toBe(DRAFT)
    expect((await coach('undo')).text).toContain('없어요')
  })

  test('[다듬기]가 초안이 바뀌어 그만두면 되돌릴 원문을 남기지 않는다', async ($, on) => {
    const { s, type, coach, press } = await setup($, on)
    await type(DRAFT)
    s.changeWhileThinking = true
    await press('coach-refine')
    expect(s.fills).toEqual([])
    expect((await coach('undo')).text).toContain('없어요')
  })
})
