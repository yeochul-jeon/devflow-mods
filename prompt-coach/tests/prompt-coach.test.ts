import { describe, expect, mock, test } from 'claude-code/testing'

import { addedHead, buildQuestions, buildRewrite, parseQuestions, parseRefined, parseRewrite, passThrough, rule, shareCells, TEMPLATE, textRows, wrappedRows } from '../hooks/refine'

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
    expect(rule(30)).toBe('━━ prompt-coach ' + '━'.repeat(14))
    expect(rule(30, '질문 1/3')).toBe('━━ prompt-coach ' + '━'.repeat(5) + ' 질문 1/3')
  })

  test('보탠 것 머리: 답·제안 수, 없으면 순서만', async () => {
    expect(addedHead([{ kind: 'answer', text: 'a' }, { kind: 'suggest', text: 'b' }, { kind: 'suggest', text: 'c' }])).toBe('답 1 · 제안 2')
    expect(addedHead([{ kind: 'suggest', text: 'b' }])).toBe('제안 1')
    expect(addedHead([])).toBe('보탠 것 없음 (순서만 다듬음)')
  })
})

describe('줄 계산 (순수 함수)', () => {
  test('wrappedRows: 칸 사이 간격을 넣어 폭에서 접히는 줄 수를 센다', async () => {
    expect(wrappedRows([10, 10], 22, 2)).toBe(1)
    expect(wrappedRows([10, 10], 21, 2)).toBe(2)
    expect(wrappedRows([10, 10, 10], 22, 2)).toBe(2)
    expect(wrappedRows([5, 5, 5], 5, 2)).toBe(3)
  })

  test('textRows: 낱말 단위로 접히는 줄 수. 폭보다 긴 낱말은 폭에서 끊긴다', async () => {
    expect(textRows('aaaa bbbb', 9)).toBe(1)
    expect(textRows('aaaa bbbb', 8)).toBe(2)
    expect(textRows('aaaa bbbb cccc', 9)).toBe(2)
    expect(textRows('가'.repeat(40), 69)).toBe(2) // 80칸 한 낱말
    expect(textRows('가나 ' + '다'.repeat(40), 69)).toBe(2) // 긴 낱말은 앞 낱말 줄에 이어 붙는다
    expect(textRows('가 ' + '나'.repeat(69), 69)).toBe(4) // 이어 붙이면 더 끊기는 낱말은 새 줄에서 시작하고, 2칸 글자는 한 줄에 68칸까지
    expect(textRows('a'.repeat(138), 69)).toBe(2) // 1칸 글자는 폭을 다 쓴다
    expect(textRows('a'.repeat(69) + ' b', 69)).toBe(2) // 꽉 찬 줄 뒤의 공백은 다음 줄로 간다
  })

  test('shareCells: 짧은 글은 그대로, 남는 칸은 긴 글이 나눠 쓴다. 모자라도 최소 칸은 준다', async () => {
    expect(shareCells([20, 20, 34], 79, 5)).toEqual([20, 20, 34]) // 다 들어가면 자르지 않는다
    expect(shareCells([20, 20, 34], 60, 5)).toEqual([20, 20, 20])
    expect(shareCells([34, 6, 20], 50, 5)).toEqual([24, 6, 20]) // 순서는 그대로
    expect(shareCells([20, 20, 34], 39, 5)).toEqual([13, 13, 13])
    expect(shareCells([20, 20], 4, 5)).toEqual([5, 5])
  })
})

