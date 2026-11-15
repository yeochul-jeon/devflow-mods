import { describe, expect, test } from 'claude-code/testing'

import { cells } from '../hooks/diagram'
import { buildSeqPrompt, MAX_MESSAGES, MAX_PARTICIPANTS, parseSeq } from '../hooks/prompt'
import { chooseSeqLayout, compactSeq, lifelineLines, listLines, NARROW_CELLS, seqSvg } from '../hooks/sequence'

const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const ANSWER = 'client 가 POST /orders 를 보내면 order-svc 가 payment-svc 에 charge 를 부르고, 실패하면 같은 요청을 다시 보냅니다.'
const DOCK = { component: 'Pane', requestId: 'draw', props: { bodyColumns: 53, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } } as any
const NARROW = { component: 'Pane', requestId: 'draw', props: { bodyColumns: 36, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } } as any
const INLINE = { component: 'Pane', requestId: 'draw', props: { bodyColumns: 78, placement: 'inline', scroll: { offset: 0, bodyRows: 6 } } } as any

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

function boot(on: any, reply: string) {
  const asked: any[] = []
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.messages', () => ({ value: [{ role: 'user', text: '주문은?', toolUses: [] }, { role: 'assistant', text: ANSWER, toolUses: [] }] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('model.complete', ($: any, e: any) => {
    asked.push(e)
    return { value: { isAnswered: true, text: reply, usage: USAGE } }
  })
  return asked
}

