import { describe, expect, mock, test } from 'claude-code/testing'

import { cells, chooseLayout, compactHeight, compactLines, flowSvg, fullHeight, packRows, progressBar, rowHeight, textPx } from '../hooks/diagram'
import { buildPrompt, parseDraw } from '../hooks/prompt'

const PANE = { component: 'Pane', requestId: 'draw', props: { bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } } as any
const SMALL = { component: 'Pane', requestId: 'draw', props: { bodyColumns: 78, placement: 'inline', scroll: { offset: 0, bodyRows: 3 } } } as any
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

describe('그림 (순수 함수)', () => {
  const MANY = {
    title: 'band 행 배분',
    flows: [
      { label: '행이 충분할 때', steps: ['maxRows 읽기', 'team-board', 'next-steps', 'prompt-coach'] },
      { label: '행이 모자랄 때', steps: ['maxRows 읽기', '바깥 mod 가 순서를 정한다', '넘친 줄은 위쪽만 보인다'] },
      { label: '2.1.323 부터', steps: ['mod 마다 따로 묻는다', 'AbovePromptList 가 쌓는다'] },
      { label: 'maxRows 0', steps: ['아무것도 그리지 않는다', '다른 mod 행 유지'] },
    ],
    notes: ['--plugin-dir 로 띄운 mod 는 앞에 붙지 않는다', 'team-board 창을 안 그려도 1행이 남는다'],
  }
  const boxWidth = (lines: string[]) => Math.max(...lines.map(cells)) + 4
  const rowWidth = (r: { boxes: string[][]; more: boolean }) =>
    r.boxes.reduce((a, b) => a + boxWidth(b), 0) + (r.boxes.length - 1) * 3 + (r.more ? 2 : 0)

  test('상자를 폭에 맞춰 여러 줄로 접는다 (A1)', async () => {
    const rows = packRows(['bump', 'test', 'commit', 'release.sh', 'install'], 51)
    expect(rows.map(r => r.boxes.map(b => b.join(' ')))).toEqual([['bump', 'test', 'commit', 'release.sh'], ['install']])
    expect(rows.map(r => r.more)).toEqual([true, false])
    for (const r of rows) expect(rowWidth(r)).toBeLessThanOrEqual(51)
  })

  test('6단계까지만 그린다', async () => {
    const rows = packRows(['하나', '둘', '셋', '넷', '다섯', '여섯', '일곱'], 80)
    const names = rows.flatMap(r => r.boxes.map(b => b.join(' ')))
    expect(names).toEqual(['하나', '둘', '셋', '넷', '다섯', '여섯'])
  })

  test('패널보다 긴 이름은 자르지 않고 상자 안에서 줄을 바꾼다', async () => {
    const id = 'ArsCustomerService.saveCustomerDeliveryAddress'
    const rows = packRows(['배포 전 캡처 (--env qa --when before)', id], 24)
    const all = rows.flatMap(r => r.boxes)
    expect(all.map(b => b.join(''))).toEqual(['배포 전 캡처(--env qa --whenbefore)', id])
    for (const r of rows) expect(rowWidth(r)).toBeLessThanOrEqual(24)
  })

  test('높이: 상자 줄은 테두리 2줄 + 이름 줄 수', async () => {
    const rows = packRows(['bump', 'test', 'commit', 'release.sh', 'install'], 51)
    expect(rows.map(rowHeight)).toEqual([3, 3])
  })

  test('압축 줄: 흐름마다 번호·이름 뒤에 칩을 잇고 폭을 넘으면 들여 써서 잇는다 (B1)', async () => {
    const lines = compactLines('2. 행이 모자랄 때', MANY.flows[1]!.steps, 50)
    const text = lines.map(l => l.map(s => s.text).join(''))
    const pad = ' '.repeat(cells('2. 행이 모자랄 때') + 2)
    expect(text).toEqual([
      '2. 행이 모자랄 때' + '  ' + 'maxRows 읽기' + ' →',
      pad + '바깥 mod 가 순서를 정한다' + ' →',
      pad + '넘친 줄은 위쪽만 보인다',
    ])
    for (const l of text) expect(cells(l)).toBeLessThanOrEqual(50)
    expect(lines[0]!.filter(s => s.kind === 'chip').map(s => s.text)).toEqual(['maxRows 읽기'])
  })

  test('압축 줄: 머리가 길어 남은 칸이 모자라면 칩을 새 줄에서 시작한다', async () => {
    const head = '1. ' + '가'.repeat(22)
    const step = '바깥 mod 가 순서를 정한다'
    const lines = compactLines(head, [step, '끝'], 51)
    const text = lines.map(l => l.map(s => s.text).join(''))
    expect(text[0]).toBe(head)
    expect(lines.flatMap(l => l.filter(s => s.kind === 'chip').map(s => s.text))).toEqual([step, '끝'])
    for (const l of text) expect(cells(l)).toBeLessThanOrEqual(51)
  })

  test('프롬프트 위 패널에서 보이는 줄 수를 넘으면 압축형, 옆 패널은 늘 상자 그림', async () => {
    expect(chooseLayout(MANY, 74, { placement: 'inline', bodyRows: 6 }, '')).toBe('compact')
    expect(chooseLayout(MANY, 74, { placement: 'inline', bodyRows: 40 }, '')).toBe('full')
    // 옆에 붙은 패널은 넘쳐도 상자 그림 (스크롤로 본다)
    expect(chooseLayout(MANY, 51, { placement: 'dock', bodyRows: 6 }, '')).toBe('full')
    expect(fullHeight(MANY, 51, '')).toBeGreaterThan(6)
  })

  test('높이: 접히는 제목·초점 줄도 센다', async () => {
    const d = { title: 'a'.repeat(21), flows: [{ label: '', steps: ['A'] }], notes: [] }
    expect(fullHeight(d, 20, '')).toBe(2 + 1 + 1 + 3)
    expect(chooseLayout(d, 20, { placement: 'inline', bodyRows: 6 }, '')).toBe('compact')
    expect(fullHeight(d, 20, 'f'.repeat(30))).toBe(2 + 2 + 1 + 1 + 3)
  })

  test('압축 줄: 머리가 폭의 절반을 넘으면 머리만 한 줄, 칩은 다음 줄부터', async () => {
    const head = '1. ' + 'a'.repeat(21)
    const lines = compactLines(head, ['A'], 20)
    expect(lines.map(l => l.map(s => s.text).join(''))).toEqual([head, '  A'])
    expect(compactHeight({ title: '', flows: [{ label: 'a'.repeat(21), steps: ['A'] }], notes: [] }, 20)).toBe(3)
  })

  test('압축형 높이는 80×24 패널(6줄)에 흐름 4개가 들어간다', async () => {
    expect(compactHeight(MANY, 74)).toBeLessThanOrEqual(6)
  })

  test('진행 막대: 평소 시간 대비 채우고 넘치면 가득 찬다 (D2)', async () => {
    expect(progressBar(12, 15, 20)).toBe('█'.repeat(16) + '░'.repeat(4))
    expect(progressBar(0, 15, 10)).toBe('░'.repeat(10))
    expect(progressBar(40, 15, 10)).toBe('█'.repeat(10))
  })

  // Svg (E3): 데스크톱 앱·VS Code·모바일. 이미지로 그려지므로 xmlns 가 없거나 XML 이 틀리면 경고 없이 빈 그림이 된다
  test('Svg: xmlns·viewBox 를 갖춘 문서 하나', async () => {
    const svg = flowSvg(['bump', 'test'], 51, 0)
    expect(svg.source.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg.source.endsWith('</svg>')).toBe(true)
    expect(svg.source).toContain(`viewBox="0 0 ${svg.width} ${svg.height}"`)
    expect(svg.source).toContain(`width="${svg.width}"`)
    expect(svg.source).not.toContain('<style')
  })

  test('Svg: 글자는 XML 이스케이프하고 금지 제어문자는 뺀다', async () => {
    const svg = flowSvg(['a<b & "c"', "d'e\u0001f", 'x]]>y', 'p\ufffeq\uffffr', 's\ud800t', '😀'], 51, 0)
    expect(svg.source).toContain('a&lt;b &amp; &quot;c&quot;')
    expect(svg.source).toContain('d&apos;ef')
    expect(svg.source).toContain('x]]&gt;y')
    expect(svg.source).toContain('>pqr</text>')
    expect(svg.source).toContain('>st</text>')
    // 짝이 맞는 서로게이트(이모지)는 남긴다
    expect(svg.source).toContain('😀')
    expect(svg.source).not.toContain('\u0001')
  })

  test('Svg: 좁은 패널의 아주 긴 이름도 Svg 상한(131072자) 안', async () => {
    const svg = flowSvg(Array(6).fill('a'.repeat(5000)), 8, 0)
    expect(svg.source.length).toBeLessThanOrEqual(131072)
    expect(svg.source).toContain('…')
  })

  test('Svg: 6단계까지, 상자마다 단계 이름 하나', async () => {
    const svg = flowSvg(['하나', '둘', '셋', '넷', '다섯', '여섯', '일곱'], 200, 1)
    expect(svg.source.match(/<rect /g)?.length).toBe(6)
    expect(svg.source).toContain('>여섯</text>')
    expect(svg.source).not.toContain('일곱')
  })

  test('Svg: 상자 폭은 글자 폭 어림을 따르고, 넓은 라틴 대문자는 더 넓게 잡는다', async () => {
    expect(textPx('가나')).toBeGreaterThan(textPx('ab'))
    expect(textPx('WWWW')).toBeGreaterThan(textPx('iiii'))
    const narrow = flowSvg(['iiii'], 51, 0)
    const wide = flowSvg(['WWWW_MMMM'], 51, 0)
    expect(wide.width).toBeGreaterThan(narrow.width)
    // 어림이 모자라도 상자 밖으로 넘치지 않게 글자를 어림 폭에 맞춘다
    expect(wide.source).toContain('lengthAdjust="spacingAndGlyphs"')
  })

  test('Svg: 접히면 높이가 늘고 줄 끝에 이어짐 화살표를 그린다', async () => {
    const steps = ['bump', 'test', 'commit', 'release.sh', 'install']
    const one = flowSvg(steps, 200, 0)
    const two = flowSvg(steps, 51, 0)
    expect(packRows(steps, 51)).toHaveLength(2)
    expect(two.height).toBeGreaterThan(one.height)
    expect(two.width).toBeLessThan(one.width)
    // 단계 5개 = 이음 4개: 한 줄이면 상자 사이 4개, 접히면 상자 사이 3개 + 줄 끝 1개
    expect(one.source.match(/<path /g)?.length).toBe(4)
    expect(two.source.match(/<path /g)?.length).toBe(4)
  })

  test('Svg: 흐름마다 다른 색, 화살표는 밝음·어두움 둘 다 보이는 회색', async () => {
    const a = flowSvg(['x', 'y'], 51, 0)
    const b = flowSvg(['x', 'y'], 51, 1)
    expect(a.source).not.toBe(b.source)
    expect(a.source).toContain('#8a8a8a')
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
    expect(await ui.find({ type: 'Text', text: /^1. 첫 프롬프트$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^prompt\.submit$/ })).toBeDefined()
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

describe('패널 배치', () => {
  const REPLY = JSON.stringify({
    title: '규칙 주입',
    flows: [
      { label: '첫 프롬프트', steps: ['prompt.submit', '규칙 붙임'] },
      { label: 'compact 뒤', steps: ['session.compact', 'pending 켬', '다음 프롬프트에 붙임'] },
    ],
    notes: ['compact 뒤 다시'],
  })

  test('보이는 줄이 모자라면 흐름마다 칩 한 줄로 그린다', async ($, on) => {
    boot(on, REPLY)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'draw', args: '' } as any)

    const ui = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...SMALL })
    expect(await ui.find({ type: 'Text', text: /^1. 첫 프롬프트$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^prompt\.submit$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^2. compact 뒤$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /메모 1개/ })).toBeDefined()
    await ui.unmount()
  })

  test('그리는 동안 경과 초와 막대를 보이고, 끝나면 시계를 멈춘다', async ($, on) => {
    const clock = mock.clock(on, { now: 1_800_000_000_000 })
    let answer: (v: any) => void = () => {}
    on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
    on('session.messages', () => ({ value: [{ role: 'assistant', text: ANSWER, toolUses: [] }] }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('model.complete', () => new Promise(r => { answer = r }))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    const run = $.command.run({ command: 'draw', args: '' } as any)
    await clock.advance(3000)

    const ui = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /그리는 중… 3초/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^█+░+$/ })).toBeDefined()
    await ui.unmount()

    answer({ value: { isAnswered: true, text: REPLY, usage: USAGE } })
    await run
    await clock.advance(5000)
    const done = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...PANE })
    expect(await done.find({ type: 'Text', text: /그리는 중/ })).toBeUndefined()
    await done.unmount()

    // 앞 실행의 시계가 남아 있으면 다음 실행의 초가 두 배로 오른다
    const again = $.command.run({ command: 'draw', args: '' } as any)
    await clock.advance(2000)
    const next = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...PANE })
    expect(await next.find({ type: 'Text', text: /그리는 중… 2초/ })).toBeDefined()
    await next.unmount()
    answer({ value: { isAnswered: false, reason: 'api-error' } })
    await again
  })

  test('데스크톱 앱에서는 흐름마다 상자 줄을 Svg 하나로 그린다 (E3)', async ($, on) => {
    boot(on, REPLY)
    await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'draw', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'draw', surface: 'desktop', ...PANE })
    expect(await ui.find({ type: 'Text', text: /^1. 첫 프롬프트$/ })).toBeDefined()
    const svgs = await ui.findAll({ type: 'Svg' })
    expect(svgs).toHaveLength(2)
    expect(svgs[0]!.props.alt).toBe('1. 첫 프롬프트: prompt.submit → 규칙 붙임')
    expect(String(svgs[1]!.props.source)).toContain('>session.compact</text>')
    // 흐름마다 색이 다르다 (흐름 번호를 색 인덱스로 넘긴다)
    expect(String(svgs[1]!.props.source)).toContain(flowSvg(['x'], 60, 1).source.match(/stroke="(#[0-9a-f]{6})"/)![1]!)
    // 상자 테두리 Box 는 그리지 않는다
    expect(await ui.find({ type: 'Text', text: /^prompt\.submit$/ })).toBeUndefined()
    await ui.unmount()
  })

  test('터미널에는 Svg 가 없다', async ($, on) => {
    boot(on, REPLY)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' } as any)
    await $.command.run({ command: 'draw', args: '' } as any)
    const ui = await $.ui.mount({ plugin: 'draw', surface: 'terminal', ...PANE })
    expect(await ui.findAll({ type: 'Svg' })).toHaveLength(0)
    expect(await ui.find({ type: 'Text', text: /^prompt\.submit$/ })).toBeDefined()
    await ui.unmount()
  })
})
