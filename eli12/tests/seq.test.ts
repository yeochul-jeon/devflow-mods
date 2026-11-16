import { describe, expect, test } from 'claude-code/testing'

import { cells } from '../hooks/diagram'
import { buildPrompt, buildTopicPrompt, MAX_MESSAGES, parseEli12, parseSequence } from '../hooks/prompt'
import { lifelineLines, listLines, NARROW_CELLS, seqSvg } from '../hooks/sequence'

// 그림 함수 시험은 draw/tests/seq.test.ts 에서 옮겼다 (압축형·그림 모양 고르기는 eli12 에 없어 뺐다). draw 쪽을 고치면 여기도 맞춘다.
const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ORDER = {
  title: '주문 결제',
  participants: ['client', 'order-svc', 'payment-svc'],
  messages: [
    { from: 'client', to: 'order-svc', label: 'POST /orders', reply: false },
    { from: 'order-svc', to: 'payment-svc', label: 'charge', reply: false },
    { from: 'payment-svc', to: 'order-svc', label: '결제 결과', reply: true },
    { from: 'order-svc', to: 'order-svc', label: '주문 저장', reply: false },
    { from: 'order-svc', to: 'client', label: '201 Created', reply: true },
  ],
  notes: ['charge 실패면 같은 요청을 다시 보냄'],
}
const MANY = {
  ...ORDER,
  messages: Array.from({ length: 10 }, (_, k) => ({ from: 'client', to: 'order-svc', label: `메시지 이름 ${k + 1} 번째 요청을 보낸다`, reply: k % 2 === 1 })),
}

