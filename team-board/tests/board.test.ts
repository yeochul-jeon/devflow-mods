import { describe, expect, mock, test } from 'claude-code/testing'

import {
  applyTaskTool,
  askUserText,
  bandLayout,
  bandOrder,
  emptyBeat,
  dedupeNames,
  lastCustomTitle,
  projectDirName,
  decisionsFromAnswers,
  describeTool,
  looksLikeQuestion,
  normalize,
  progress,
  questionSummary,
  repoKey,
  routeLine,
  stripMarkdown,
  visible,
} from '../hooks/board'
import { bar, contextTone, paletteOf } from '../hooks/palette'
import { cells, clip, flowArt, parseExplain } from '../hooks/diagram'
import { ICONS, sprite } from '../hooks/pixel'
import { commandKey, isReadOnly, judge, masksIn, noteForClaude, scanOutput } from '../hooks/failure'

const NOW = 1_800_000_000_000
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const beat = (over: Record<string, unknown>) => normalize({ id: 'x', name: 'x', cwd: '/r', contextPct: 10, updatedAt: NOW, ...over } as any)

describe('diagram (ASCII 그림)', () => {
  test('한글은 2칸, 영문은 1칸', async () => {
    expect(cells('PR38 래퍼')).toBe(9)
    expect(clip('아주 긴 단계 이름입니다', 10)).toBe('아주 긴 …')
  })

  test('가로 흐름: 세 줄의 칸 수가 같아 상자가 맞물린다', async () => {
    const art = flowArt(['PR38 바로 진행', '10장은 나중'], 60)
    expect(art.length).toBe(3)
    expect(new Set(art.map(cells)).size).toBe(1)
    expect(art[1]).toBe('│ PR38 바로 진행 │ → │ 10장은 나중 │')
  })

  test('상자가 안 들어가면 칩으로, 화살표에서 줄바꿈하고 폭은 넘지 않는다', async () => {
    const steps = ['코드 검토 요청', '피드백 반영', '통합 완료']
    expect(flowArt(steps, 52).length).toBe(3) // 52칸이면 상자
    expect(flowArt(steps, 51)).toEqual(['[ 코드 검토 요청 ] → [ 피드백 반영 ]', '→ [ 통합 완료 ]'])
    const narrow = flowArt(steps, 30)
    expect(narrow[0]).toBe('[ 코드 검토 요청 ]')
    expect(narrow.slice(1).every(l => l.startsWith('→ [ '))).toBe(true)
    expect(Math.max(...narrow.map(cells))).toBeLessThanOrEqual(30)
  })

  test('JSON 은 앞뒤 군말이 있어도 읽고, 틀리면 null', async () => {
    const d = parseExplain('여기 있어요\n{"items":[{"title":"PR38 시작 시점","analogy":"숙제 순서","options":[{"label":"지금","flow":["바로 진행"],"result":"빠름"}],"link":"","suggest":"지금"}],"first":"겹침 확인"}\n끝')
    expect(d?.items[0]?.options[0]?.flow).toEqual(['바로 진행'])
    expect(d?.first).toBe('겹침 확인')
    expect(parseExplain('그냥 글입니다')).toBeNull()
    expect(parseExplain('{"items": "x"}')).toBeNull()
  })
})

describe('경로선과 픽셀', () => {
  const t = (status: string, i: number) => ({ id: String(i), subject: 's' + i, status }) as any
  test('지나온 길 ━, 지금 ◉, 남은 길 ─, 도착 ◎', async () => {
    const segs = routeLine([t('completed', 1), t('in_progress', 2), t('pending', 3)], 24)
    const line = segs.map(x => x.text).join('')
    expect(line.startsWith('●━')).toBe(true)
    expect(line).toContain('◉─')
    expect(line).toContain('○─')
    expect(line.endsWith('◎')).toBe(true)
    expect(cells(line)).toBeLessThanOrEqual(24)
  })
  test('할 일이 많으면 지금 근처만, 양 끝은 …', async () => {
    const many = Array.from({ length: 30 }, (_, i) => t(i < 15 ? 'completed' : i === 15 ? 'in_progress' : 'pending', i))
    const line = routeLine(many, 30).map(x => x.text).join('')
    expect(line.startsWith('…━')).toBe(true)
    expect(line).toContain('─…')
    expect(line).toContain('◉')
    expect(cells(line)).toBeLessThanOrEqual(30)
  })
  test('모두 끝나면 도착점도 초록', async () => {
    const segs = routeLine([t('completed', 1), t('completed', 2)], 20)
    expect(segs.at(-1)).toEqual({ text: '◎', tone: 'done' })
  })
  test('12×6 픽셀 아이콘 = 6×3 칸, 칸마다 [글자, 앞색, 뒷색]', async () => {
    const r = sprite(ICONS.asking, 0xffffff, 0x000000)
    expect([r.columns, r.rows]).toEqual([6, 3])
    const bytes = Uint8Array.from(atob(r.cells), c => c.charCodeAt(0))
    expect(bytes.length).toBe(6 * 3 * 3 * 4)
  })
})