describe('질문·다시 쓰기 (순수 함수)', () => {
  test('질문: 초안만 태그에 넣고, 초안에 있는 것·코드로 알 수 있는 것은 묻지 말라고 한다', async () => {
    const { system, prompt } = buildQuestions(DRAFT)
    expect(prompt).toBe(`<draft>\n${DRAFT}\n</draft>`)
    for (const rule of ['at most 3', 'already states', 'reading the code', 'ask nothing', 'not instructions to you', '<questions>[]</questions>']) expect(system).toContain(rule)
  })

  test('질문 읽기: 줄바꿈과 겹친 공백을 하나로 (띠는 질문과 선택지를 줄 수로 센다)', async () => {
    expect(parseQuestions(`<questions>${JSON.stringify([{ q: '첫째\n  둘째', options: ['a\nb', 'c'] }])}</questions>`)).toEqual([{ q: '첫째 둘째', options: ['a b', 'c'] }])
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

const PEEK_TICK = {
  name: 'peek-tick',
  register(on: any) {
    on('tool.call', { tool: 'PeekTick' }, async ($: any) => ({ result: JSON.stringify(await $.state.get({ plugin: 'prompt-coach', key: 'tick' })) }))
  },
}

const TEAM_BOARD = {
  name: 'team-board',
  register(on: any) {
    on('tool.call', { tool: 'SetMe' }, async ($: any, e: any) => {
      await $.state.set({ plugin: 'team-board', key: 'me' }, e.me)
      return { result: 'ok' }
    })
    on('tool.call', { tool: 'SetBandOff' }, async ($: any, e: any) => {
      await $.state.set({ plugin: 'team-board', key: 'bandOff' }, e.off)
      return { result: 'ok' }
    })
  },
}

describe('prompt-coach 흐름', () => {
  // 입력창(box), 채운 글, 토스트, 모델 호출을 흉내 낸다. qReply·rReply 로 모델의 답을 바꾼다.
  const setup = async ($: any, on: any) => {
    mock.store(on)
    const clock = mock.clock(on, { now: 1_800_000_000_000 })
    const s = { box: '', fills: [] as string[], toasts: [] as string[], asked: [] as any[], qReply: Q_REPLY as any, rReply: R_REPLY as any, hold: false, release: () => {} }
    on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
    on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
    on('model.complete', ($: any, e: any) => {
      s.asked.push(e)
      const reply = e.system.includes('<questions>') ? s.qReply : s.rReply
      const value = typeof reply === 'string' ? { isAnswered: true, text: reply, usage: USAGE } : reply
      // 붙잡은 답은 s.release() 로 보낸다
      if (s.hold) return new Promise(r => { s.release = () => r({ value }) })
      return { value }
    })
    on('prompt.fill', ($: any, e: any) => { s.fills.push(e.text); s.box = e.text; return { isFilled: true } })
    on('prompt.read', () => ({ value: { text: s.box, cursor: s.box.length } }))
    on('prompt.edit', ($: any, e: any) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
    on('prompt.change', ($: any, e: any) => ({ text: e.text }))
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
    // prompt-coach 가 그린 Box 의 자식. 첫째는 늘 next 의 답이다. 2.1.322 까지는 이 Box 가 맨 바깥이고 첫째가 다른 mod 띠(OTHER-MOD-BAND),
    // 2.1.323 부터는 엔진이 mod 마다 따로 그려 part 로 묶어 쌓아 그 안에 있고 첫째는 엔진 것({"type":"engine"})이다. 아무것도 안 그리면 []
    const own = async (maxRows: number, props: any = {}, viewport?: any) => {
      const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows, ...props }, viewport } as any)
      const root = (await band.find({ type: 'Box' })) as any
      await band.unmount()
      const box = root?.children.find((c: any) => c.part?.plugin === 'prompt-coach') ?? (root?.children[0]?.part?.plugin === 'test' ? root : undefined)
      return (box?.type === 'Box' ? box.children : []) as any[]
    }
    // 쉬는 동안 그린 것: 쉬는 줄, 그 위 가로줄, 쓴 줄 수(쉬는 줄과 가로줄은 1줄씩이라 자식 수 + 빈 줄)
    const idleAt = async (maxRows: number, viewport?: any) => {
      const k = (await own(maxRows, {}, viewport)).slice(1)
      const rows = k.reduce((n, c) => n + 1 + (c.props?.marginTop ?? 0) + (c.props?.marginBottom ?? 0), 0)
      return { line: k.some(c => JSON.stringify(c).includes('coach-refine')), rule: k.some(c => JSON.stringify(c).includes('━━ prompt-coach')), rows }
    }
    // 질문 단계 모양: line(질문까지 한 줄) · cut(선택지를 한 줄로 자름) · clipped(머리줄 없이 질문을 한 줄로 자름) · tight(질문과 선택지만)
    // · full(빈 줄·머리줄·초안·안내까지) · full+1·full+2(질문 위, 안내 위에 빈 줄을 더 둔다) · none
    const askAt = async (maxRows: number, props: any = {}) => {
      const k = (await own(maxRows, props)).slice(1)
      const has = (re: RegExp) => k.find(c => re.test(JSON.stringify(c)))
      if (k.length === 0) return 'none'
      if (has(/coach-line/)) return 'line'
      if (has(/"label":"건너뜀"/)) return 'cut'
      const ask = has(/"children":\[" \d+ "\]/)
      if (!has(/━━ prompt-coach/)) return /…"\]/.test(JSON.stringify(ask)) ? 'clipped' : 'tight'
      const gaps = (ask.props.marginTop ?? 0) + (has(/이 질문의 답/)?.props.marginTop ?? 0)
      return gaps === 0 ? 'full' : `full+${gaps}`
    }
    return { s, clock, settle, type, run, coach, press, shows, text, mount, own, idleAt, askAt }
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
    const { s, type, press, shows, text, own } = await setup($, on)
    expect(await shows('coach-refine')).toBe(false) // 빈 입력창: 버튼 없음
    await type(DRAFT)
    expect(await text(/OTHER-MOD-BAND/)).toBe(true)
    // next 의 답이 먼저(위), 이 mod 는 그 아래. 쉬는 동안은 머리줄 없이 한 줄
    // next 의 답은 2.1.322 까지 다른 mod 띠, 2.1.323 부터는 엔진 것이다(다른 mod 띠는 엔진이 따로 쌓는다)
    const kids = (maxRows = 10) => own(maxRows)
    const idle = await kids()
    expect(idle.length).toBe(2)
    expect(JSON.stringify(idle[0])).toMatch(/OTHER-MOD-BAND|"type":"engine"/)
    expect(idle[1].props.height).toBe(1)
    expect(await text(/^━━ prompt-coach/)).toBe(false)
    expect(await text(/─{120}/)).toBe(false) // 끝줄 없음
    // 단계 안: 다른 mod 띠 → 머리줄(위 띠와 띄우는 빈 줄, 줄이 모자라면 뺀다) → 내용. 끝줄 없음
    const order = async (maxRows: number) => {
      const k = await kids(maxRows)
      return { restFirst: /OTHER-MOD-BAND|"type":"engine"/.test(JSON.stringify(k[0])), gap: k[1].props.marginTop, foot: JSON.stringify(k).includes('─'.repeat(120)) }
    }
    await press('coach-refine')
    expect(s.box).toBe('') // 숫자 키로 답하도록 비운다
    expect(await text(/^━━ prompt-coach ━+ 질문 1\/2$/)).toBe(true) // 띠 폭(bodyColumns 120)을 채운다
    expect(await order(10)).toEqual({ restFirst: true, gap: 1, foot: false }) // 질문 단계
    expect(await order(6)).toEqual({ restFirst: true, gap: 1, foot: false })
    await press('coach-now')
    expect(s.asked[1].prompt).toContain('<answers>\n\n</answers>')
    expect(s.box).toBe(REFINED)
    expect(await order(10)).toEqual({ restFirst: true, gap: 1, foot: false }) // 입력창에 넣음 단계
    // 위 띠와 띄우는 빈 줄은 띠 자리가 3줄부터 (질문 단계는 6줄보다 적으면 머리줄째 빠진다)
    expect(await order(2)).toEqual({ restFirst: true, gap: 0, foot: false })
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
    // 띠 자리가 6줄보다 적으면 머리줄·초안·안내를 빼고 질문과 선택지만 (창 24줄: 자리 4줄 중 team-board 한 줄)
    const low = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 5 } })
    expect(await low.find({ type: 'Text', text: /^━━ prompt-coach/ })).toBeUndefined()
    expect(await low.find({ type: 'Text', text: /^초안/ })).toBeUndefined()
    expect(await low.find({ type: 'Text', text: /이 질문의 답/ })).toBeUndefined()
    expect(await low.find({ key: 'coach-opt-0' })).toBeDefined()
    await low.unmount()
    const full = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 6 } })
    expect(await full.find({ type: 'Text', text: /^초안/ })).toBeDefined()
    await full.unmount()
  })

  test('선택지가 남은 줄에 접혀 넘치면 한 줄로 자르고, 띠 자리가 1줄이면 질문까지 한 줄, 0줄이면 그리지 않는다', async ($, on) => {
    const { s, coach } = await setup($, on)
    const long = ['로그인 페이지의 모든 오류', '비밀번호 관련 오류만', '계정·인증 관련 오류만']
    s.qReply = `<questions>${JSON.stringify([{ q: '어떤 오류 메시지를 고치면 될까요?', options: long }])}</questions>`
    await coach(DRAFT)
    const band = (maxRows: number, bodyColumns: number) => $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows, bodyColumns } })
    const label = async (b: any, key: string) => (await b.find({ key }))?.props.label

    // 넓으면 2줄 자리에서도 그대로
    const wide = await band(2, 155)
    expect(await label(wide, 'coach-opt-0')).toBe(long[0])
    expect(await label(wide, 'coach-skip')).toBe('건너뛰기')
    await wide.unmount()

    // 80칸 창: 접히면 넘치므로 한 줄에 맞춘다. 숫자 키는 그대로
    const narrow = await band(2, 75)
    expect(await narrow.find({ type: 'Text', text: /^어떤 오류 메시지를 고치면 될까요\?$/ })).toBeDefined()
    const labels = [await label(narrow, 'coach-opt-0'), await label(narrow, 'coach-opt-1'), await label(narrow, 'coach-opt-2')]
    expect(labels.every(l => l.endsWith('…'))).toBe(true)
    expect((await narrow.find({ key: 'coach-opt-0' }))?.props).toMatchObject({ hotkey: '1' })
    expect((await narrow.find({ key: 'coach-skip' }))?.props).toMatchObject({ hotkey: '0', label: '건너뜀' })
    expect((await narrow.find({ key: 'coach-now' }))?.props).toMatchObject({ hotkey: '9', label: '바로' })
    await narrow.unmount()

    // 접혀도 줄이 넉넉하면 자르지 않는다
    const roomy = await band(4, 75)
    expect(await label(roomy, 'coach-opt-0')).toBe(long[0])
    await roomy.unmount()

    // 1줄: 질문과 선택지를 같은 줄에
    const one = await band(1, 155)
    const row = await one.find({ key: 'coach-line' })
    const json = JSON.stringify(row)
    expect(json).toContain('어떤 오류')
    expect(json).toContain('coach-opt-2')
    await one.unmount()

    const zero = await band(0, 155)
    expect(await zero.find({ key: 'coach-opt-0' })).toBeUndefined()
    expect(await zero.find({ type: 'Text', text: /OTHER-MOD-BAND/ })).toBeDefined()
    await zero.unmount()
  })

  test('질문을 만드는 중·넣음 단계도 띠 자리가 0줄이면 그리지 않는다', async ($, on) => {
    const { s, coach, press, settle } = await setup($, on)
    const zero = async () => { const b = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 0 } }); const found = await b.find({ type: 'Text', text: /^━━ prompt-coach|^초안|^보탠 것/ }); await b.unmount(); return found }
    s.hold = true
    await coach(DRAFT)
    expect(await zero()).toBeUndefined()
    s.release()
    await settle()
    s.hold = false
    await press('coach-now')
    expect(s.box).toBe(REFINED)
    expect(await zero()).toBeUndefined()
  })

  test('쉬는 줄: 초안이 있으면 띠 자리가 1줄이어도 한 줄만 그리고, 0줄이거나 초안이 없으면 그리지 않는다', async ($, on) => {
    const { type, idleAt } = await setup($, on)
    expect(await idleAt(5)).toEqual({ line: false, rule: false, rows: 0 })
    await type(DRAFT)
    expect(await idleAt(5)).toEqual({ line: true, rule: false, rows: 1 }) // 다른 띠가 없으면 가로줄도 없다
    expect(await idleAt(1)).toEqual({ line: true, rule: false, rows: 1 })
    expect(await idleAt(0)).toEqual({ line: false, rule: false, rows: 0 })
  })

  const NEXT_STEPS = {
    name: 'next-steps',
    register(on: any) {
      on('tool.call', { tool: 'SetSteps' }, async ($: any, e: any) => {
        await $.state.set({ plugin: 'next-steps', key: 'steps' }, e.steps)
        return { result: 'ok' }
      })
    },
  }

  test('제안이 있으면 next-steps 한 줄이 먼저 남는다: 2줄부터 [다듬기]를 그리고 1줄이면 뺀다. 제안이 없으면 1줄이어도 그린다', { plugins: [NEXT_STEPS] }, async ($, on) => {
    const { type, idleAt } = await setup($, on)
    await type(DRAFT)
    await $.tool.call({ tool: 'SetSteps', steps: { turnId: 't', items: ['a', 'b'] } } as any)
    expect((await idleAt(2)).line).toBe(true)
    expect((await idleAt(1)).line).toBe(false)
    await $.tool.call({ tool: 'SetSteps', steps: { turnId: 't', items: [] } } as any)
    expect((await idleAt(1)).line).toBe(true)
  })

  test('질문 단계: 팀 창이 있으면 띠 자리 3줄부터 팀 한 줄을 남긴 줄로 모양을 고른다. /board band off 면 다 쓴다', { plugins: [TEAM_BOARD] }, async ($, on) => {
    const { s, coach, askAt } = await setup($, on)
    s.qReply = `<questions>${JSON.stringify([{ q: '가'.repeat(40), options: ['a', 'b'] }])}</questions>`
    await coach(DRAFT)
    const at = (maxRows: number) => askAt(maxRows, { bodyColumns: 75 })
    expect(await at(7)).toBe('full') // 팀 창이 없으면 7줄(빈 줄·머리줄·초안·안내 4 + 질문 2 + 선택지 1)을 다 쓴다
    await $.tool.call({ tool: 'SetMe', me: { state: 'idle', question: '' } } as any)
    expect(await at(9)).toBe('full+1') // 팀 한 줄을 빼고 8줄: 남는 1줄로 질문 위를 띄운다
    expect(await at(8)).toBe('full')
    expect(await at(7)).toBe('tight') // 다 그리면 팀 줄이 사라지는 높이: 질문 2 + 선택지 1
    expect(await at(4)).toBe('tight')
    expect(await at(3)).toBe('clipped') // 질문을 자른 한 줄 + 선택지 1
    expect(await at(2)).toBe('clipped') // 3줄보다 적으면 team-board 가 양보해 2줄을 다 쓴다. 팀 한 줄을 빼면 질문까지 한 줄(line)이 된다
    await $.tool.call({ tool: 'SetBandOff', off: true } as any)
    expect(await at(7)).toBe('full') // /board band off: 그릴 팀 줄이 없어 7줄을 다 쓴다
    expect(await at(3)).toBe('tight')
  })

  const IMAGE_PREVIEW = {
    name: 'image-preview',
    register(on: any) {
      on('tool.call', { tool: 'SetImages' }, async ($: any, e: any) => {
        await $.state.set({ plugin: 'image-preview', key: 'draft' }, e.draft)
        return { result: 'ok' }
      })
    },
  }

  test('쉬는 줄: image-preview 칩 줄(전체 화면에서 이미지가 있을 때)이 먼저 남아 2줄부터 그리고, 3줄부터 그 사이에 가로줄 1줄을 둔다. 쉬는 줄 아래 빈 줄은 없다', { plugins: [IMAGE_PREVIEW] }, async ($, on) => {
    const { type, idleAt } = await setup($, on)
    await type(DRAFT)
    await $.tool.call({ tool: 'SetImages', draft: [1] } as any)
    expect(await idleAt(3)).toEqual({ line: true, rule: true, rows: 2 }) // 칩 줄 + 가로줄 + 쉬는 줄. 가로줄 위아래에 빈 줄이 없다
    expect(await idleAt(2)).toEqual({ line: true, rule: false, rows: 1 })
    expect(await idleAt(1)).toEqual({ line: false, rule: false, rows: 0 }) // 칩 줄이 남는다
    // 전체 화면이 아니면 image-preview 가 칩 줄을 그리지 않아 세지 않는다
    const windowed = { columns: 120, rows: 40, isFullscreen: false }
    expect(await idleAt(1, windowed)).toEqual({ line: true, rule: false, rows: 1 })
    expect(await idleAt(3, windowed)).toEqual({ line: true, rule: false, rows: 1 }) // 다른 띠가 없으니 가로줄도 없다
    await $.tool.call({ tool: 'SetImages', draft: [] } as any)
    expect(await idleAt(1)).toEqual({ line: true, rule: false, rows: 1 })
    expect(await idleAt(3)).toEqual({ line: true, rule: false, rows: 1 })
  })

  test('쉬는 줄: 맨 앞에 색 표시(▎)를 두고 [다듬기]를 배경색 칩으로 그린다. 줄이 1줄뿐이어도 같다', async ($, on) => {
    const { type, own } = await setup($, on)
    await type(DRAFT)
    for (const maxRows of [1, 10]) {
      const line = (await own(maxRows))[1]
      expect(line.children[0]).toEqual({ type: 'Text', props: { color: 'claude' }, children: ['▎'] })
      expect(line.children[1].props).toEqual({ key: 'coach-refine', label: '다듬기', plain: true })
      expect(line.children[1].children).toEqual([{ type: 'Text', props: { backgroundColor: 'claude', color: 'inverseText', bold: true }, children: [' 다듬기 '] }])
    }
  })

  test('쉬는 줄 위 가로줄: next-steps 가 같은 입력으로 고르는 줄(펼친 목록 = 제안 수 + 2, 접으면 2·1)과 칩 줄·팀 한 줄을 세고 1줄이 남을 때만 둔다. 쉬는 줄 아래 빈 줄은 없다', { plugins: [NEXT_STEPS, IMAGE_PREVIEW, TEAM_BOARD] }, async ($, on) => {
    const { type, idleAt } = await setup($, on)
    await type(DRAFT)
    await $.tool.call({ tool: 'SetSteps', steps: { turnId: 't', items: ['a', 'b'] } } as any)
    // 제안 2개: 6줄이면 펼친 목록 4 + 가로줄 + 쉬는 줄, 5줄이면 펼친 목록과 쉬는 줄만
    expect(await idleAt(6)).toEqual({ line: true, rule: true, rows: 2 })
    expect(await idleAt(5)).toEqual({ line: true, rule: false, rows: 1 })
    // 4줄이면 목록이 가로줄 있는 한 줄(2줄)로 접혀 가로줄 자리가 남는다. 가로줄 때문에 목록이 접히지는 않는다
    expect(await idleAt(4)).toEqual({ line: true, rule: true, rows: 2 })
    expect(await idleAt(3)).toEqual({ line: true, rule: false, rows: 1 })
    // 칩 줄이 있으면 그 1줄을 더 센다. 쉬는 줄은 next-steps 한 줄과 칩 줄을 남기고 3줄부터
    await $.tool.call({ tool: 'SetImages', draft: [1] } as any)
    expect(await idleAt(7)).toEqual({ line: true, rule: true, rows: 2 })
    expect(await idleAt(6)).toEqual({ line: true, rule: false, rows: 1 })
    expect(await idleAt(5)).toEqual({ line: true, rule: true, rows: 2 })
    expect(await idleAt(4)).toEqual({ line: true, rule: false, rows: 1 })
    expect(await idleAt(3)).toEqual({ line: true, rule: false, rows: 1 })
    expect(await idleAt(2)).toEqual({ line: false, rule: false, rows: 0 })
    // 팀 창이 있으면 next-steps 도 팀 한 줄을 남기고 목록을 고른다: 5줄이면 가로줄 있는 한 줄(2)로 접혀 가로줄 자리가 남는다
    await $.tool.call({ tool: 'SetImages', draft: [] } as any)
    await $.tool.call({ tool: 'SetMe', me: { state: 'idle', question: '' } } as any)
    expect(await idleAt(7)).toEqual({ line: true, rule: true, rows: 2 })
    expect(await idleAt(6)).toEqual({ line: true, rule: false, rows: 1 })
    expect(await idleAt(5)).toEqual({ line: true, rule: true, rows: 2 })
    expect(await idleAt(4)).toEqual({ line: true, rule: false, rows: 1 })
  })

  test('팀 창도 다른 띠로 센다: 쉬는 줄 위 가로줄은 팀 한 줄까지 남을 때만. 다듬는 중에는 칩 줄과 팀 한 줄(띠 자리 3줄부터)을 뺀 줄로 모양을 고르고, 1줄뿐이면 칩 줄보다 먼저 남는다', { plugins: [IMAGE_PREVIEW, TEAM_BOARD] }, async ($, on) => {
    const { s, type, coach, settle, press, own, idleAt, askAt } = await setup($, on)
    await type(DRAFT)
    await $.tool.call({ tool: 'SetMe', me: { state: 'idle', question: '' } } as any)
    // 팀 창만: 가로줄 + 쉬는 줄 + 팀 한 줄
    expect(await idleAt(3)).toEqual({ line: true, rule: true, rows: 2 })
    expect(await idleAt(2)).toEqual({ line: true, rule: false, rows: 1 })
    expect(await idleAt(1)).toEqual({ line: true, rule: false, rows: 1 }) // 팀 창은 쉬는 줄보다 뒤 순위라 줄이 모자라도 쉬는 줄을 빼지 않는다
    // 칩 줄도 있으면 4줄부터
    await $.tool.call({ tool: 'SetImages', draft: [1] } as any)
    expect(await idleAt(4)).toEqual({ line: true, rule: true, rows: 2 })
    expect(await idleAt(3)).toEqual({ line: true, rule: false, rows: 1 })
    await $.tool.call({ tool: 'SetBandOff', off: true } as any)
    expect(await idleAt(3)).toEqual({ line: true, rule: true, rows: 2 }) // /board band off: 팀 줄을 세지 않는다
    await $.tool.call({ tool: 'SetBandOff', off: false } as any)

    // 질문 만드는 중 (칩 + 팀): 쓸 줄 = 띠 자리 - 2. 3줄부터 빈 줄 + 머리줄, 2줄이면 머리줄만, 1줄이면 진행 줄만
    s.hold = true
    await coach(DRAFT)
    const busy = async (maxRows: number) => {
      const k = (await own(maxRows)).slice(1)
      return { head: k.find(c => JSON.stringify(c).includes('━━ prompt-coach'))?.props.marginTop ?? null, busy: k.some(c => JSON.stringify(c).includes('coach-busy-line')) }
    }
    expect(await busy(5)).toEqual({ head: 1, busy: true })
    expect(await busy(4)).toEqual({ head: 0, busy: true })
    expect(await busy(3)).toEqual({ head: null, busy: true })
    expect(await busy(2)).toEqual({ head: null, busy: true }) // 3줄보다 적으면 팀 창이 양보해 칩 줄만 뺀다
    expect(await busy(1)).toEqual({ head: null, busy: true }) // 1줄뿐이면 칩 줄보다 이 화면이 남는다
    s.release()
    await settle()
    s.hold = false

    // 질문 단계 (질문 1줄 + 선택지 1줄: 다 그리면 6줄)
    expect(await askAt(8)).toBe('full')
    expect(await askAt(7)).toBe('tight')
    expect(await askAt(4)).toBe('tight')
    expect(await askAt(3)).toBe('line') // 팀 한 줄까지 빼 1줄
    expect(await askAt(2)).toBe('line')
    expect(await askAt(1)).toBe('line') // 1줄뿐이면 칩 줄보다 이 화면이 남는다
    // 칩 줄만
    await $.tool.call({ tool: 'SetMe', me: null } as any)
    expect(await askAt(7)).toBe('full')
    expect(await askAt(6)).toBe('tight')
    expect(await askAt(1)).toBe('line')
    const one = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 1 } })
    expect(await one.find({ type: 'Text', text: /OTHER-MOD-BAND/ })).toBeDefined() // 다른 mod 의 띠는 그대로
    await one.unmount()

    // 입력창에 넣음 (칩 + 팀)
    await press('coach-now')
    expect(s.box).toBe(REFINED)
    await $.tool.call({ tool: 'SetMe', me: { state: 'idle', question: '' } } as any)
    const done = async (maxRows: number) => {
      const k = (await own(maxRows)).slice(1)
      const has = (re: RegExp) => k.find(c => re.test(JSON.stringify(c)))
      return { head: has(/━━ prompt-coach/)?.props.marginTop ?? null, hint: has(/고치거나 그대로 보내세요/) !== undefined, undo: has(/coach-undo/) !== undefined }
    }
    expect(await done(6)).toEqual({ head: 1, hint: true, undo: true })
    expect(await done(5)).toEqual({ head: 0, hint: true, undo: true })
    expect(await done(4)).toEqual({ head: 0, hint: false, undo: true })
    expect(await done(3)).toEqual({ head: null, hint: false, undo: true })
    expect(await done(1)).toEqual({ head: null, hint: false, undo: true })
  })

  test('입력창이 prompt.change 로 비면(Ctrl+C, Esc 두 번) [다듬기]를 그리지 않는다', async ($, on) => {
    const { s, type, shows } = await setup($, on)
    await type(DRAFT)
    expect(await shows('coach-refine')).toBe(true)
    s.box = ''
    await ($ as any).prompt.change({ text: '', cursor: 0, origin: { kind: 'clear' } })
    expect(await shows('coach-refine')).toBe(false)
    await type(DRAFT)
    expect(await shows('coach-refine')).toBe(true)
  })

  test('긴 질문: 접히는 줄까지 세어 넘치면 머리줄을 빼고, 그래도 넘치면 질문을 한 줄로 자른다', async ($, on) => {
    const { s, coach } = await setup($, on)
    const q = '가'.repeat(40)
    s.qReply = `<questions>${JSON.stringify([{ q, options: ['a', 'b'] }])}</questions>`
    await coach(DRAFT)
    const look = async (maxRows: number) => {
      const b = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows, bodyColumns: 75 } })
      const r = { head: (await b.find({ type: 'Text', text: /^━━ prompt-coach/ })) !== undefined, whole: (await b.find({ type: 'Text', text: new RegExp(`^${q}$`) })) !== undefined, cut: (await b.find({ type: 'Text', text: /^가+…$/ })) !== undefined }
      await b.unmount()
      return r
    }
    expect(await look(7)).toEqual({ head: true, whole: true, cut: false }) // 질문 2줄 + 나머지 5줄
    expect(await look(6)).toEqual({ head: false, whole: true, cut: false })
    expect(await look(3)).toEqual({ head: false, whole: true, cut: false }) // 질문 2줄 + 선택지 1줄
    expect(await look(2)).toEqual({ head: false, whole: false, cut: true })
  })

  test('좁은 창의 한 줄 모양: 선택지마다 글자를 남긴다 (숫자만 보이고 뜻이 안 보이면 고를 수 없다)', async ($, on) => {
    const { s, coach } = await setup($, on)
    const four = ['로그인 오류 전체', '인증 실패 메시지만', '입력값 검증 메시지만', '서버 오류 메시지만']
    s.qReply = `<questions>${JSON.stringify([{ q: '어떤 오류 메시지를 고치면 될까요?', options: four }])}</questions>`
    await coach(DRAFT)
    const one = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 1, bodyColumns: 75 } })
    for (let k = 0; k < 4; k++) expect((await one.find({ key: `coach-opt-${k}` }))?.props.label).toBe(`${four[k]!.slice(0, 2)}…`)
    await one.unmount()
    // 70칸: 질문까지 넣으면 넘쳐 번호와 취소가 밀려난다. 질문 글을 빼고 선택지와 버튼을 남긴다
    const narrow = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 1, bodyColumns: 70 } })
    expect(await narrow.find({ type: 'Text', text: /^어떤/ })).toBeUndefined()
    expect(await narrow.find({ type: 'Text', text: / 1 $/ })).toBeDefined()
    expect(await narrow.find({ key: 'coach-cancel' })).toBeDefined()
    for (let k = 0; k < 4; k++) expect((await narrow.find({ key: `coach-opt-${k}` }))?.props.label).toMatch(/^.{2,}…$/)
    await narrow.unmount()
  })

  test('질문 단계: 띠 자리로 모양을 고른다. 넉넉하면 질문 위·안내 위에 빈 줄을 차례로 두고, 모자라면 질문과 선택지만, 더 모자라면 질문을 자르고, 1줄이면 한 줄에 (질문 2줄)', async ($, on) => {
    const { s, coach, askAt } = await setup($, on)
    const q = '가'.repeat(40)
    s.qReply = `<questions>${JSON.stringify([{ q, options: ['a', 'b'] }])}</questions>`
    await coach(DRAFT)
    const at = (maxRows: number) => askAt(maxRows, { bodyColumns: 75 })
    expect(await at(12)).toBe('full+2') // 빈 줄은 2줄까지
    expect(await at(9)).toBe('full+2') // 빈 줄·머리줄·초안·안내 4 + 질문 2 + 선택지 1 + 빈 줄 2
    expect(await at(8)).toBe('full+1') // 한 줄만 남으면 질문 위 빈 줄만
    expect(await at(7)).toBe('full') // 남는 줄이 없으면 빈 줄 없이 7줄
    expect(await at(6)).toBe('tight') // 질문 2 + 선택지 1
    expect(await at(3)).toBe('tight')
    expect(await at(2)).toBe('clipped') // 질문을 자른 한 줄 + 선택지 1
    expect(await at(1)).toBe('line')
    expect(await at(0)).toBe('none')
  })

  test('여러 낱말의 긴 질문: 번호 칸을 뺀 폭에서 낱말 단위로 접히는 줄을 센다 (75칸에서 3줄)', async ($, on) => {
    const { s, coach, askAt } = await setup($, on)
    // 138칸. 질문 글 폭은 69칸(75 - 양옆 2 - 번호 3 - 간격 1)이라 67·63·6칸 세 줄로 접힌다. 띠 폭으로 나누면 2줄로 잘못 센다
    const q = 'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor'
    s.qReply = `<questions>${JSON.stringify([{ q, options: ['one', 'two'] }])}</questions>`
    await coach(DRAFT)
    const at = (maxRows: number) => askAt(maxRows, { bodyColumns: 75 })
    expect(await at(8)).toBe('full') // 4 + 질문 3 + 선택지 1
    expect(await at(7)).toBe('tight') // 2줄로 세면 여기서 다 그려 선택지가 "↓ n more" 아래로 숨는다. 질문 3 + 선택지 1 만
    expect(await at(4)).toBe('tight')
    expect(await at(3)).toBe('clipped')
  })

  test('질문 단계: 줄이 남으면 질문 위에 빈 줄을 두고 선택지를 들여 쓴다. 한 줄 더 남으면 안내 위도 띄운다', async ($, on) => {
    const { coach, own } = await setup($, on)
    await coach(DRAFT) // 질문 1줄 + 선택지 1줄: 전체 모양 6줄
    const look = async (maxRows: number, bodyColumns = 120) => {
      const k = await own(maxRows, { bodyColumns })
      const has = (re: RegExp) => k.find(c => re.test(JSON.stringify(c)))
      return { ask: has(/어떤 에러인가요/)?.props.marginTop, indent: has(/coach-opt-0/)?.props.paddingLeft, hint: has(/이 질문의 답/)?.props.marginTop }
    }
    expect(await look(8)).toEqual({ ask: 1, indent: 5, hint: 1 })
    expect(await look(7)).toEqual({ ask: 1, indent: 5, hint: 0 })
    expect(await look(6)).toEqual({ ask: 0, indent: 1, hint: 0 }) // 남는 줄이 없으면 전과 같다
    expect(await look(5)).toEqual({ ask: 0, indent: 1, hint: undefined }) // 질문과 선택지만
    expect(await look(8, 40)).toEqual({ ask: 0, indent: 1, hint: undefined }) // 60칸 미만은 초안·안내가 없어 띄울 것이 없다
  })

  test('질문 단계: 들여 쓴 폭보다 긴 선택지가 있으면 줄이 남아도 띄우거나 들여 쓰지 않는다', async ($, on) => {
    const { s, coach, own, askAt } = await setup($, on)
    // 선택지 55칸 + 번호 3칸 = 58칸. 띠 62칸이면 안쪽 60칸에는 들어가지만 들여 쓴 56칸에는 안 들어간다
    s.qReply = `<questions>${JSON.stringify([{ q: '범위는?', options: ['a'.repeat(55), 'b'] }])}</questions>`
    await coach(DRAFT)
    const k = await own(12, { bodyColumns: 62 })
    const opts = k.find(c => /coach-opt-0/.test(JSON.stringify(c)))
    expect(opts.props.paddingLeft).toBe(1)
    expect(await askAt(12, { bodyColumns: 62 })).toBe('full') // 띄우지도 않는다
    // 4 + 질문 1 + 선택지 2 = 7줄. 선택지를 들여 쓰지 않은 폭에서 2줄로 센다
    expect(await askAt(7, { bodyColumns: 62 })).toBe('full')
    expect(await askAt(6, { bodyColumns: 62 })).toBe('tight')
    expect(await askAt(3, { bodyColumns: 62 })).toBe('tight') // 질문 1 + 선택지 2
    expect(await askAt(2, { bodyColumns: 62 })).toBe('cut') // 선택지 2줄이 안 들어가 한 줄로 자른다
  })

  test('한 줄 모양의 선택지: 칸이 남으면 긴 선택지를 자르지 않는다', async ($, on) => {
    const { s, coach } = await setup($, on)
    const three = ['같은 저장소의 모듈만', '별도 저장소까지 포함', '현재 프로젝트와 직접 의존하는 것만']
    s.qReply = `<questions>${JSON.stringify([{ q: '연관 프로젝트를 어디까지 검토하면 되나요?', options: three }])}</questions>`
    await coach(DRAFT)
    const labels = async (bodyColumns: number) => {
      const b = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 2, bodyColumns } })
      const l = [0, 1, 2].map(async k => ((await b.find({ key: `coach-opt-${k}` })) as any).props.label as string)
      const r = await Promise.all(l)
      await b.unmount()
      return r
    }
    // 200칸 창에 /board 도크(띠 109칸)·22줄: 똑같이 나누면 8칸이 남는데도 세 번째만 '현재 프로젝트와 직접 의…' 로 잘렸다. 이제 모자란 1칸만큼만 줄인다
    expect(await labels(109)).toEqual([three[0], three[1], '현재 프로젝트와 직접 의존하는 것…'])
    expect(await labels(110)).toEqual(three)
    // 80칸 창: 다 들어가지 않으면 긴 것부터 줄인다
    expect((await labels(75)).every(l => l.endsWith('…'))).toBe(true)
  })

  test('만드는 중: 띠 자리가 1줄이면 스피너·상태·초안·취소를 한 줄에', async ($, on) => {
    const { s, coach } = await setup($, on)
    s.hold = true
    await coach(DRAFT)
    const one = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 1 } })
    expect(await one.find({ type: 'Text', text: /^━━ prompt-coach/ })).toBeUndefined()
    const json = JSON.stringify(await one.find({ key: 'coach-busy-line' }))
    expect(json).toContain('1/2 질문 만드는 중')
    expect(json).toContain(`초안  ${DRAFT}`)
    expect(json).toContain('coach-cancel')
    await one.unmount()
  })

  test('입력창에 넣음: 3줄이면 빈 줄을 빼고, 2줄이면 안내를 빼고, 1줄이면 머리줄도 뺀다. 되돌리기는 늘 남는다', async ($, on) => {
    const { coach, press } = await setup($, on)
    await coach(DRAFT)
    await press('coach-now')
    const look = async (maxRows: number) => {
      const b = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows } })
      const head = await b.find({ type: 'Text', text: /^━━ prompt-coach/ })
      const r = { head: head !== undefined, undo: (await b.find({ key: 'coach-undo' })) !== undefined, hint: (await b.find({ type: 'Text', text: /고치거나 그대로 보내세요/ })) !== undefined, gap: JSON.stringify((await b.find({ type: 'Box' }))).includes('"marginTop":1') }
      await b.unmount()
      return r
    }
    expect(await look(4)).toEqual({ head: true, undo: true, hint: true, gap: true })
    expect(await look(3)).toEqual({ head: true, undo: true, hint: true, gap: false })
    expect(await look(2)).toEqual({ head: true, undo: true, hint: false, gap: false })
    expect(await look(1)).toEqual({ head: false, undo: true, hint: false, gap: false })
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
    // 위 mod 가 줄을 다 써 받은 줄이 없으면 [다듬기] 줄을 그리지 않는다. 그려서 넘치면 엔진이 "↓ n more" 에 한 줄을 더 써 위 띠까지 가려진다 (T54)
    const band = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 0 } })
    expect(await band.find({ key: 'coach-refine' })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: /OTHER-MOD-BAND/ })).toBeDefined()
    await band.unmount()
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
    expect((await coach('고쳐')).text).not.toContain('/coach:') // 엔진이 앞에 prompt-coach: 를 붙인다
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

  test('모듈이 내려간 뒤에 돌아온 모델 답은 조용히 버린다 (처리되지 않은 거부를 남기지 않는다)', async ($, on) => {
    const { s, coach } = await setup($, on)
    s.hold = true
    await coach(DRAFT)
    expect(s.box).toBe('')
    // 답을 풀어 주고 기다리지 않는다. 이어지는 코드는 이 테스트가 끝나 모듈이 내려간 뒤에 돌아, 제 상태를 읽다가 거부된다.
    // 그 거부를 삼키지 못하면 파일 끝에서 "a rejection nothing handled" 로 실패한다
    s.release()
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

  test('취소·다듬기 뒤 입력창을 손으로 비우면, 나중에 자동 모드에서 보낸 글은 다시 묻는다', async ($, on) => {
    const { s, settle, coach, press } = await setup($, on)
    await coach(LONG)
    await press('coach-cancel')
    expect(s.box).toBe(LONG)
    s.box = ''
    await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: LONG, cursor: LONG.length, start: 0, end: LONG.length, inputText: '' } as any)
    await coach('auto on')
    expect(await submit($, LONG)).toHaveProperty('drop')
    await settle()
    expect(s.asked).toHaveLength(2)
  })

  test('다듬은 글을 Ctrl+C 로 비우면 보탠 것 줄이 내려가고, 새로 쓴 글이나 히스토리 글은 자동 모드에서 다시 묻는다', async ($, on) => {
    const { s, settle, coach, press, text, type } = await setup($, on)
    await coach('auto on')
    const refine = async () => {
      await coach(LONG)
      await press('coach-now')
      expect(s.box).toBe(REFINED)
      expect(await text(/입력창에 넣음$/)).toBe(true)
    }
    const clear = async () => {
      s.box = ''
      await ($ as any).prompt.change({ text: '', cursor: 0, origin: { kind: 'clear' } })
    }
    await refine()
    await clear()
    expect(await text(/입력창에 넣음$/)).toBe(false)
    await type(LONG)
    expect(await submit($, LONG)).toHaveProperty('drop')
    await settle()
    expect(s.asked).toHaveLength(3)
    await coach('cancel')
    // 히스토리에서 다른 글을 불러와도 다시 묻는다
    await refine()
    await clear()
    s.box = LONG
    await ($ as any).prompt.change({ text: LONG, cursor: LONG.length, origin: { kind: 'history' } })
    expect(await submit($, LONG)).toHaveProperty('drop')
    await settle()
    expect(s.asked).toHaveLength(6)
  })

  test('자동 모드: 다듬은 글을 보낼 때 clear 가 prompt.submit 보다 먼저 와도(2.1.319) 다시 묻지 않는다', async ($, on) => {
    const { s, coach, press } = await setup($, on)
    await coach('auto on')
    await coach(LONG)
    await press('coach-now')
    expect(s.box).toBe(REFINED)
    s.box = ''
    await ($ as any).prompt.change({ text: '', cursor: 0, origin: { kind: 'clear' } })
    expect(await submit($, REFINED)).toMatchObject({ text: REFINED })
    expect(s.asked).toHaveLength(2)
  })

  test('자동 모드: 다듬은 글에서 히스토리로 올라갔다가 다듬은 글로 돌아오면 다시 묻지 않는다', async ($, on) => {
    const { s, coach, press } = await setup($, on)
    await coach('auto on')
    await coach(LONG)
    await press('coach-now')
    expect(s.box).toBe(REFINED)
    const recall = (text: string) => { s.box = text; return ($ as any).prompt.change({ text, cursor: text.length, origin: { kind: 'history' } }) }
    await recall('예전에 보낸 긴 프롬프트 하나를 다시 불러온 글입니다 확인해 주세요')
    await recall(REFINED)
    expect(await submit($, REFINED)).toMatchObject({ text: REFINED })
    expect(s.asked).toHaveLength(2)
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

  // 본문 줄 맨 왼쪽의 배경색 칩: ' 스피너 n/2 단계 · N초 '. 머리줄에는 상태가 없다
  const spin = async (band: any) => {
    const chip = (await band.find({ type: 'Text', text: /\d\/2 .+ · \d+초 $/ })) as any
    const row = JSON.stringify(await band.find({ key: 'coach-busy-line' }))
    return { text: chip.children[0] as string, bg: chip.props.backgroundColor, first: row.indexOf('/2 ') < row.indexOf('초안  '), head: ((await band.find({ type: 'Text', text: /^━━ prompt-coach/ })) as any).children[0] as string }
  }

  test('변환 중: 본문 줄 왼쪽에 배경색 칩(스피너 + 1/2·2/2 단계 + 경과 초), 초안은 그 오른쪽. 틱이 원자를 올려 그려 둔 띠가 다시 그려진다', async ($, on) => {
    const { s, clock, settle, coach, mount, press } = await setup($, on)
    s.hold = true
    await coach(DRAFT)
    const band = await mount()
    const first = await spin(band)
    expect(first.text).toBe(' ⠋ 1/2 질문 만드는 중 · 0초 ')
    expect(first.bg).toBe('claude') // 노랑(답할 차례)과 다른 색
    expect(first.first).toBe(true)
    expect(first.head).toMatch(/^━━ prompt-coach ━+$/) // 머리줄 오른쪽 끝에는 상태를 두지 않는다
    await clock.advance(150)
    await settle()
    expect((await spin(band)).text).toBe(' ⠙ 1/2 질문 만드는 중 · 0초 ') // 같은 띠: 다시 마운트하지 않아도 바뀐다
    await clock.advance(1000)
    await settle()
    expect((await spin(band)).text).toMatch(/1\/2 질문 만드는 중 · 1초 $/)
    await band.unmount()
    // 다듬기 단계는 그 단계 시작부터 센다
    s.hold = false
    await $.command.run({ command: 'coach', args: 'cancel', origin: { kind: 'plugin' } } as any)
    await settle()
    s.box = ''
    await coach(DRAFT)
    s.hold = true
    await clock.advance(5000)
    await settle()
    await press('coach-now')
    const again = await mount()
    expect((await spin(again)).text).toMatch(/2\/2 다듬는 중 · 0초 $/)
    await again.unmount()
  })

  test('변환이 끝나거나(질문으로 넘어감) 취소하면 틱이 멈춰 원자를 더 쓰지 않는다', { plugins: [PEEK_TICK] }, async ($, on) => {
    const { s, clock, settle, coach, run, text } = await setup($, on)
    const peek = async () => (JSON.parse((await $.tool.call({ tool: 'PeekTick' } as any) as any).result).value ?? 0) as number
    // 질문 만드는 중 → 질문 단계
    s.hold = true
    await coach(DRAFT)
    await clock.advance(450)
    await settle()
    expect(await peek()).toBe(3) // 도는 중에는 150ms 마다 오른다
    s.release()
    await settle()
    expect(await text(/질문 1\/2$/)).toBe(true)
    const atQuestions = await peek()
    await clock.advance(1500)
    await settle()
    expect(await peek()).toBe(atQuestions)
    await run('coach', 'cancel')
    await settle()
    // 질문 만드는 중 취소
    await coach(DRAFT)
    await clock.advance(450)
    await settle()
    expect(await peek()).toBe(atQuestions + 3)
    await run('coach', 'cancel')
    await settle()
    const stopped = await peek()
    await clock.advance(1500)
    await settle()
    expect(await peek()).toBe(stopped)
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

  test('/coach view: 끄기를 누르면 설정과 띠 모두 꺼진다', async ($, on) => {
    $pane = $.ui
    const { coach, type, text } = await setup($, on)
    await coach('auto on')
    await type(LONG)
    expect(await text(/ 자동$/)).toBe(true)
    await coach('view')
    const p = await pane()
    expect(await has(p, /^자동 모드 켜짐$/)).toBe(true)
    await p.press({ key: 'view-auto' })
    expect(await has(p, /^자동 모드 꺼짐$/)).toBe(true)
    expect((await coach('auto')).text).toContain('꺼짐')
    expect(await text(/ 자동$/)).toBe(false)
    expect(await submit($, LONG)).toMatchObject({ text: LONG })
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