describe('시퀀스 그림 (순수 함수)', () => {

  test('생명선형: 참여자마다 세로줄, 화살표 위에 번호와 이름, 응답은 점선', async () => {
    const d = { title: '', participants: ['A', 'B'], messages: [{ from: 'A', to: 'B', label: '요청', reply: false }, { from: 'B', to: 'A', label: '응답', reply: true }], notes: [] }
    expect(lifelineLines(d, 20).map(l => l.text)).toEqual([
      '  A              B',
      '  |              |',
      '  | 1 요청       |',
      '  |------------->|',
      '  | 2 응답       |',
      '  |<.............|',
    ])
  })

  test('생명선형: 자기 자신에게 하는 일은 오른쪽(마지막 참여자는 왼쪽)으로 돌아오는 고리', async () => {
    const d = { title: '', participants: ['A', 'B'], messages: [{ from: 'A', to: 'A', label: '저장', reply: false }, { from: 'B', to: 'B', label: '기록', reply: false }], notes: [] }
    const text = lifelineLines(d, 40).map(l => l.text)
    expect(text).toContain('  |--+ 1 저장' + ' '.repeat(24) + '|')
    expect(text).toContain('  |<-+' + ' '.repeat(31) + '|')
    expect(text.some(l => /2 기록 \+--\|$/.test(l))).toBe(true)
    expect(text.some(l => / \+->\|$/.test(l))).toBe(true)
  })

  test('생명선형: 머리의 참여자 이름은 서로 겹치지 않는다', async () => {
    const four = { title: '', participants: ['가나다라마바사', 'abcdefghijklmn', '아자차카타파하', 'opqrstuvwxyz12'], messages: [], notes: [] }
    const head = lifelineLines(four, 51)[0]!.text
    for (const p of four.participants) expect(head).toContain(p.slice(0, 3))
    // 잘린 이름은 … 로 끝나고, 이름 사이에는 빈칸이 하나 이상 있다
    const names = head.trim().split(/ +/)
    expect(names).toHaveLength(4)
    const two = { title: '', participants: ['payment-gateway-adapter-service', 'order-command-handler-service'], messages: [], notes: [] }
    const h2 = lifelineLines(two, 51)[0]!.text
    expect(h2.trim().split(/ +/)).toHaveLength(2)
    expect(cells(h2)).toBeLessThanOrEqual(51)
  })

  test('번호 목록형: 범례 뒤에 한 메시지 한 줄, 넘치면 들여 써서 잇는다', async () => {
    const lines = listLines(ORDER, 34).map(l => l.text)
    expect(lines[0]).toBe('A client   B order-svc')
    expect(lines[1]).toBe('C payment-svc')
    expect(lines).toContain(' 1 A > B  POST /orders')
    expect(lines).toContain(' 3 C > B  결제 결과')
    expect(lines).toContain(' 4 B      주문 저장')
    const long = listLines({ ...ORDER, messages: [{ from: 'client', to: 'order-svc', label: '아주 긴 메시지 이름이 한 줄을 넘는다', reply: false }] }, 24).map(l => l.text)
    expect(long.slice(2)).toEqual([' 1 A > B  아주 긴 메시지', '          이름이 한 줄을', '          넘는다'])
  })

  test('생명선형: 첫 참여자의 자기 처리는 오른쪽이 좁아도 화면 안에 그린다 (Codex 지적 1)', async () => {
    const d = { title: '', participants: ['A', 'B', 'C', 'D'], messages: [{ from: 'A', to: 'A', label: '저장', reply: false }], notes: [] }
    for (const w of [40, 44, 48]) {
      const text = lifelineLines(d, w).map(l => l.text).join('\n')
      expect(text).toContain('저장')
      expect(text).toContain('<-+')
    }
  })

  test('생명선형: 결합 문자(0칸 글자)가 든 이름도 세로줄이 같은 칸에 선다 (Codex 지적 6)', async () => {
    const d = { title: '', participants: ['A', 'B'], messages: [{ from: 'A', to: 'B', label: 'café', reply: false }, { from: 'B', to: 'A', label: 'ño', reply: true }], notes: [] }
    const text = lifelineLines(d, 20).map(l => l.text)
    // 머리 줄을 뺀 모든 줄이 오른쪽 세로줄 '|' 로 끝나고 칸 수가 같다
    expect(text.slice(1).map(t => [t.endsWith('|'), cells(t)])).toEqual(text.slice(1).map(() => [true, 18]))
    // 결합 문자는 버리지 않고 앞 글자에 붙인다
    expect(text.join('\n')).toContain('café')
    expect(text.join('\n')).toContain('ño')
  })

  test('이름 안의 줄바꿈과 탭은 빈칸 하나로 바꾼다 (Codex 지적 4)', async () => {
    const d = parseSequence({ participants: ['A\nB', 'C'], messages: [{ from: 'A\nB', to: 'C', label: 'x\n\ty' }] })!
    expect(d.participants).toEqual(['A B', 'C'])
    expect(d.messages[0]).toEqual({ from: 'A B', to: 'C', label: 'x y', reply: false })
    for (const l of lifelineLines(d, 50)) expect(l.text).not.toMatch(/[\n\t]/)
  })

  test('어느 폭과 참여자 수에서도 끝나고 줄이 폭을 넘지 않는다', async () => {
    const names = ['client', '결제 서비스 어댑터', 'B', 'payment-gateway-adapter']
    for (let n = 1; n <= 4; n++) {
      const participants = names.slice(0, n)
      const messages = [
        { from: participants[0]!, to: participants[n - 1]!, label: '아주 긴 한글 메시지 이름이 여러 줄로 접힌다 /api/v1/orders', reply: false },
        { from: participants[n - 1]!, to: participants[0]!, label: '응답', reply: true },
        { from: participants[0]!, to: participants[0]!, label: '자기 처리 단계 이름도 길다', reply: false },
        { from: participants[n - 1]!, to: participants[n - 1]!, label: '끝', reply: false },
      ]
      const d = { title: '', participants, messages, notes: [] }
      for (let w = 8; w <= 120; w++) {
        for (const lines of [lifelineLines(d, w), listLines(d, w)]) {
          for (const l of lines) expect(cells(l.text)).toBeLessThanOrEqual(w)
        }
      }
    }
  })

  test('Svg: xmlns, viewBox, 자기 크기를 갖춘 문서 하나, marker 와 style 없음', async () => {
    const svg = seqSvg(ORDER, 51)
    expect(svg.source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.source.endsWith('</svg>')).toBe(true)
    expect(svg.source).toContain(`viewBox="0 0 ${svg.width} ${svg.height}"`)
    expect(svg.source).toContain(`width="${svg.width}"`)
    expect(svg.source).not.toContain('<style')
    expect(svg.source).not.toContain('<marker')
  })

  test('Svg: 참여자 상자, 메시지마다 바탕 칠한 이름표, 응답은 점선', async () => {
    const svg = seqSvg(ORDER, 51)
    for (const p of ORDER.participants) expect(svg.source).toContain(`>${p}</text>`)
    expect(svg.source).toContain('>1 POST /orders</text>')
    expect(svg.source).toContain('>3 결제 결과</text>')
    // 어두운 테마에서도 읽히게 이름표마다 옅은 바탕 (참여자 3 + 메시지 5)
    expect(svg.source.match(/<rect /g)?.length).toBe(ORDER.participants.length + ORDER.messages.length)
    // 응답 2개만 점선 (생명선 3개 점선은 따로 센다)
    expect(svg.source.match(/<path [^>]*stroke-dasharray="5 4"/g)?.length).toBe(2)
    expect(svg.source).toContain('textLength=')
  })

  test('Svg: 넓은 라틴 대문자 이름표도 그림 밖으로 나가지 않는다', async () => {
    const names = ['A', 'B', 'C', 'D']
    for (let n = 1; n <= 4; n++) {
      const ps = names.slice(0, n)
      for (const label of ['M'.repeat(30), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_WWW', '가'.repeat(40)]) {
        const messages = [
          { from: ps[0]!, to: ps[0]!, label, reply: false },
          { from: ps[n - 1]!, to: ps[n - 1]!, label, reply: false },
          { from: ps[0]!, to: ps[n - 1]!, label, reply: false },
        ]
        for (const cellsW of [8, 34, 51, 120]) {
          const svg = seqSvg({ title: '', participants: ps, messages, notes: [] }, cellsW)
          const dx = Number(svg.source.match(/<g transform="translate\(([-\d.]+) 0\)">/)?.[1] ?? 0)
          for (const m of svg.source.matchAll(/<rect x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)"/g)) {
            const x = Number(m[1]) + dx
            expect(x).toBeGreaterThanOrEqual(0)
            expect(x + Number(m[2])).toBeLessThanOrEqual(svg.width)
          }
          expect(svg.source).toContain(`viewBox="0 0 ${svg.width} ${svg.height}"`)
        }
      }
    }
  })

  test('Svg: 글자는 XML 이스케이프하고 금지 제어문자는 뺀다', async () => {
    const d = { title: '', participants: ['a<b', 'c&d'], messages: [{ from: 'a<b', to: 'c&d', label: 'x"\u0001y￾', reply: false }], notes: [] }
    const svg = seqSvg(d, 51)
    expect(svg.source).toContain('a&lt;b')
    expect(svg.source).toContain('c&amp;d')
    expect(svg.source).toContain('1 x&quot;y</text>')
    expect(svg.source).not.toContain('\u0001')
  })

  test('Svg: 아주 긴 이름도 Svg 상한(131072자) 안', async () => {
    const big = 'a'.repeat(5000)
    const d = { title: '', participants: [big, big + 'b', big + 'c', big + 'd'], messages: Array.from({ length: 10 }, () => ({ from: big, to: big + 'd', label: big, reply: false })), notes: [] }
    const svg = seqSvg(d, 8)
    expect(svg.source.length).toBeLessThanOrEqual(131072)
    expect(svg.source).toContain('…')
  })

  test('Svg: 0칸 글자(결합 문자)로 채운 이름도 상한 안 (Codex 지적 5)', async () => {
    const d = { title: '', participants: ['A', 'B'], messages: [{ from: 'A', to: 'B', label: '\u0301'.repeat(140000), reply: false }], notes: [] }
    expect(seqSvg(d, 51).source.length).toBeLessThanOrEqual(131072)
    const p = { title: '', participants: ['\u0301'.repeat(140000), 'B'], messages: [], notes: [] }
    expect(seqSvg(p, 51).source.length).toBeLessThanOrEqual(131072)
  })
})

const SEQ_REPLY = {
  summary: '주문과 결제',
  analogy: '가게에 주문서를 내면 계산대가 카드사에 물어봐요.',
  flows: [],
  sequence: {
    participants: ['손님', '가게', '카드사'],
    messages: [
      { from: '손님', to: '가게', label: '주문서 냄' },
      { from: '가게', to: '카드사', label: '결제해도 돼요?' },
      { from: '카드사', to: '가게', label: '승인', reply: true },
      { from: '가게', to: '손님', label: '영수증', reply: true },
    ],
  },
  remember: ['하나', '둘', '셋'],
}

describe('시퀀스 읽기 (eli12)', () => {
  test('직전 답 프롬프트는 flows 와 sequence 중 하나를 고르게 하고, 주제 프롬프트는 그대로', async () => {
    const p = buildPrompt('설명', '')
    expect(p).toContain('"sequence"')
    expect(p).toContain('flows 와 sequence 중 하나만')
    expect(buildTopicPrompt('주제')).not.toContain('sequence')
  })

  test('sequence 가 쓸 만하면 시퀀스를 쓰고 flows 는 버린다', async () => {
    const d = parseEli12(JSON.stringify({ ...SEQ_REPLY, flows: [{ label: 'a', steps: ['1', '2'] }] }))!
    expect(d.sequence!.participants).toEqual(['손님', '가게', '카드사'])
    expect(d.sequence!.messages).toHaveLength(4)
    expect(d.sequence!.messages[2]!.reply).toBe(true)
    expect(d.flows).toEqual([])
  })

  test('참여자가 2명 미만이거나 남은 메시지가 없으면 시퀀스를 버리고 flows 를 쓴다', async () => {
    const flows = [{ label: 'a', steps: ['1', '2'] }]
    const cases = [
      { participants: ['혼자'], messages: [{ from: '혼자', to: '혼자', label: '일' }] },
      { participants: ['A', 'B'], messages: [{ from: 'A', to: 'Z', label: '모르는 이름' }] },
      { participants: ['A', 'B'], messages: [] },
      { participants: 'A', messages: [] },
      null,
    ]
    for (const sequence of cases) {
      const d = parseEli12(JSON.stringify({ ...SEQ_REPLY, flows, sequence }))!
      expect([JSON.stringify(sequence), d.sequence ?? null, d.flows.length]).toEqual([JSON.stringify(sequence), null, 1])
    }
    // flows 도 비면 그림 없이 나머지만 (지금과 같음)
    expect(parseEli12(JSON.stringify({ ...SEQ_REPLY, sequence: null }))!.flows).toEqual([])
  })

  test('모르는 이름이 든 메시지는 빼고 개수를, 상한을 넘으면 더 있음을 메모로 남긴다', async () => {
    const msgs = Array.from({ length: MAX_MESSAGES + 2 }, (_, k) => ({ from: 'A', to: 'B', label: `m${k}` }))
    const d = parseSequence({ participants: [' A ', 'B', 'A', '', 'C', 'D', 'E'], messages: [{ from: 'A', to: 'Q', label: 'x' }, ...msgs] })!
    expect(d.participants).toEqual(['A', 'B', 'C', 'D'])
    expect(d.messages).toHaveLength(MAX_MESSAGES)
    expect(d.notes.join('\n')).toContain('참여자 목록에 없는 이름이 든 메시지 1개')
    expect(d.notes.join('\n')).toContain('메시지 2개 더 있음')
  })
})

describe('/eli12 시퀀스 그림', () => {
  function boot(on: any) {
    on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: '주문하면 결제 서비스에 승인을 묻습니다.', toolUses: [] }] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('model.complete', () => ({ value: { isAnswered: true, text: JSON.stringify(SEQ_REPLY), usage: USAGE } }))
  }
  const pane = (bodyColumns: number) => ({ component: 'Pane', requestId: 'eli12', props: { bodyColumns } }) as any

  test('넓은 패널은 생명선형, 흐름 상자는 그리지 않는다', async ($, on) => {
    boot(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'eli12', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'eli12', surface: 'terminal', ...pane(60) })
    expect(await ui.find({ type: 'Text', text: /^그림$/ })).toBeDefined()
    // 그림 칸은 4칸 안쪽(56칸)에 생명선형으로
    const want = lifelineLines(parseEli12(JSON.stringify(SEQ_REPLY))!.sequence!, 56)
    for (const l of want) expect([l.text, (await ui.find({ type: 'Text', text: l.text }))?.text]).toEqual([l.text, l.text])
    expect((await ui.findAll({ type: 'Box' })).filter(b => b.props.borderStyle === 'round')).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: /^셋$/ })).toBeDefined()
    await ui.unmount()
  })

  test(`좁은 패널(그림 폭 ${NARROW_CELLS}칸 미만)은 번호 목록형`, async ($, on) => {
    boot(on)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'eli12', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'eli12', surface: 'terminal', ...pane(40) })
    expect(await ui.find({ type: 'Text', text: /^A 손님   B 가게/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^ 2 B > C  결제해도 돼요\?$/ })).toBeDefined()
    await ui.unmount()
  })

  test('데스크톱 앱에서는 Svg 하나, 자기 크기로', async ($, on) => {
    boot(on)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'eli12', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'eli12', surface: 'desktop', ...pane(60) })
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs).toHaveLength(1)
    const own = seqSvg(parseEli12(JSON.stringify(SEQ_REPLY))!.sequence!, 56)
    expect([svgs[0]!.props.width, svgs[0]!.props.height]).toEqual([own.width, own.height])
    expect(svgs[0]!.props.alt).toContain('1 손님 → 가게: 주문서 냄')
    await ui.unmount()
  })

  test('메모는 그림 아래 흐린 줄', async ($, on) => {
    on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: '설명', toolUses: [] }] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const reply = { ...SEQ_REPLY, sequence: { ...SEQ_REPLY.sequence, messages: [...SEQ_REPLY.sequence.messages, { from: '가게', to: '은행', label: 'x' }] } }
    on('model.complete', () => ({ value: { isAnswered: true, text: JSON.stringify(reply), usage: USAGE } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'eli12', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'eli12', surface: 'terminal', ...pane(60) })
    const note = await ui.find({ type: 'Text', text: /참여자 목록에 없는 이름이 든 메시지 1개/ })
    expect(note?.props.dimColor).toBe(true)
    await ui.unmount()
  })
})