describe('palette', () => {
  test('설정값으로 팔레트를 고르고, 모르는 값은 night', async () => {
    expect(paletteOf('theme').ask).toBe('warning')
    expect(paletteOf('nope').ask).toBe(paletteOf('night').ask)
    expect(bar(3, 4, 4)).toBe('▰▰▰▱')
    expect(contextTone(85, paletteOf('night'))).toBe(paletteOf('night').bad)
  })
})

describe('board (순수 함수)', () => {
  test('워크트리와 본 레포는 같은 키', async () => {
    expect(repoKey('/Users/me/github/order-svc')).toBe('Users-me-github-order-svc')
  })

  test('결정 요청을 알아보고 한 줄로 줄인다', async () => {
    expect(looksLikeQuestion('…PR38을 지금 시작할지 정해 주십시오.')).toBe(true)
    expect(looksLikeQuestion('테스트 12개 모두 통과했습니다.')).toBe(false)
    expect(questionSummary('1. push 여부\n설명입니다.\n5. PR38을 지금 시작할지 정해 주십시오.\n참고 사항')).toBe('5. PR38을 지금 시작할지 정해 주십시오.')
  })

  test('마크다운 기호를 걷어낸다', async () => {
    expect(stripMarkdown('**1. 요약**\n```\n# 제목\n`code`')).toBe('1. 요약\n\n제목\ncode')
  })

  test('도구 호출을 한 줄로', async () => {
    expect(describeTool('Bash', { command: 'git status --short' })).toBe('Bash git status --short')
    expect(describeTool('Edit', { file_path: '/a/b/OrderController.java' })).toBe('Edit OrderController.java')
  })

  test('AskUserQuestion 질문과 답', async () => {
    expect(askUserText({ questions: [{ question: 'push 할까요?', options: [{ label: '예' }, { label: '아니오' }] }] }))
      .toBe('1. push 할까요?\n   (예 / 아니오)')
    expect(decisionsFromAnswers({ 'push 할까요?': '예' }, NOW)).toEqual([{ at: NOW, question: 'push 할까요?', answer: '예' }])
  })

  test('할 일 목록: TaskCreate → TaskUpdate → 진행률', async () => {
    let tasks = applyTaskTool([], 'TaskCreate', { subject: 'PR38 래퍼 수정' }, { task: { id: '1', subject: 'PR38 래퍼 수정' } })!
    tasks = applyTaskTool(tasks, 'TaskCreate', { subject: 'PR11 페이지 갱신' }, { task: { id: '2', subject: 'PR11 페이지 갱신' } })!
    tasks = applyTaskTool(tasks, 'TaskUpdate', { taskId: '1', status: 'completed' }, { success: true })!
    tasks = applyTaskTool(tasks, 'TaskUpdate', { taskId: '2', status: 'in_progress' }, { success: true })!
    const p = progress(tasks)
    expect([p.done, p.total, p.current?.subject]).toEqual([1, 2, 'PR11 페이지 갱신'])
    expect(applyTaskTool(tasks, 'TaskUpdate', { taskId: '1', status: 'deleted' }, {})!.length).toBe(1)
  })

  test('TodoWrite 도 진행률로', async () => {
    const t = applyTaskTool([], 'TodoWrite', { todos: [{ content: 'a', status: 'completed' }, { content: 'b', status: 'in_progress' }] }, {})!
    expect(progress(t).done).toBe(1)
  })

  test('결정 필요가 먼저, 종료와 오래된 기록은 숨김', async () => {
    const list = visible(
      [
        beat({ id: 'a', name: 'ars1', state: 'idle' }),
        beat({ id: 'b', name: 'ars2', state: 'asking' }),
        beat({ id: 'c', name: 'ars3', state: 'ended' }),
        beat({ id: 'd', name: 'ars4', state: 'working', updatedAt: NOW - 13 * 3600_000 }),
        beat({ id: 'e', name: 'main', state: 'working' }),
      ],
      NOW,
    )
    expect(list.map(b => b.name)).toEqual(['ars2', 'main', 'ars1'])
  })

  test('닫힌 탭의 잔재는 숨기고, 같은 폴더의 살아 있는 두 세션은 둘 다 보인다', async () => {
    const list = visible(
      [
        beat({ id: 'old', name: 'main', cwd: '/r', updatedAt: NOW - 5 * 60_000 }),
        beat({ id: 'new', name: 'main', cwd: '/r', updatedAt: NOW - 10_000 }),
        beat({ id: 'a', name: 'order-svc', cwd: '/r2', updatedAt: NOW - 5_000 }),
        beat({ id: 'b', name: 'order-svc', cwd: '/r2', updatedAt: NOW - 20_000 }),
      ],
      NOW,
    )
    expect(list.map(b => b.id).sort()).toEqual(['a', 'b', 'new'])
  })
})