describe('시퀀스 프롬프트 (순수 함수)', () => {
  test('원문과 초점, 상한이 프롬프트에 들어간다', async () => {
    const p = buildSeqPrompt(ANSWER, '재시도')
    expect(p).toContain(ANSWER)
    expect(p).toContain('"재시도"')
    expect(p).toContain(`${MAX_PARTICIPANTS}개 이하`)
    expect(p).toContain(`${MAX_MESSAGES}개 이하`)
    expect(p).toContain('"participants"')
  })

  test('JSON 을 꺼내고 참여자 이름을 정리한다', async () => {
    const d = parseSeq('앞글 ' + JSON.stringify({
      title: ' 결제 ',
      participants: [' A ', 'B', 'A', '', 'C', 'D', 'E'],
      messages: [{ from: 'A', to: ' B ', label: ' 요청 ' }, { from: 'B', to: 'A', label: '응답', reply: 'true' }],
      notes: [' n '],
    }) + ' 뒷글')!
    expect(d.title).toBe('결제')
    // 빈 이름과 중복은 빼고 4개까지
    expect(d.participants).toEqual(['A', 'B', 'C', 'D'])
    expect(d.messages).toEqual([
      { from: 'A', to: 'B', label: '요청', reply: false },
      { from: 'B', to: 'A', label: '응답', reply: true },
    ])
    expect(d.notes).toEqual(['n'])
  })

  test('참여자에 없는 이름의 메시지는 빼고 그 개수를 notes 에 남긴다', async () => {
    const d = parseSeq(JSON.stringify({
      title: '',
      participants: ['A', 'B'],
      messages: [{ from: 'A', to: 'B', label: '1' }, { from: 'A', to: 'Z', label: '2' }, { from: 'Y', to: 'A', label: '3' }, { from: 'A', to: 'B', label: ' ' }],
      notes: [],
    }))!
    expect(d.messages.map(m => m.label)).toEqual(['1'])
    expect(d.notes.join('\n')).toContain('참여자 목록에 없는 이름이 든 메시지 2개')
  })

  test('메시지가 상한을 넘으면 자르고 더 있음을 notes 에 남긴다', async () => {
    const msgs = Array.from({ length: MAX_MESSAGES + 3 }, (_, k) => ({ from: 'A', to: 'B', label: `m${k}` }))
    const d = parseSeq(JSON.stringify({ title: '', participants: ['A', 'B'], messages: msgs, notes: [] }))!
    expect(d.messages).toHaveLength(MAX_MESSAGES)
    expect(d.notes.join('\n')).toContain('메시지 3개 더 있음')
  })

  test('형식이 틀리면 null, 주고받음이 없으면 빈 배열', async () => {
    expect(parseSeq('그림 없음')).toBeNull()
    expect(parseSeq('{"participants": 1, "messages": []}')).toBeNull()
    expect(parseSeq('{"flows": []}')).toBeNull()
    const empty = parseSeq('{"title": "", "participants": [], "messages": [], "notes": []}')!
    expect(empty.messages).toEqual([])
  })
})

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

  test('압축형: rows 줄 안에 들고, 보인 수 + 남은 수 = 전체', async () => {
    // label 안의 "  3 " 같은 글자로 개수를 잘못 세지 않는다
    const tricky = { ...MANY, messages: MANY.messages.map((m, k) => ({ ...m, label: `라벨${k}끝  3 x` })) }
    for (const d of [MANY, tricky]) {
      for (const rows of [3, 4, 5, 6]) {
        const { lines, shown } = compactSeq(d, 76, rows)
        expect(lines.length).toBeLessThanOrEqual(rows)
        for (const l of lines) expect(cells(l.text)).toBeLessThanOrEqual(76)
        const last = lines[lines.length - 1]!.text
        const hidden = Number(last.match(/메시지 (\d+)개 더/)?.[1] ?? 0)
        expect(shown + hidden).toBe(d.messages.length)
        // 보인 수는 실제로 그린 메시지 수와 같다 (이름으로 따로 센다)
        const out = lines.map(l => l.text).join('\n')
        expect(d.messages.filter(m => out.includes(m.label)).length).toBe(shown)
      }
    }
    // 다 들어가면 남은 수 줄이 없다
    const all = compactSeq(ORDER, 200, 6)
    expect(all.shown).toBe(ORDER.messages.length)
    expect(all.lines.some(l => /메시지 \d+개 더/.test(l.text))).toBe(false)
    expect(all.lines.some(l => /메모 1개/.test(l.text))).toBe(true)
  })

  test('생명선형: 첫 참여자의 자기 처리는 오른쪽이 좁아도 화면 안에 그린다 (Codex 지적 1)', async () => {
    const d = { title: '', participants: ['A', 'B', 'C', 'D'], messages: [{ from: 'A', to: 'A', label: '저장', reply: false }], notes: [] }
    for (const w of [40, 44, 48]) {
      const text = lifelineLines(d, w).map(l => l.text).join('\n')
      expect(text).toContain('저장')
      expect(text).toContain('<-+')
    }
  })

  test('압축형: 1~2줄 패널에서도 rows 를 넘지 않는다 (Codex 지적 2)', async () => {
    const d = { title: '', participants: ['A', 'B', 'C', 'D'], messages: [{ from: 'A', to: 'B', label: 'x', reply: false }, { from: 'B', to: 'C', label: 'y', reply: false }, { from: 'C', to: 'D', label: 'z', reply: false }], notes: ['n'] }
    for (const rows of [1, 2]) {
      for (const w of [12, 17, 76]) {
        const { lines, shown } = compactSeq(d, w, rows)
        expect(lines.length).toBeLessThanOrEqual(rows)
        // 짧은 꼴 "... 메시지 N개 더" 는 17칸. 12칸에는 다 들어가지 않으니 줄 수만 본다
        if (w < 17) continue
        const hidden = Number(lines[lines.length - 1]!.text.match(/메시지 (\d+)개 더/)?.[1] ?? 0)
        expect(shown + hidden).toBe(d.messages.length)
      }
    }
  })

  test('그림 모양: 그림 위 빈 줄까지 세어 경계에서 압축형으로 (Codex 지적 3)', async () => {
    const d = { title: 'T', participants: ['A', 'B'], messages: [{ from: 'A', to: 'B', label: 'x', reply: false }], notes: [] }
    // 제목 1 + 빈 줄 1 + 생명선 4 = 6줄
    expect(lifelineLines(d, 50)).toHaveLength(4)
    expect(chooseSeqLayout(d, 50, { placement: 'inline', bodyRows: 5 }, '')).toBe('compact')
    expect(chooseSeqLayout(d, 50, { placement: 'inline', bodyRows: 6 }, '')).toBe('lifeline')
  })

  test('이름 안의 줄바꿈과 탭은 빈칸 하나로 바꾼다 (Codex 지적 4)', async () => {
    const d = parseSeq(JSON.stringify({ title: 't\nu', participants: ['A\nB', 'C'], messages: [{ from: 'A\nB', to: 'C', label: 'x\n\ty' }], notes: ['a\nb'] }))!
    expect(d.participants).toEqual(['A B', 'C'])
    expect(d.messages[0]).toEqual({ from: 'A B', to: 'C', label: 'x y', reply: false })
    expect(d.title).toBe('t u')
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
        for (const lines of [lifelineLines(d, w), listLines(d, w), compactSeq(d, w, 4).lines]) {
          for (const l of lines) expect(cells(l.text)).toBeLessThanOrEqual(w)
        }
      }
    }
  })

  test('그림 모양: 옆 패널은 생명선형, 좁으면 목록형, 위 패널에서 넘치면 압축형', async () => {
    expect(chooseSeqLayout(ORDER, 51, { placement: 'dock', bodyRows: 6 }, '')).toBe('lifeline')
    expect(chooseSeqLayout(ORDER, NARROW_CELLS - 1, { placement: 'dock', bodyRows: 40 }, '')).toBe('list')
    expect(chooseSeqLayout(ORDER, NARROW_CELLS, { placement: 'dock', bodyRows: 40 }, '')).toBe('lifeline')
    expect(chooseSeqLayout(MANY, 76, { placement: 'inline', bodyRows: 6 }, '')).toBe('compact')
    expect(chooseSeqLayout(ORDER, 76, { placement: 'inline', bodyRows: 40 }, '')).toBe('lifeline')
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

describe('/draw-seq', () => {
  test('기본은 Haiku + effort high, 생명선형을 옆 패널에 그린다', async ($, on) => {
    const asked = boot(on, JSON.stringify(ORDER))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'draw-seq', args: '' } as any)

    expect(text).toContain('옆 패널')
    expect(asked).toHaveLength(1)
    expect(asked[0].model).toBe('haiku')
    expect(asked[0].effort).toBe('high')
    // 생각 토큰을 포함한 출력이 effort high 측정에서 5.5천까지 나왔다
    expect(asked[0].maxTokens).toBeGreaterThanOrEqual(16000)
    expect(asked[0].prompt).toContain('"participants"')
    expect(asked[0].prompt).toContain(ANSWER)

    const ui = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...DOCK })
    expect(await ui.find({ type: 'Text', text: /^주문 결제$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /client .* order-svc .* payment-svc/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\| 1 POST \/orders/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /charge 실패면/ })).toBeDefined()
    await ui.unmount()
  })

  test('설정한 모델과 effort 로 부른다', { options: { seqModel: 'sonnet', seqEffort: 'low' } }, async ($, on) => {
    const asked = boot(on, JSON.stringify(ORDER))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'draw-seq', args: '재시도' } as any)
    expect(asked[0].model).toBe('sonnet')
    expect(asked[0].effort).toBe('low')
    expect(asked[0].prompt).toContain('"재시도"')
  })

  test('/draw 는 그대로 Haiku, effort 없음', async ($, on) => {
    const asked = boot(on, JSON.stringify({ title: '', flows: [{ label: 'a', steps: ['x', 'y'] }], notes: [] }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'draw', args: '' } as any)
    expect(asked[0].model).toBe('haiku')
    expect(asked[0].effort).toBeUndefined()
    expect(asked[0].prompt).toContain('"flows"')
  })

  test('주고받음이 없으면 이유를 패널과 답에 보인다', async ($, on) => {
    boot(on, '{"title": "", "participants": [], "messages": [], "notes": []}')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'draw-seq', args: '' } as any)
    expect(text).toContain('주고받음을 찾지 못했어요')
    const ui = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...DOCK })
    expect(await ui.find({ type: 'Text', text: /주고받음을 찾지 못했어요/ })).toBeDefined()
    await ui.unmount()
  })

  test('JSON 이 아니면 형식 오류를 보인다', async ($, on) => {
    boot(on, '못 그렸어요')
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const { text } = await $.command.run({ command: 'draw-seq', args: '' } as any)
    expect(text).toContain('JSON')
    expect(text).toContain('/draw-seq')
  })

  test('좁은 패널에서는 번호 목록형', async ($, on) => {
    boot(on, JSON.stringify(ORDER))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'draw-seq', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...NARROW })
    expect(await ui.find({ type: 'Text', text: /^ 1 A > B  POST \/orders$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /\| 1 POST/ })).toBeUndefined()
    await ui.unmount()
  })

  test('프롬프트 위 패널에서 넘치면 압축형, 마지막 줄에 남은 메시지 수', async ($, on) => {
    boot(on, JSON.stringify(MANY))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'draw-seq', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...INLINE })
    expect(await ui.find({ type: 'Text', text: /메시지 \d+개 더/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^주문 결제$/ })).toBeUndefined()
    await ui.unmount()
  })

  test('데스크톱 앱에서는 생명선을 Svg 하나로 그린다', async ($, on) => {
    boot(on, JSON.stringify(ORDER))
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'draw-seq', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'draw', surface: 'desktop', ...DOCK })
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs).toHaveLength(1)
    const own = seqSvg(ORDER, 51)
    expect(svgs[0]!.props.width).toBe(own.width)
    expect(svgs[0]!.props.height).toBe(own.height)
    expect(String(svgs[0]!.props.alt)).toContain('1 client → order-svc: POST /orders')
    expect(await ui.find({ type: 'Text', text: /\| 1 POST/ })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /charge 실패면/ })).toBeDefined()
    await ui.unmount()
  })

  test('터미널에는 Svg 가 없다', async ($, on) => {
    boot(on, JSON.stringify(ORDER))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'draw-seq', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...DOCK })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
    await ui.unmount()
  })
})
