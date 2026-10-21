import { describe, expect, mock, test } from 'claude-code/testing'

import { addedHead, buildQuestions, buildRewrite, parseQuestions, parseRefined, parseRewrite, passThrough, rule, TEMPLATE } from '../hooks/refine'

const USAGE = { input_tokens: 500, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const BAND = { plugin: 'prompt-coach', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as any
const DRAFT = '로그인 고쳐줘 에러남 auth.ts'
const REFINED = '목표: auth.ts 의 로그인 오류를 고친다.\n맥락: 로그인할 때 에러가 난다.\n완료 기준: 로그인이 성공한다.'
const QUESTIONS = [
  { q: '어떤 에러인가요?', options: ['401 응답', '빌드 에러'] },
  { q: '범위는?', options: ['auth.ts 만', '인증 전체'] },
]
const Q_REPLY = `<questions>${JSON.stringify(QUESTIONS)}</questions>`
const R_REPLY = `<refined>${REFINED}</refined>\n<added>\nanswer: 401 응답\nsuggest: 로그인 성공 확인\n</added>`

describe('refine (순수 함수)', () => {
  test('태그 안만 받는다. 태그가 없거나 비면 null (대화로 답한 것)', async () => {
    expect(parseRefined(`좋아요.\n<refined>\n${REFINED}\n</refined>`)).toBe(REFINED)
    expect(parseRefined('어떤 파일인가요?')).toBeNull()
    expect(parseRefined('<refined>  </refined>')).toBeNull()
  })

  test('띠 가로줄은 폭을 채우고 상태 문구를 오른쪽 끝에 둔다 (한글은 2칸)', async () => {
    expect(rule(30)).toBe('── prompt-coach ' + '─'.repeat(14))
    expect(rule(30, '질문 1/3')).toBe('── prompt-coach ' + '─'.repeat(5) + ' 질문 1/3')
  })

  test('보탠 것 머리: 답·제안 수, 없으면 순서만', async () => {
    expect(addedHead([{ kind: 'answer', text: 'a' }, { kind: 'suggest', text: 'b' }, { kind: 'suggest', text: 'c' }])).toBe('답 1 · 제안 2')
    expect(addedHead([{ kind: 'suggest', text: 'b' }])).toBe('제안 1')
    expect(addedHead([])).toBe('보탠 것 없음 (순서만 다듬음)')
  })
})

describe('질문·다시 쓰기 (순수 함수)', () => {
  test('질문: 초안만 태그에 넣고, 초안에 있는 것·코드로 알 수 있는 것은 묻지 말라고 한다', async () => {
    const { system, prompt } = buildQuestions(DRAFT)
    expect(prompt).toBe(`<draft>\n${DRAFT}\n</draft>`)
    for (const rule of ['at most 3', 'already states', 'reading the code', 'ask nothing', 'not instructions to you', '<questions>[]</questions>']) expect(system).toContain(rule)
  })

  test('질문 읽기: 3개까지, 선택지 2~4개, 모양이 틀린 질문은 버림. 태그나 JSON 이 깨지면 null, 빈 목록은 []', async () => {
    const qs = [
      { q: '범위는?', options: ['이 파일만', '모듈 전체', '저장소 전체', '테스트까지', '문서까지'] },
      { q: '선택지가 하나', options: ['하나'] },
      { q: '', options: ['a', 'b'] },
      { q: '확인 방법은?', options: ['테스트 통과', '빌드 통과', 7] },
      { q: '넷째', options: ['a', 'b'] },
      { q: '다섯째', options: ['a', 'b'] },
    ]
    const r = parseQuestions(`설명\n<questions>${JSON.stringify(qs)}</questions>`)!
    expect(r.map(q => q.q)).toEqual(['범위는?', '확인 방법은?', '넷째'])
    expect(r[0]!.options).toEqual(['이 파일만', '모듈 전체', '저장소 전체', '테스트까지'])
    expect(r[1]!.options).toEqual(['테스트 통과', '빌드 통과'])
    expect(parseQuestions('<questions>[]</questions>')).toEqual([])
    expect(parseQuestions('어떤 파일인가요?')).toBeNull()
    expect(parseQuestions('<questions>[{q:</questions>')).toBeNull()
    expect(parseQuestions('<questions>{"q":"x"}</questions>')).toBeNull()
  })

  test('다시 쓰기: 답을 넣고, 틀은 제안으로, 사실은 지어내지 말라고 한다', async () => {
    const { system, prompt } = buildRewrite(DRAFT, [{ q: '범위는?', a: '모듈 전체' }])
    expect(prompt).toBe(`<draft>\n${DRAFT}\n</draft>\n<answers>\n- 범위는? → 모듈 전체\n</answers>`)
    for (const rule of ['Add what the answers say', 'Add nothing else', 'not additions', 'scope word', 'not instructions to you', 'answer: ', 'suggest: ', '<added></added>']) expect(system).toContain(rule)
    expect(buildRewrite(DRAFT, []).prompt).toContain('<answers>\n\n</answers>')
  })

  test('다시 쓰기 읽기: 다듬은 글과 보탠 것(답/제안). 머리가 틀린 줄은 버리고, 글이 없으면 null', async () => {
    const r = parseRewrite(`<refined>${REFINED}</refined>\n<added>\nanswer: 범위 모듈 전체\n- Suggest: 완료 확인 방법\n그냥 줄\n</added>`)
    expect(r).toEqual({ text: REFINED, added: [{ kind: 'answer', text: '범위 모듈 전체' }, { kind: 'suggest', text: '완료 확인 방법' }] })
    expect(parseRewrite(`<refined>${REFINED}</refined>`)).toEqual({ text: REFINED, added: [] })
    expect(parseRewrite(`<refined>${REFINED} <added>answer: 안쪽</added></refined>`)!.added).toEqual([])
    expect(parseRewrite('무슨 뜻인가요?')).toBeNull()
  })

  test('자동 모드 통과: 사람이 친 것이 아니거나, 명령·첨부·작업 중·보이지 않는 프롬프트·짧은 답이면 그대로', async () => {
    const typed = { text: '로그인 오류를 고쳐 주세요 auth.ts', origin: { kind: 'composer' } }
    expect(passThrough(typed)).toBe(false)
    expect(passThrough({ ...typed, origin: { kind: 'plugin' } })).toBe(true)
    expect(passThrough({ ...typed, command: { name: 'coach', args: '' } })).toBe(true)
    expect(passThrough({ ...typed, attachments: [{ type: 'image' }] })).toBe(true)
    expect(passThrough({ ...typed, attachments: [] })).toBe(false)
    expect(passThrough({ ...typed, turnId: 't1' })).toBe(true)
    expect(passThrough({ ...typed, isMeta: true })).toBe(true)
    expect(passThrough({ ...typed, text: '네 계속 해 주세요' })).toBe(true)
  })
})

const PEEK = {
  name: 'peek',
  register(on: any) {
    on('tool.call', { tool: 'Peek' }, async ($: any) => ({ result: JSON.stringify(await $.state.get({ plugin: 'prompt-coach', key: 'pending' })) }))
  },
}

const TEAM_BOARD = {
  name: 'team-board',
  register(on: any) {
    on('tool.call', { tool: 'SetMe' }, async ($: any, e: any) => {
      await $.state.set({ plugin: 'team-board', key: 'me' }, e.me)
      return { result: 'ok' }
    })
  },
}

describe('prompt-coach 흐름', () => {
  // 입력창(box), 채운 글, 토스트, 모델 호출을 흉내 낸다. qReply·rReply 로 모델의 답을 바꾼다.
  const setup = async ($: any, on: any) => {
    mock.store(on)
    const clock = mock.clock(on, { now: 1_800_000_000_000 })
    const s = { box: '', fills: [] as string[], toasts: [] as string[], asked: [] as any[], qReply: Q_REPLY as any, rReply: R_REPLY as any, hold: false }
    on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
    on('model.complete', ($: any, e: any) => {
      s.asked.push(e)
      if (s.hold) return new Promise(() => {})
      const reply = e.system.includes('<questions>') ? s.qReply : s.rReply
      return { value: typeof reply === 'string' ? { isAnswered: true, text: reply, usage: USAGE } : reply }
    })
    on('prompt.fill', ($: any, e: any) => { s.fills.push(e.text); s.box = e.text; return { isFilled: true } })
    on('prompt.read', () => ({ value: { text: s.box, cursor: s.box.length } }))
    on('prompt.edit', ($: any, e: any) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
    on('prompt.submit', ($: any, e: any) => ({ text: e.text }))
    on('ui.toast', ($: any, e: any) => { s.toasts.push(e.text); return { value: undefined } })
    on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }))
    on('command.run', () => ({ text: 'core' })) // /help 같은 다른 명령
    on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    // 모델 호출은 띠가 뒤에서 기다린다. 몇 번 양보해 끝나게 한다
    const settle = async () => { for (let i = 0; i < 30; i++) await new Promise(r => (globalThis as any).setTimeout(r, 0)) }
    const type = (text: string) => { s.box = text; return $.prompt.edit({ origin: { kind: 'composer' }, text: '', cursor: 0, start: 0, end: 0, inputText: text }) }
    // 사람이 입력창에서 Enter 로 보낸 명령. 보내면 입력창은 빈다.
    const run = (command: string, args = '', origin: any = { kind: 'composer' }) => { if (origin.kind === 'composer') s.box = ''; return $.command.run({ command, args, origin } as any) }
    const coach = async (args: string) => { const r = await run('coach', args); await settle(); return r }
    const mount = (cols = 120) => $.ui.mount({ ...BAND, props: { ...BAND.props, bodyColumns: cols } })
    const press = async (key: string) => { const band = await mount(); await band.press({ key }); await band.unmount(); await settle() }
    const shows = async (key: string) => { const band = await mount(); const found = await band.find({ key }); await band.unmount(); return found !== undefined }
    const text = async (re: RegExp, cols = 120) => { const band = await mount(cols); const found = await band.find({ type: 'Text', text: re }); await band.unmount(); return found !== undefined }
    return { s, clock, settle, type, run, coach, press, shows, text, mount }
  }

  test('/coach <초안>: 질문 → 하나 답하고 하나 건너뛰면, 답한 것만 넘겨 다듬고 보탠 것 줄을 보인다', async ($, on) => {
    const { s, coach, press, shows, text } = await setup($, on)
    const r = await coach(DRAFT)
    expect(r.text).toContain('질문')
    expect(s.asked[0].model).toBe('haiku')
    expect(s.asked[0].prompt).toContain(DRAFT)
    expect(await text(/질문 1\/2$/)).toBe(true)
    expect(await text(/^어떤 에러인가요\?$/)).toBe(true)
    expect(await text(new RegExp(`^초안  ${DRAFT}$`))).toBe(true) // 입력창이 비어 있어 무엇을 다듬는지 띠에 보인다
    await press('coach-opt-0')
    expect(await text(/질문 2\/2$/)).toBe(true)
    await press('coach-skip')
    expect(s.asked[1].prompt).toContain('- 어떤 에러인가요? → 401 응답')
    expect(s.asked[1].prompt).not.toContain('범위는?')
    expect(s.box).toBe(REFINED)
    expect(await text(/입력창에 넣음$/)).toBe(true)
    expect(await text(/^답 1 · 제안 1$/)).toBe(true)
    expect(await shows('coach-undo')).toBe(true)
    const status = await coach('')
    expect(status.text).toContain('2회')
    expect(status.text).toContain('1,000')
  })
  test('[다듬기]: 입력창의 초안을 가져가 입력창을 비우고, [바로 다듬기]는 남은 질문을 건너뛴다. 다른 mod 의 띠는 그대로', async ($, on) => {
    const { s, type, press, shows, text } = await setup($, on)
    expect(await shows('coach-refine')).toBe(false) // 빈 입력창: 버튼 없음
    await type(DRAFT)
    expect(await text(/OTHER-MOD-BAND/)).toBe(true)
    expect(await text(/^── prompt-coach ─{104}$/)).toBe(true) // 띠 폭(bodyColumns 120)을 채운다
    await press('coach-refine')
    expect(s.box).toBe('') // 숫자 키로 답하도록 비운다
    expect(await text(/OTHER-MOD-BAND/)).toBe(true)
    await press('coach-now')
    expect(s.asked[1].prompt).toContain('<answers>\n\n</answers>')
    expect(s.box).toBe(REFINED)
  })

  test('숫자 키: 선택지 1~, 건너뛰기 0, 바로 다듬기 9. 좁은 띠에서는 초안 줄과 직접 쓰기 안내를 뺀다', async ($, on) => {
    const { coach, mount } = await setup($, on)
    await coach(DRAFT)
    const band = await mount()
    expect(await band.find({ type: 'Text', text: /^입력창 Enter = 이 질문의 답 · > 로 시작하면 새 요청$/ })).toBeDefined()
    expect((await band.find({ key: 'coach-opt-0' }))?.props).toMatchObject({ hotkey: '1', plain: true })
    expect((await band.find({ key: 'coach-opt-1' }))?.props).toMatchObject({ hotkey: '2' })
    expect((await band.find({ key: 'coach-skip' }))?.props).toMatchObject({ hotkey: '0' })
    expect((await band.find({ key: 'coach-now' }))?.props).toMatchObject({ hotkey: '9' })
    await band.unmount()
    const narrow = await mount(40)
    expect(await narrow.find({ type: 'Text', text: /^초안/ })).toBeUndefined()
    expect(await narrow.find({ type: 'Text', text: /이 질문의 답/ })).toBeUndefined()
    await narrow.unmount()
  })

  test('물을 게 없으면 바로 다듬는다', async ($, on) => {
    const { s, coach } = await setup($, on)
    s.qReply = '<questions>[]</questions>'
    await coach(DRAFT)
    expect(s.asked).toHaveLength(2)
    expect(s.box).toBe(REFINED)
  })

  test('질문 중 입력창에 쓰고 Enter: 보내지 않고 지금 질문의 답으로 받은 뒤 입력창을 비운다', async ($, on) => {
    const { s, clock, settle, coach } = await setup($, on)
    await coach(DRAFT)
    s.box = '세션 만료 에러'
    const r = await $.prompt.submit({ text: '세션 만료 에러', origin: { kind: 'composer' } } as any)
    expect(r).toMatchObject({ drop: 'prompt-coach: 질문의 답으로 받았어요' })
    await settle()
    expect(s.asked).toHaveLength(1) // 답은 엔진이 막힌 글을 되돌린 뒤에 넘긴다
    await clock.advance(300)
    await settle()
    expect(s.box).toBe('')
    // 마지막 질문: 엔진이 되돌린 글을 지운 뒤 다듬은 글을 넣는다 (다듬은 글이 지워지지 않는다)
    s.box = '인증 전체 다'
    await $.prompt.submit({ text: '인증 전체 다', origin: { kind: 'composer' } } as any)
    await clock.advance(300)
    await settle()
    expect(s.asked[1].prompt).toContain('- 어떤 에러인가요? → 세션 만료 에러\n- 범위는? → 인증 전체 다')
    expect(s.box).toBe(REFINED)
    // 질문이 끝난 뒤의 Enter 는 그대로 보낸다
    expect(await $.prompt.submit({ text: s.box, origin: { kind: 'composer' } } as any)).toMatchObject({ text: REFINED })
  })

  test('취소: 초안을 입력창에 돌려놓고 [다듬기] 띠로 돌아간다', async ($, on) => {
    const { s, type, press, shows } = await setup($, on)
    await type(DRAFT)
    await press('coach-refine')
    await press('coach-cancel')
    expect(s.box).toBe(DRAFT)
    expect(await shows('coach-refine')).toBe(true)
    expect(s.asked).toHaveLength(1)
  })

  test('/coach cancel 도 그만둔다. 다듬는 중이 아니면 그렇다고 한다', async ($, on) => {
    const { s, coach } = await setup($, on)
    expect((await coach('cancel')).text).toContain('아니에요')
    await coach(DRAFT)
    expect((await coach('cancel')).text).toContain('돌려놓')
    expect(s.box).toBe(DRAFT)
  })

  test('모델이 질문 대신 말로 답하거나 실패하면 초안을 입력창에 돌려놓고 이유를 알린다', async ($, on) => {
    const { s, coach, press } = await setup($, on)
    s.qReply = '어떤 오류인가요?'
    await coach(DRAFT)
    expect(s.box).toBe(DRAFT)
    expect(s.toasts.at(-1)).toContain('질문을 만들지 못했어요')
    s.qReply = Q_REPLY
    s.rReply = { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: USAGE }
    s.box = ''
    await coach(DRAFT)
    await press('coach-now')
    expect(s.box).toBe(DRAFT)
    expect(s.toasts.at(-1)).toContain('api-error')
    expect(s.toasts.at(-1)).toContain('초안은 입력창에 그대로')
  })

  test('질문하는 동안 입력창에 새 글을 썼으면 다듬은 글로 덮지 않는다. 원문은 /coach undo 로', async ($, on) => {
    const { s, type, coach, press } = await setup($, on)
    await coach(DRAFT)
    await type('다른 급한 질문')
    await press('coach-now')
    expect(s.box).toBe('다른 급한 질문')
    expect(s.toasts.at(-1)).toContain('덮지 않았어요')
    await type('')
    await coach('undo')
    expect(s.box).toBe(DRAFT)
  })

  test('짧은 초안은 부르지 않는다', async ($, on) => {
    const { s, coach } = await setup($, on)
    expect((await coach('고쳐')).text).toContain('짧')
    expect(s.asked).toHaveLength(0)
  })

  test('모듈을 다시 불러 모델 호출이 끊겼으면 초안을 돌려준다', async ($, on) => {
    const { s, coach, settle } = await setup($, on)
    s.hold = true
    await coach(DRAFT)
    expect(s.box).toBe('')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/r' } as any)
    await settle()
    expect(s.box).toBe(DRAFT)
    expect(s.toasts.at(-1)).toContain('다시 불러와')
  })

  test('사람이 보낸 다른 명령 뒤에는 띠가 숨는다 (명령은 prompt.submit 을 거치지 않는다). 플러그인이 실행한 명령은 그대로', async ($, on) => {
    const { type, run, shows } = await setup($, on)
    await type(DRAFT)
    await run('help', '', { kind: 'plugin', name: 'other' })
    expect(await shows('coach-refine')).toBe(true)
    await run('help')
    expect(await shows('coach-refine')).toBe(false)
  })

  test('/coach template: 모델을 부르지 않고 틀을 채우고, 이전에 다듬은 원문을 지운다', async ($, on) => {
    const { s, coach, shows } = await setup($, on)
    await coach(DRAFT)
    await coach('cancel')
    s.box = ''
    await coach('template')
    expect(s.box).toBe(TEMPLATE)
    expect(s.asked).toHaveLength(1)
    expect(await shows('coach-refine')).toBe(true)
    expect(await shows('coach-undo')).toBe(false)
  })

  test('[되돌리기]: 다듬은 뒤에만 보이고, 누르면 원문. 그 뒤 입력창을 고쳤으면 덮지 않는다', async ($, on) => {
    const { s, type, coach, press, shows } = await setup($, on)
    await type(DRAFT)
    expect(await shows('coach-undo')).toBe(false)
    await press('coach-refine')
    await press('coach-now')
    await press('coach-undo')
    expect(s.box).toBe(DRAFT)
    expect(await shows('coach-undo')).toBe(false)
    s.box = ''
    await coach(DRAFT)
    await press('coach-now')
    await type(REFINED + ' 추가')
    await press('coach-undo')
    expect(s.box).toBe(REFINED + ' 추가')
    expect(s.toasts.at(-1)).toContain('바뀌어')
  })

  test('보내면 되돌릴 원문과 보탠 것 줄을 비운다. /coach undo 는 한 번만', async ($, on) => {
    const { s, coach, press, text } = await setup($, on)
    await coach(DRAFT)
    await press('coach-now')
    await coach('undo')
    expect(s.box).toBe(DRAFT)
    expect((await coach('undo')).text).toContain('없어요')
    s.box = ''
    await coach(DRAFT)
    await press('coach-now')
    await $.prompt.submit({ text: s.box, origin: { kind: 'composer' } } as any)
    expect(await text(/입력창에 넣음$/)).toBe(false)
    expect((await coach('undo')).text).toContain('없어요')
  })

  const LONG = '결제 모듈의 중복 코드를 정리해 주세요'
  const submit = ($: any, text: string, extra: any = {}) => $.prompt.submit({ text, origin: { kind: 'composer' }, ...extra } as any)

  test('자동 모드는 기본 꺼짐: 보내기에 끼어들지 않는다', async ($, on) => {
    const { s, coach } = await setup($, on)
    expect((await coach('auto')).text).toContain('꺼짐')
    expect(await submit($, LONG)).toMatchObject({ text: LONG })
    expect(s.asked).toHaveLength(0)
  })

  test('자동 모드: 사람이 친 프롬프트를 막고 질문 → 다듬은 글을 입력창에. 그 글은(고쳐도) 다시 묻지 않고 보낸다', async ($, on) => {
    const { s, clock, settle, coach, press, text } = await setup($, on)
    expect((await coach('auto on')).text).toContain('켜짐')
    expect(await text(/ 자동$/)).toBe(false) // 초안이 없으면 띠가 없다
    s.box = LONG
    const r = await submit($, LONG)
    expect(r).toMatchObject({ drop: expect.stringContaining('맨 앞에 >') })
    await settle()
    await clock.advance(300)
    await settle()
    expect(s.box).toBe('')
    expect(await text(/질문 1\/2$/)).toBe(true)
    await press('coach-now')
    expect(s.box).toBe(REFINED)
    expect(await submit($, REFINED + ' 그리고 요약도')).toMatchObject({ text: REFINED + ' 그리고 요약도' })
    expect(s.asked).toHaveLength(2)
    // 다음 새 프롬프트는 다시 묻는다
    expect(await submit($, LONG)).toMatchObject({ drop: expect.any(String) })
    await settle()
    expect(s.asked).toHaveLength(3)
  })

  test('자동 모드에서 그대로 보내는 것: 명령·작업 중·첨부·짧은 답·플러그인 프롬프트, > 로 시작하면 벗겨서', async ($, on) => {
    const { s, coach } = await setup($, on)
    await coach('auto on')
    expect(await submit($, LONG, { command: { name: 'review', args: '' } })).toMatchObject({ text: LONG })
    expect(await submit($, LONG, { turnId: 't1' })).toMatchObject({ text: LONG })
    expect(await submit($, LONG, { attachments: [{ type: 'image' }] })).toMatchObject({ text: LONG })
    expect(await submit($, '네 계속 해 주세요')).toMatchObject({ text: '네 계속 해 주세요' })
    expect(await $.prompt.submit({ text: LONG, origin: { kind: 'plugin', name: 'other' } } as any)).toMatchObject({ text: LONG })
    expect(await submit($, '> ' + LONG)).toMatchObject({ text: LONG })
    expect(s.asked).toHaveLength(0)
  })

  test('자동 모드에서 취소하면 돌려놓은 초안의 Enter 는 그대로 보낸다', async ($, on) => {
    const { s, settle, coach, press } = await setup($, on)
    await coach('auto on')
    await submit($, LONG)
    await settle()
    await press('coach-cancel')
    expect(s.box).toBe(LONG)
    expect(await submit($, LONG)).toMatchObject({ text: LONG })
    expect(s.asked).toHaveLength(1)
  })

  test('/coach auto off 로 끈다. 켜면 띠 머리에 자동', async ($, on) => {
    const { coach, type, text } = await setup($, on)
    await coach('auto on')
    await type(LONG)
    expect(await text(/ 자동$/)).toBe(true)
    expect((await coach('auto off')).text).toContain('꺼짐')
    expect(await submit($, LONG)).toMatchObject({ text: LONG })
  })

  test('답을 기다리는 질문을 pending 에 둔다(team-board 가 읽음). 입력창을 채우면 null 이 된다', { plugins: [PEEK] }, async ($, on) => {
    const { coach, press } = await setup($, on)
    const peek = async () => JSON.parse((await $.tool.call({ tool: 'Peek' } as any) as any).result).value
    await coach(DRAFT)
    expect(await peek()).toBe('prompt-coach: 어떤 에러인가요?')
    await press('coach-opt-0')
    expect(await peek()).toBe('prompt-coach: 범위는?')
    await press('coach-skip')
    expect(await peek()).toBeNull()
  })

  test('질문 중 > 로 시작한 글은 새 요청: 다듬기를 그만두고 > 를 벗겨 보낸 뒤 초안을 입력창에 돌려놓는다', async ($, on) => {
    const { s, coach, text } = await setup($, on)
    await coach(DRAFT)
    s.box = ''
    expect(await submit($, '> 급한 거 먼저: 배포 로그 봐 줘')).toMatchObject({ text: '급한 거 먼저: 배포 로그 봐 줘' })
    expect(s.box).toBe(DRAFT)
    expect(await text(/질문 1\/2$/)).toBe(false)
  })

  test('자동 모드: team-board 가 Claude 의 질문 대기로 보는 동안의 답은 가로채지 않는다. 다음 턴이 시작되면 다시 묻는다', { plugins: [TEAM_BOARD] }, async ($, on) => {
    const { s, settle, coach } = await setup($, on)
    const me = (state: string, question = '') => $.tool.call({ tool: 'SetMe', me: { state, question } } as any)
    await coach('auto on')
    await me('asking', '범위는 어느 쪽으로 할까요?')
    await me('working') // 사람이 보내는 순간 team-board 가 먼저 작업 중으로 바꾼다
    expect(await submit($, '변경 파일만 하고 테스트도 같이 돌려 줘')).toMatchObject({ text: '변경 파일만 하고 테스트도 같이 돌려 줘' })
    // 다음 턴이 시작되면 끈다. prompt-coach 자신의 질문(결정 필요로 보임)은 Claude 의 질문이 아니다
    await $.turn.start({ text: '', turnId: 't1' } as any)
    await me('asking', 'prompt-coach: 범위는?')
    expect(await submit($, LONG)).toMatchObject({ drop: expect.any(String) })
    await settle()
    expect(s.asked).toHaveLength(1)
  })

  const pane = (cols = 100) => $pane.mount({ plugin: 'prompt-coach', surface: 'terminal', component: 'Pane', requestId: 'prompt-coach', props: { bodyColumns: cols } } as any)
  let $pane: any
  const has = async (p: any, re: RegExp) => (await p.find({ type: 'Text', text: re })) !== undefined

  test('/coach view: 기록이 없으면 안내와 설정만', async ($, on) => {
    $pane = $.ui
    const { coach } = await setup($, on)
    expect((await coach('view')).text).toContain('패널')
    const p = await pane()
    expect(await has(p, /^PROMPT COACH$/)).toBe(true)
    expect(await has(p, /아직 다듬은 기록이 없어요/)).toBe(true)
    expect(await has(p, /^자동 모드 꺼짐$/)).toBe(true)
    await p.press({ key: 'view-auto' })
    expect(await has(p, /^자동 모드 켜짐$/)).toBe(true)
    await p.unmount()
  })

  test('/coach view: 다듬은 뒤 수치·보탠 것(답/제안)·원문과 다듬은 글. 넓으면 나란히, 좁으면 위아래', async ($, on) => {
    $pane = $.ui
    const { coach, press } = await setup($, on)
    await coach(DRAFT)
    await press('coach-opt-0')
    await press('coach-skip')
    await coach('view')
    const p = await pane()
    expect(await has(p, /^● 검토$/)).toBe(true)
    expect(await has(p, /^원문 4단어$/)).toBe(true)
    expect(await has(p, /^보탠 것 2$/)).toBe(true)
    expect(await has(p, /^ {2}답$/)).toBe(true)
    expect(await has(p, /^ {2}제안$/)).toBe(true)
    expect(await has(p, /^✦ 다듬은 글$/)).toBe(true)
    expect((await p.find({ key: 'cards' }))?.props.flexDirection).toBe('row')
    await p.unmount()
    const narrow = await pane(40)
    expect((await narrow.find({ key: 'cards' }))?.props.flexDirection).toBe('column')
    await narrow.unmount()
  })

  test('/coach view: 질문 중이면 질문 전체. 패널에서 답하고, 바꾸기로 되돌리고, 나머지 건너뛰고 다듬기', async ($, on) => {
    $pane = $.ui
    const { s, coach, settle } = await setup($, on)
    await coach(DRAFT)
    await coach('view')
    const p = await pane()
    expect(await has(p, /^● 질문$/)).toBe(true)
    expect(await has(p, /^범위는\?$/)).toBe(true) // 다음 질문도 흐리게 보인다
    await p.press({ key: 'view-opt-1' })
    await settle()
    expect(await has(p, /^빌드 에러$/)).toBe(true)
    await p.press({ key: 'change-0' })
    await settle()
    expect((await p.find({ key: 'view-opt-0' }))).toBeDefined()
    await p.press({ key: 'view-now' })
    await settle()
    expect(s.box).toBe(REFINED)
    await p.unmount()
  })

  test('/coach view: 기록은 최신이 앞, 골라 보고, 비어 있는 입력창에 넣는다. 글이 있으면 덮지 않는다', async ($, on) => {
    $pane = $.ui
    const { s, coach, press, settle } = await setup($, on)
    await coach(DRAFT)
    await press('coach-now')
    s.box = ''
    await coach('결제 모듈 중복 코드 정리 부탁해요')
    await press('coach-now')
    await coach('view')
    const p = await pane()
    expect(await has(p, /^기록 2 $/)).toBe(true)
    expect(await has(p, /^원문 6단어$/)).toBe(true)
    await p.press({ key: 'hist-1' })
    await settle()
    expect(await has(p, /^원문 4단어$/)).toBe(true)
    s.box = '쓰던 글'
    await p.press({ key: 'view-fill' })
    await settle()
    expect(s.box).toBe('쓰던 글')
    expect(s.toasts.at(-1)).toContain('넣지 않았어요')
    s.box = ''
    await p.press({ key: 'view-fill' })
    await settle()
    expect(s.box).toBe(REFINED)
    await p.unmount()
  })
})