describe('숨은 실패', () => {
  const GRADLE = [
    '> Task :order-api:test',
    'OrderServiceTest > 취소된 주문은 환불한다() FAILED',
    '    org.opentest4j.AssertionFailedError at OrderServiceTest.kt:42',
    '12 tests completed, 1 failed',
    '> Task :order-api:test FAILED',
    'BUILD FAILED in 14s',
  ].join('\n')

  test('Gradle 출력을 tail 로 자르면 exit 0 이어도 실패로 본다', async () => {
    const a = judge('cd order-api && ./gradlew test --tests "*Order*" 2>&1 | tail -30', GRADLE, 1)!
    expect(a.level).toBe('high')
    expect(a.key).toBe('./gradlew test')
    expect(a.signs[0]).toContain('12 tests completed, 1 failed')
    expect(a.signs.some(s => s.includes('12 tests completed, 1 failed'))).toBe(true)
    expect(a.masks[0]).toContain('파이프')
    expect(noteForClaude(a)).toContain('pipefail')
  })

  test('Maven, Spring, Kotlin 컴파일 오류', async () => {
    expect(scanOutput('[ERROR] Tests run: 8, Failures: 2, Errors: 0, Skipped: 0').map(f => f.label)).toContain('실패한 테스트')
    expect(scanOutput('Tests run: 8, Failures: 0, Errors: 1, Skipped: 0')[0]!.label).toBe('실패한 테스트')
    expect(scanOutput('***************************\nAPPLICATION FAILED TO START\n***************************')[0]!.label).toBe('Spring 기동 실패')
    expect(scanOutput('e: file:///w/src/main/kotlin/Order.kt:12:5 Unresolved reference: foo')[0]!.label).toBe('컴파일 오류')
    expect(scanOutput('Caused by: java.sql.SQLSyntaxErrorException: Table not found')[0]!.label).toBe('예외 발생')
  })

  test('통과 요약과 0 건은 조용하다', async () => {
    expect(scanOutput('Tests run: 42, Failures: 0, Errors: 0, Skipped: 0\nBUILD SUCCESSFUL in 9s')).toEqual([])
    expect(scanOutput('12 tests completed, 0 failed')).toEqual([])
    expect(judge('./gradlew build', 'BUILD SUCCESSFUL in 3s', 1)).toBeNull()
  })

  test('건너뛴 테스트·실행 없음은 확인 필요(warn)이고 Claude 메모는 없다', async () => {
    const a = judge('./gradlew test --tests Nope', 'No tests found for given includes: [Nope]', 1)!
    expect(a.level).toBe('warn')
    expect(noteForClaude(a)).toBeNull()
  })

  test('로그를 읽기만 하는 명령은 판정하지 않는다', async () => {
    expect(isReadOnly('cd svc && grep -n FAILED build/test.log')).toBe(true)
    expect(isReadOnly('git log --oneline')).toBe(true)
    expect(isReadOnly('LANG=C ./gradlew test')).toBe(false)
    expect(judge('tail -50 build.log', GRADLE, 1)).toBeNull()
    expect(commandKey('cd a && LANG=C ./gradlew test --info')).toBe('./gradlew test')
    expect(masksIn('./gradlew test || true')).toHaveLength(1)
  })
})

describe('팀 창 배치 (세션 수에 따라)', () => {
  test('혼자면 한 줄, 몇 개면 두 줄 칸, 많으면 한 줄 칸, 넘치면 +k', async () => {
    expect(bandLayout(1, 150, 10).mode).toBe('solo')
    const five = bandLayout(5, 150, 10)
    expect(five).toMatchObject({ mode: 'full', shown: 5 })
    expect(five.slotW).toBeGreaterThanOrEqual(22)
    expect(bandLayout(9, 150, 10)).toMatchObject({ mode: 'full', shown: 9 }) // 두 줄로 줄바꿈
    expect(bandLayout(9, 150, 6)).toMatchObject({ mode: 'compact', shown: 9 }) // 높이가 모자라면 한 줄 칸
    const many = bandLayout(30, 150, 10)
    expect(many.mode).toBe('compact')
    expect(many.shown).toBeLessThan(30)
    expect(bandLayout(4, 80, 10)).toMatchObject({ mode: 'full', shown: 4 })
  })

  test('먼저 보일 세션: 결정 대기 > 숨은 실패 > 이 세션 > 작업중 > 대기', async () => {
    const now = 1_000_000
    const mk = (id: string, patch: object) => ({ ...emptyBeat(id, id, '/r'), updatedAt: now, ...patch })
    const fail = { at: 1, command: 'x', key: 'x', level: 'high' as const, signs: [], masks: [] }
    const order = bandOrder([
      mk('idle', {}), mk('work', { state: 'working' }), mk('me', {}), mk('fail', { fail }), mk('ask', { state: 'asking' }),
      mk('old', { updatedAt: 0 }),
    ], now, 'me').map(b => b.id)
    expect(order).toEqual(['ask', 'fail', 'me', 'work', 'idle', 'old'])
  })
})

describe('세션 이름', () => {
  test('같은 이름은 ·2, ·3 으로 구분한다', async () => {
    const out = dedupeNames([{ id: 'a', name: 'svc' }, { id: 'c', name: 'svc' }, { id: 'b', name: 'svc' }, { id: 'd', name: 'web' }])
    expect(out.map(b => b.name)).toEqual(['svc', 'svc·3', 'svc·2', 'web'])
  })
  test('대화 기록의 마지막 세션 이름, 폴더 키', async () => {
    expect(lastCustomTitle('"customTitle":"first"\n"customTitle":"api-fix"\n')).toBe('api-fix')
    expect(lastCustomTitle('')).toBe('')
    expect(projectDirName('/Users/me/work/order-svc')).toBe('-Users-me-work-order-svc')
  })
})

describe('팀 상황판', () => {
  test('진행 현황과 결정 기록을 쓰고, 띠·전체·자세히 화면에 그린다', async ($, on) => {
    const DIR = '/home/me/.claude/team-board/repo-order-svc'
    const files = new Map<string, string>()
    files.set(`${DIR}/peer.json`, JSON.stringify(
      beat({
        id: 'peer', name: 'sub-2', state: 'asking', question: '5. PR38을 지금 시작할까요?',
        tasks: [{ id: '1', subject: 'PR39 로그', status: 'completed' }, { id: '2', subject: 'PR38 래퍼', status: 'in_progress' }],
        decisions: [{ at: NOW - 60_000, question: 'push 할까요?', answer: '예, release 만' }],
      }),
    ))

    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    let asked = ''
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop(), kind: 'file' })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1 } }))
    on('command.run', { command: 'rename' }, () => ({ text: 'renamed' }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('prompt.submit', ($, e: any) => ({ text: e.text }))
    on('turn.complete', () => ({ text: '' }))
    on('tool.call', ($, e: any) => {
      if (e.tool === 'TaskCreate') return { result: { task: { id: '7', subject: e.subject } }, text: 'ok' }
      if (e.tool === 'TaskUpdate') return { result: { success: true }, text: 'ok' }
      if (e.tool === 'Bash') {
        const bad = String(e.command).includes('tail')
        return { result: { stdout: bad ? '12 tests completed, 1 failed\nBUILD FAILED in 3s' : 'BUILD SUCCESSFUL in 3s', stderr: '', interrupted: false }, text: 'ok' }
      }
      if (e.tool === 'AskUserQuestion') return { result: { questions: e.questions, answers: { 'Approval Test 범위는?': '변경 파일만' } }, text: 'ok' }
      return { result: {}, text: 'ok' }
    })
    // 다른 mod 의 띠가 아래에 있다고 치고, 함께 그려지는지 본다
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => {
      const { Text } = $.ui.resolve(e)
      return Text({ children: 'OTHER-MOD-BAND' })
    })
    const spoken: string[] = []
    on('audio.play', () => ({ value: undefined }))
    on('audio.speak', ($, e: any) => { spoken.push(e.text); return { value: { engine: 'say' } } })
    let calls = 0
    const JSON_ANSWER = JSON.stringify({
      items: [{
        title: 'PR11 을 언제 할지', analogy: '숙제를 오늘 할지 내일 할지 정하기',
        options: [
          { label: '이번 주', flow: ['PR11 바로 갱신', '문서 최신'], result: '빨리 끝나요' },
          { label: '다음 주', flow: ['지금 일 먼저', 'PR11 나중'], result: '집중할 수 있어요' },
        ],
        link: '앞서 release 만 push 하기로 함', suggest: '이번 주 (이미 진행 중)',
      }],
      first: 'PR38 과 겹치는지 확인',
    })
    on('model.complete', ($, e: any) => {
      asked = e.prompt
      calls += 1
      // 첫 번째는 형식이 틀린 답 (글로 보여주는지), 그다음부터는 JSON
      const text = calls === 1 ? '**1. PR38 착수**\n비유: 숙제 순서 정하기' : '네, 여기요:\n' + JSON_ANSWER
      return { value: { isAnswered: true, text, usage: USAGE } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    const myPath = [...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!
    const mine = () => JSON.parse(files.get(myPath)!)
    expect(mine().name).toBe('order-svc')

    // 작업 진행: 할 일 추가와 진행
    await clock.advance(2_000)
    await $.tool.call({ tool: 'TaskCreate', subject: 'JOIN 감시 규칙', description: 'x', tool_use_id: 'u1' } as any)
    await clock.advance(2_000)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress', tool_use_id: 'u2' } as any)
    await clock.advance(3_000) // 미뤄진 기록이 다음 틱에 써지는지
    expect(mine().tasks).toEqual([{ id: '7', subject: 'JOIN 감시 규칙', status: 'in_progress' }])

    // 작업 도중 결정 1: AskUserQuestion 의 답
    await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Approval Test 범위는?', header: '범위', options: [{ label: '변경 파일만' }, { label: '전체' }], multiSelect: false }], tool_use_id: 'u3' } as any)
    expect(mine().decisions.at(-1)).toMatchObject({ question: 'Approval Test 범위는?', answer: '변경 파일만' })

    // 작업 도중 결정 2: 답변 끝의 질문에 사용자가 다음 프롬프트로 답함
    await clock.advance(2_000)
    await $.turn.complete({ reason: 'answer', answer: '1. push 여부\n2. PR38 착수 시점을 정해 주십시오.', durationMs: 1, isAborted: false, turnId: 't1' } as any)
    expect(mine().state).toBe('asking')
    await clock.advance(2_000)
    await $.prompt.submit({ text: 'PR38은 10장 수정 뒤에 시작해', origin: { kind: 'composer' } } as any)
    expect(mine().decisions.at(-1)).toMatchObject({ question: '2. PR38 착수 시점을 정해 주십시오.', answer: 'PR38은 10장 수정 뒤에 시작해' })
    expect(mine().timeline.map((t: any) => t.kind)).toEqual(['ask', 'decide', 'ask', 'decide', 'prompt'])

    // 바로 답했으니 소리 없음. 결정을 20초 넘게 기다리면 한 번만 알린다.
    await clock.advance(30_000)
    expect(spoken).toEqual([])
    await $.turn.complete({ reason: 'answer', answer: 'push 를 develop 까지 할까요?', durationMs: 1, isAborted: false, turnId: 't2' } as any)
    await clock.advance(12_000)
    expect(spoken).toEqual([])
    await clock.advance(12_000)
    expect(spoken).toEqual(['order-svc 세션이 결정을 기다립니다'])
    await clock.advance(60_000)
    expect(spoken.length).toBe(1)
    // 끄면 새 질문이어도 조용
    await $.command.run({ command: 'board', args: 'sound off' } as any)
    await $.turn.complete({ reason: 'answer', answer: '테스트 범위는 어느 쪽으로 할까요?', durationMs: 1, isAborted: false, turnId: 't3' } as any)
    await clock.advance(30_000)
    expect(spoken.length).toBe(1)
    await $.command.run({ command: 'board', args: 'sound on' } as any)
    await $.prompt.submit({ text: '변경 파일만', origin: { kind: 'composer' } } as any)

    // 띠
    await clock.advance(3_000)
    const band = await $.ui.mount({
      plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 },
    } as any)
    expect(await band.find({ type: 'Text', text: /OTHER-MOD-BAND/ })).toBeDefined()
    // 기본은 HUD 창: 머리줄 + 세션 칸
    expect(await band.find({ type: 'Text', text: /◆ TEAM 2/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^ 결정 1 $/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /⚑ sub-2/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /결정!/ })).toBeDefined()
    expect(await band.find({ key: 'band-board' })).toBeDefined()
    await band.unmount()
    // 한 줄 모양
    expect((await $.command.run({ command: 'board', args: 'band line' } as any)).text).toBeTruthy()
    const line = await $.ui.mount({
      plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 },
    } as any)
    expect(await line.find({ type: 'Text', text: /TEAM 2 · 결정 1/ })).toBeDefined()
    expect(await line.find({ type: 'Text', text: /⚑ sub-2 ▰▰▱▱ 1\/2/ })).toBeDefined()
    await line.unmount()
    await $.command.run({ command: 'board', args: 'band hud' } as any)

    // 전체 보기
    await $.command.run({ command: 'board', args: '' } as any)
    const PANE = { plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any
    let pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /결정 대기 1/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /→ 예, release 만/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^●$/ })).toBeDefined() // 경로선: 끝낸 할 일
    expect(await pane.find({ type: 'Text', text: /^━+$/ })).toBeDefined() // 지나온 길
    expect(await pane.find({ type: 'Raster' })).toBeDefined() // 픽셀 아이콘
    expect(await pane.find({ type: 'Text', text: /^◉$/ })).toBeDefined() // 지금 위치
    expect(await pane.find({ type: 'Text', text: /PR38 래퍼/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /결정을 기다려요/ })).toBeDefined() // 주의 띠

    // 12살 설명 버튼: 지난 결정까지 맥락으로 넘긴다
    await pane.press({ key: 'explain-peer' })
    await clock.advance(3_000)
    expect(asked).toContain('PR38을 지금 시작할까요?')
    expect(asked).toContain('push 할까요? → 예, release 만')
    expect(await pane.find({ type: 'Text', text: /^1\. PR38 착수$/ })).toBeDefined()
    await pane.unmount()

    // 그 세션의 질문이 바뀌면 지난 설명은 보이지 않는다
    files.set(`${DIR}/peer.json`, JSON.stringify({ ...JSON.parse(files.get(`${DIR}/peer.json`)!), question: 'PR11 은 이번 주에 할까요?', updatedAt: NOW + 20_000 }))
    await clock.advance(3_000)
    pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /PR11 은 이번 주에 할까요/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^1\. PR38 착수$/ })).toBeUndefined()

    // 새 질문의 설명은 JSON 으로 받아 mod 가 ASCII 그림으로 그린다
    await pane.press({ key: 'explain-peer' })
    await clock.advance(3_000)
    expect(asked).toContain('"items"')
    expect(await pane.find({ type: 'Text', text: /│ PR11 바로 갱신 │ → │ 문서 최신 │/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /▸ 다음 주/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /앞서 release 만 push 하기로 함/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /PR38 과 겹치는지 확인/ })).toBeDefined()

    // 접기 / 펼치기
    expect(await pane.find({ key: 'toggle-peer' })).toBeDefined()
    await pane.press({ key: 'toggle-peer' })
    expect(await pane.find({ type: 'Text', text: /PR11 바로 갱신/ })).toBeUndefined()
    await pane.press({ key: 'toggle-peer' })
    expect(await pane.find({ type: 'Text', text: /PR11 바로 갱신/ })).toBeDefined()
    await pane.unmount()

    // 띠 끄기 / 켜기 (세션이 바뀌어도 기억)
    const BAND = { plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } } as any
    expect((await $.command.run({ command: 'board', args: 'band off' } as any)).text).toContain('껐어요')
    let b2 = await $.ui.mount(BAND)
    expect(await b2.find({ type: 'Text', text: /TEAM/ })).toBeUndefined()
    expect(await b2.find({ type: 'Text', text: /OTHER-MOD-BAND/ })).toBeDefined()
    await b2.unmount()
    await $.command.run({ command: 'board', args: 'band on' } as any)
    b2 = await $.ui.mount(BAND)
    expect(await b2.find({ type: 'Text', text: /TEAM/ })).toBeDefined()
    await b2.unmount()

    // 자세히: /board 이름
    const { text } = await $.command.run({ command: 'board', args: 'order' } as any)
    expect(text).toContain('팀 상황판')
    pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /✓ 완료|▷ 요청/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /JOIN 감시 규칙/ })).toBeDefined()
    // 버튼으로 전체 보기 ↔ 자세히
    await pane.press({ key: 'back' })
    expect(await pane.find({ key: 'detail-peer' })).toBeDefined()
    await pane.press({ key: 'detail-peer' })
    expect(await pane.find({ type: 'Text', text: /PR39 로그/ })).toBeDefined()
    expect(await pane.find({ key: 'back' })).toBeDefined()
    await pane.unmount()

    // 모듈이 다시 로드돼도(session.start 가 다시 와도) 같은 세션으로 이어진다
    const before = mine()
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    expect([...files.keys()].filter(k => /\/me-[0-9a-f]{8}\.json$/.test(k)).length).toBe(1)
    expect(mine().name).toBe(before.name)
    expect(mine().decisions.length).toBe(before.decisions.length)

    // /rename 을 따라가고, 다시 로드돼도 그 이름
    await $.command.run({ command: 'rename', args: 'api-fix' } as any)
    expect(mine().name).toBe('api-fix')

    // 숨은 실패: exit 0 인데 실패 출력 → Claude 메모, 띠 표시, 같은 명령 재실행으로 해제
    const ran: any = await $.tool.call({ tool: 'Bash', command: './gradlew test 2>&1 | tail -20', tool_use_id: 'b1' } as any)
    expect(ran.context?.join('\n')).toContain('exit 0 으로 끝났지만')
    expect(mine().fail).toMatchObject({ level: 'high', key: './gradlew test' })
    const fb = await $.ui.mount(BAND)
    expect(await fb.find({ type: 'Text', text: /⚠ 실패 1/ })).toBeDefined()
    expect(await fb.find({ type: 'Text', text: /⚠실패/ })).toBeDefined()
    await fb.unmount()
    expect((await $.command.run({ command: 'board', args: 'fail' } as any)).text).toContain('12 tests completed, 1 failed')
    await $.tool.call({ tool: 'Bash', command: './gradlew test --tests Order', tool_use_id: 'b2' } as any)
    expect(mine().fail).toBeNull()
    expect(mine().timeline.some((t: any) => t.kind === 'fail')).toBe(true)

    expect((await $.command.run({ command: 'board', args: 'band solo off' } as any)).text).toContain('숨겨요')
    expect((await $.command.run({ command: 'board', args: 'band solo on' } as any)).text).toContain('보여요')

    const missing = await $.command.run({ command: 'board', args: 'nobody' } as any)
    expect(missing.text).toContain('찾지 못했어요')
  })
})
