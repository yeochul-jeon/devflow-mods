import { describe, expect, mock, test } from 'claude-code/testing'

import {
  agentStrips,
  crowned,
  leadTarget,
  fitStrip,
  wrapCells,
  stampTasks,
  stepTimes,
  soundCommands,
  soundOs,
  pillBar,
  pillToneOf,
  took,
  turnTook,
  agentClearEnded,
  agentEnd,
  agentGone,
  agentPatch,
  agentStart,
  agentSummary,
  agentSync,
  applyTaskTool,
  askUserText,
  bandLayout,
  headLines,
  lineShown,
  bandOrder,
  cacheLeft,
  cacheMinutes,
  cacheText,
  cacheWarn,
  headParts,
  steStacked,
  emptyBeat,
  dedupeNames,
  lastCustomTitle,
  projectDirName,
  decisionsFromAnswers,
  describeTool,
  looksLikeQuestion,
  normalize,
  notificationTokens,
  overlaps,
  pushTouch,
  touchPath,
  sinceLastPrompt,
  sinceText,
  gitText,
  parseGitStatus,
  parseShortstat,
  askContext,
  needsVerify,
  progress,
  questionSummary,
  recentTurns,
  repoKey,
  routeLine,
  stripMarkdown,
  tasksFromPlan,
  todoStrips,
  tokensText,
  visible,
  withMe,
  waitsOnAgents,
  label,
} from '../hooks/board'
import { bar, contextTone, mix, paletteOf } from '../hooks/palette'
import { cells, clip, EXPLAIN_JSON_SPEC, flowArt, parseExplain, parseSte, STE_JSON_SPEC } from '../hooks/diagram'
import { character, characterOf, HUES, parseLook, snapHex } from '../hooks/pixel'
import { commandKey, isReadOnly, isVerify, judge, masksIn, noteForClaude, redact, scanOutput } from '../hooks/failure'

// 알약 바탕: 상태색을 카드 바탕 쪽으로 30% (위 줄 배지와 구분, T27 D2)
const chip = (tone: 'ask' | 'work') => mix(paletteOf('night')[tone], paletteOf('night').card, 0.3)

const NOW = 1_800_000_000_000
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
/** 실세션에서 받은 뒤에서 돈 보조 에이전트의 작업 알림 꼴 (2026-10-18 devflow-sub) */
const NOTIFY = (id: string, tokens: number) =>
  `<task-notification>\n<task-id>${id}</task-id>\n<tool-use-id>toolu_1</tool-use-id>\n<status>completed</status>\n<summary>Agent "x" finished</summary>\n<usage><subagent_tokens>${tokens}</subagent_tokens><tool_uses>6</tool_uses><duration_ms>48056</duration_ms></usage>\n</task-notification>`
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

  test('"왜 지금" 한 줄: 두 형식 모두 why 를 읽고, 없거나 글이 아니면 "" (옛 답 호환)', async () => {
    const item = { title: 't', decide: '정하세요.', analogy: '', options: [{ label: 'A', flow: ['x'], result: '', ste: ['A를 고르면 x.'] }] }
    expect(parseExplain(JSON.stringify({ why: ' 배포 설정이 멈춤 ', items: [item], first: '' }))?.why).toBe('배포 설정이 멈춤')
    expect(parseExplain(JSON.stringify({ items: [item], first: '' }))?.why).toBe('')
    expect(parseExplain(JSON.stringify({ why: 3, items: [item], first: '' }))?.why).toBe('')
    expect(parseSte(JSON.stringify({ why: '배포 설정이 멈춥니다.', items: [item] }))?.why).toBe('배포 설정이 멈춥니다.')
    expect(parseSte(JSON.stringify({ items: [item] }))?.why).toBe('')
    expect(EXPLAIN_JSON_SPEC).toContain('"why"')
    expect(STE_JSON_SPEC).toContain('"why"')
  })

  test('ASD-STE100 JSON: 빈 문장은 빼고, 문장 없는 항목은 버린다', async () => {
    // 예전 형식 (0.12~0.14): 평평한 문장 목록
    const s = parseSte('답:\n{"items":[{"title":"t","ste":["첫 문장", "", 3, "둘째 문장"]},{"title":"빈 항목","ste":[]}]}')
    expect(s).toEqual({ items: [{ title: 't', decide: '', options: [], suggest: '', ste: ['첫 문장', '둘째 문장'] }], why: '' })
    expect(parseSte('{"items":[{"title":"t"}]}')).toBeNull()
    expect(parseSte('그냥 글')).toBeNull()
  })

  test('ASD-STE100 규격: 선택지 첫 문장의 조사는 이름에 맞춘다 (0.15.0 ai-test V3 의 "5분 를")', async () => {
    expect(STE_JSON_SPEC).not.toContain('<label> 를')
    expect(STE_JSON_SPEC).toContain('"5분을 고르면')
  })

  test('ASD-STE100 JSON: 정할 것·선택지·제안으로 나눈 형식. 이름 없는 선택지와 빈 문장은 버린다', async () => {
    const s = parseSte(JSON.stringify({
      items: [{
        title: 't', decide: '시점을 정하세요.',
        options: [{ label: '이번 주', ste: ['이번 주를 고르면 지금 갱신합니다.', ''] }, { label: '', ste: ['이름 없음.'] }, { label: '다음 주', ste: [] }],
        suggest: '세션은 이번 주를 제안합니다.',
      }],
    }))
    expect(s).toEqual({
      items: [{
        title: 't', decide: '시점을 정하세요.',
        options: [{ label: '이번 주', ste: ['이번 주를 고르면 지금 갱신합니다.'] }],
        suggest: '세션은 이번 주를 제안합니다.', ste: [],
      }],
      why: '',
    })
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
  const words = (cells: string) => {
    const bytes = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
    return Array.from(new Uint32Array(bytes.buffer))
  }
  const base = { species: 'blob', frame: 0, hue: '#fb923c', leader: false, rows: 4, bg: '#334155', dark: '#0b1220', dim: '#7c8aa5' } as const
  test('캐릭터 8×8 픽셀 = 8×4 칸, 칸마다 [▀, 위 픽셀, 아래 픽셀] (T43)', async () => {
    const r = character({ ...base, pose: 'idle' })
    expect([r.columns, r.rows]).toEqual([8, 4])
    const w = words(r.cells)
    expect(w.length).toBe(8 * 4 * 3)
    expect(w.filter((_, i) => i % 3 === 0).every(c => c === 0x2580)).toBe(true)
    // 왕관이 없으면 맨 윗줄 칸은 모두 바탕색
    expect(w.slice(0, 24).filter((_, i) => i % 3 !== 0).every(c => c === 0x334155)).toBe(true)
  })
  test('짧은 머리용 3행: 8×6 픽셀, 몸이 맨 윗줄부터', async () => {
    const r = character({ ...base, rows: 3, pose: 'idle' })
    expect([r.columns, r.rows]).toEqual([8, 3])
    expect(words(r.cells).length).toBe(8 * 3 * 3)
    expect(words(r.cells).slice(0, 24).filter((_, i) => i % 3 === 1).some(c => c === 0xfb923c)).toBe(true)
  })
  test('부리는 세션은 왕관, 작업 중만 두 번째 프레임, 결정 대기는 실루엣', async () => {
    const top = (o: object) => words(character({ ...base, pose: 'idle', ...o }).cells).slice(0, 24)
    expect(top({ leader: true }).some(c => c === 0xfde047)).toBe(true)
    const f = (pose: 'work' | 'idle', frame: number) => character({ ...base, pose, frame }).cells
    expect(f('work', 0)).not.toBe(f('work', 1))
    expect(f('idle', 0)).toBe(f('idle', 1))
    const ask = words(character({ ...base, pose: 'ask', bg: '#fbbf24' }).cells)
    expect(ask.includes(0xfb923c)).toBe(false)
    expect(ask.includes(0x0b1220)).toBe(true)
  })
  test('타일 바탕은 Raster 가 칠하는 16단계 색으로 맞춘다', () => {
    expect(snapHex('#0f1730')).toBe('#111133')
    expect(snapHex('#334155')).toBe('#334455')
    expect(snapHex('#ffffff')).toBe('#ffffff')
  })
  test('캐릭터 고정: 같은 이름은 같은 모양, 섞기는 3종 모두 나온다', async () => {
    expect(characterOf('blob', 'api')).toEqual(characterOf('blob', 'api'))
    expect(characterOf('ghost', 'api').species).toBe('ghost')
    const names = Array.from({ length: 30 }, (_, i) => `sub-${i}`)
    expect(new Set(names.map(n => characterOf('mix', n).species)).size).toBe(3)
    expect(HUES).toContain(characterOf('mix', 'api').hue)
  })
})

describe('자세히 할 일 띠 (T25)', () => {
  test('끝남 초록, 지금 단계는 상태에 따라 진행 중·질문 대기·멈춤, 막힘 빨강, 남은 단계는 끝 글 없음', async () => {
    const tasks = [
      { id: '1', subject: '읽기', status: 'completed' },
      { id: '2', subject: '고치기', status: 'in_progress' },
      { id: '3', subject: '막힘: 배포 승인', status: 'pending' },
      { id: '4', subject: '확인', status: 'pending' },
    ] as any
    expect(todoStrips(tasks, 'working')).toEqual([
      { n: 1, label: '읽기', end: '끝남', tone: 'ok' },
      { n: 2, label: '고치기', end: '진행 중', tone: 'run' },
      { n: 3, label: '배포 승인', end: '막힘', tone: 'err' },
      { n: 4, label: '확인', end: '', tone: 'todo' },
    ])
    expect(todoStrips(tasks, 'asking')[1]).toMatchObject({ end: '질문 대기', tone: 'ask' })
    // 중단·오류로 끝난 턴 (work-plan 0.4.1 은 남은 단계를 그대로 둔다)
    expect(todoStrips(tasks, 'idle')[1]).toMatchObject({ end: '멈춤', tone: 'stop' })
    // 끝난 계획은 다음 턴이 일하는 동안에도 멈춤 (T27)
    expect(todoStrips(tasks, 'working', true)[1]).toMatchObject({ end: '멈춤', tone: 'stop' })
  })

  test('단계마다 걸린 시간 (T25 B): 보고 시각으로 끝난 시각을 붙이고 앞 단계 끝부터 잰다', async () => {
    const t = (subject: string, status: string) => ({ id: subject, subject, status }) as any
    const T0 = 1_000_000
    // 첫 보고: 새 계획
    let s = stampTasks([], undefined, [t('읽기', 'in_progress'), t('고치기', 'pending'), t('확인', 'pending')], T0)
    expect(s.planStartAt).toBe(T0)
    expect(s.tasks.every(x => x.doneAt === undefined)).toBe(true)
    // 72초 뒤 읽기 끝 (doing 보고 없이 고치기는 건너뛰고 한 번에 둘 끝남은 아래)
    s = stampTasks(s.tasks, s.planStartAt, [t('읽기', 'completed'), t('고치기', 'in_progress'), t('확인', 'pending')], T0 + 72_000)
    expect(s.tasks[0]!.doneAt).toBe(T0 + 72_000)
    // 같은 계획을 다시 받아도(세션 시작·턴 끝) 끝난 시각은 그대로
    s = stampTasks(s.tasks, s.planStartAt, [t('읽기', 'completed'), t('고치기', 'in_progress'), t('확인', 'pending')], T0 + 90_000)
    expect(s.tasks[0]!.doneAt).toBe(T0 + 72_000)
    expect(stepTimes(s.tasks, s.planStartAt, T0 + 256_000)).toEqual(['1분 12초', '3분 4초', ''])
    // 고치기와 확인이 한 보고에 함께 끝남: 뒤 것은 모름
    s = stampTasks(s.tasks, s.planStartAt, [t('읽기', 'completed'), t('고치기', 'completed'), t('확인', 'completed')], T0 + 300_000)
    expect(stepTimes(s.tasks, s.planStartAt, T0 + 400_000)).toEqual(['1분 12초', '3분 48초', ''])
    // 이름이 하나도 겹치지 않으면 새 계획: 시작 시각과 끝난 시각을 새로
    const n = stampTasks(s.tasks, s.planStartAt, [t('배포', 'completed')], T0 + 500_000)
    expect(n.planStartAt).toBe(T0 + 500_000)
    expect(n.tasks[0]!.doneAt).toBe(T0 + 500_000)
    // 끝난 계획 뒤의 새 보고는 같은 이름 단계가 있어도 새 계획
    const again = stampTasks(s.tasks, s.planStartAt, [t('README 읽기', 'in_progress'), t('확인', 'pending')], T0 + 600_000, true)
    expect(again.planStartAt).toBe(T0 + 600_000)
    expect(again.tasks.every(x => x.doneAt === undefined)).toBe(true)
    // 시각이 없는 목록(옛 파일·할 일 도구)은 시간 없음
    expect(stepTimes([t('a', 'completed')], undefined, T0)).toEqual([''])
  })

  test('할 일 띠의 시간은 끝남·진행 중에만 붙는다', async () => {
    const T0 = 1_000_000
    const tasks = [
      { id: '1', subject: '읽기', status: 'completed', doneAt: T0 + 12_000 },
      { id: '2', subject: '고치기', status: 'in_progress' },
      { id: '3', subject: '확인', status: 'pending' },
    ] as any
    const run = todoStrips(tasks, 'working', false, { planStartAt: T0, now: T0 + 42_000 })
    expect(run.map(r => r.time)).toEqual(['12초', '30초', undefined])
    // 멈춤·질문 대기에는 시간을 붙이지 않는다
    expect(todoStrips(tasks, 'idle', false, { planStartAt: T0, now: T0 + 42_000 })[1]!.time).toBeUndefined()
    expect(todoStrips(tasks, 'asking', false, { planStartAt: T0, now: T0 + 42_000 })[1]!.time).toBeUndefined()
  })

  test('막대 알약 색 (T25): 작업 중이 아닌데 진행 중 단계가 남으면 멈춤. 결정·실패가 먼저', async () => {
    const doing = [{ id: '1', subject: '읽기', status: 'completed' }, { id: '2', subject: '고치기', status: 'in_progress' }] as any
    const done = [{ id: '1', subject: '읽기', status: 'completed' }] as any
    expect(pillToneOf({ state: 'working', tasks: doing, fail: null } as any, false)).toBe('run')
    expect(pillToneOf({ state: 'working', tasks: doing, fail: null, planEnded: true } as any, false)).toBe('stop') // T27
    // 자기 칸은 끝난 계획 표시도 바로 덮는다 (3초 늦게 파랗게 보이지 않게)
    expect(withMe([{ id: 'me', planEnded: false } as any], { id: 'me', planEnded: true } as any)[0]!.planEnded).toBe(true)
    expect(pillToneOf({ state: 'idle', tasks: doing, fail: null } as any, false)).toBe('stop')
    expect(pillToneOf({ state: 'idle', tasks: done, fail: null } as any, false)).toBe('run')
    expect(pillToneOf({ state: 'asking', tasks: doing, fail: null } as any, false)).toBe('ask')
    expect(pillToneOf({ state: 'idle', tasks: doing, fail: { level: 'high' } } as any, false)).toBe('err')
    expect(pillToneOf({ state: 'asking', tasks: doing, fail: null } as any, true)).toBe('stop') // 오래된 결정 대기는 멈춤으로
    const pb = pillBar(doing, 40, 'stop')!
    expect(pb.pill).toBe(' 멈춤: 고치기 ')
    expect(pb.tone).toBe('stop')
  })

  test('끝난 계획에 진행 중 단계 없이 남은 단계만 있어도 멈춤 (단계를 끝내고 다음을 시작하기 전에 중단)', async () => {
    const left = [{ id: '1', subject: '읽기', status: 'completed' }, { id: '2', subject: '고치기', status: 'pending' }, { id: '3', subject: '확인', status: 'pending' }] as any
    expect(pillToneOf({ state: 'idle', tasks: left, fail: null, planEnded: true } as any, false)).toBe('stop')
    expect(pillToneOf({ state: 'working', tasks: left, fail: null, planEnded: true } as any, false)).toBe('stop')
    // 끝나지 않은 계획(TodoWrite 등)의 남은 단계는 그대로 작업색
    expect(pillToneOf({ state: 'idle', tasks: left, fail: null, planEnded: false } as any, false)).toBe('run')
    const pb = pillBar(left, 40, 'stop')!
    expect(pb.pill).toBe(' 멈춤: 고치기 ')
    expect(todoStrips(left, 'idle', true).map(r => r.end)).toEqual(['끝남', '멈춤', ''])
    expect(todoStrips(left, 'idle', false).map(r => r.end)).toEqual(['끝남', '', ''])
    const blocked = [left[0], { id: '2', subject: '막힘: 배포 승인', status: 'pending' }] as any
    expect(todoStrips(blocked, 'idle', true)[1]).toMatchObject({ end: '막힘', tone: 'err' })
  })
})

describe('알약 막대 (T24 B안)', () => {
  const t = (status: string, i: number, subject = 's' + i) => ({ id: String(i), subject, status }) as any
  const five = (doneN: number) => Array.from({ length: 5 }, (_, i) => t(i < doneN ? 'completed' : i === doneN ? 'in_progress' : 'pending', i, i === doneN ? '테스트 실행' : 's' + i))
  const line = (b: any) => b.cap + b.fill + b.pill + b.rest

  test('경계 ▏ 뒤 채움 선 끝에 지금 단계 알약, 남은 구간은 ╌ 와 눈금 │, 폭을 넘지 않는다', async () => {
    const b = pillBar(five(2), 40, 'run')!
    expect(b.pill).toBe(' 테스트 실행 ')
    expect(b.pct).toBe(40)
    expect(b.tone).toBe('run')
    expect(b.cap).toBe('▏')
    expect(b.fill).toMatch(/^━+$/)
    expect(b.rest).toMatch(/^[╌│]+$/)
    expect(b.rest).toContain('│')
    expect(cells(line(b))).toBe(40)
    // 채움 비율은 알약을 뺀 칸 기준
    expect(b.fill.length).toBe(Math.round(0.4 * (40 - 1 - cells(b.pill))))
  })

  test('상태별 알약 글: 결정 ?, 실패 ✕, 다 끝나면 ✓ 걸린 시간(없으면 도착)', async () => {
    expect(pillBar(five(1), 40, 'ask')!.pill).toBe(' ? 테스트 실행 ')
    expect(pillBar(five(1), 40, 'err')!.pill).toBe(' ✕ 테스트 실행 ')
    const all = five(5)
    const ok = pillBar(all, 40, 'run', '3분 12초')!
    expect(ok.tone).toBe('ok')
    expect(ok.pill).toBe(' ✓ 3분 12초 ')
    expect(ok.rest).toBe('')
    expect(ok.pct).toBe(100)
    expect(pillBar(all, 40, 'run')!.pill).toBe(' ✓ 도착 ')
    // 다 끝난 계획의 결정 대기는 초록 ✓ 가 아니라 노란 '질문 대기' (일을 멈추고 묻는 세션과 구별)
    const asked = pillBar(all, 40, 'ask', '3분 12초')!
    expect(asked.tone).toBe('ask')
    expect(asked.pill).toBe(' ? 질문 대기 ')
    expect(asked.pct).toBe(100)
  })

  test('doing 이 없으면 첫 남은 단계를 알약에, 긴 제목은 폭의 절반으로 자른다, 좁거나 빈 목록은 null', async () => {
    expect(pillBar([t('completed', 1), t('pending', 2, '배포')], 30, 'run')!.pill).toBe(' 배포 ')
    const long = pillBar([t('in_progress', 1, '아주 긴 단계 이름이 여기 들어갑니다 정말로 깁니다')], 30, 'run')!
    expect(cells(long.pill)).toBeLessThanOrEqual(15)
    expect(long.pill).toContain('…')
    expect(cells(line(long))).toBe(30)
    expect(pillBar([], 40, 'run')).toBeNull()
    expect(pillBar(five(1), 11, 'run')).toBeNull()
  })

  test('걸린 시간: 마지막 요청에서 턴 끝까지, 끝나지 않았으면 빈 글', async () => {
    expect(took(12_400)).toBe('12초')
    expect(took(192_000)).toBe('3분 12초')
    const ev = (kind: string, at: number) => ({ kind, at, text: '' }) as any
    expect(turnTook([ev('prompt', NOW), ev('done', NOW + 192_000)])).toBe('3분 12초')
    expect(turnTook([ev('prompt', NOW), ev('done', NOW + 5_000), ev('prompt', NOW + 9_000)])).toBe('5초')
    expect(turnTook([ev('prompt', NOW)])).toBe('')
    // 요청 없이 끝난 턴(`!` 명령에 답한 턴)은 세지 않는다
    expect(turnTook([ev('prompt', NOW), ev('done', NOW + 26_000), ev('done', NOW + 57_000)])).toBe('26초')
  })

  test('보조 줄을 폭에 맞춘다: 시간은 남기고 이름·모델·도구를 덜어 낸다 (좁은 도킹 창)', async () => {
    const r = { n: 1, label: '주문 API 호출처 찾기', model: 'haiku 5.5', tool: 'Grep', time: '2분 36초' }
    const wide = fitStrip(r, 80)
    expect(wide).toEqual({ label: r.label, model: r.model, tool: 'Grep' })
    const line = (f: ReturnType<typeof fitStrip>) => `↳ 1 ${f.label}${f.model ? ` (${f.model})` : ''}${f.tool ? `  ${f.tool}` : ''}  ${r.time}`
    for (const w of [36, 30, 24]) {
      const f = fitStrip(r, w)
      expect(f.model).toBe('')
      expect(f.tool).toBe('Grep')
      expect(cells(line(f))).toBeLessThanOrEqual(w)
    }
    // 긴 도구 글은 이름과 나눠 쓴다
    const long = fitStrip({ ...r, tool: 'Bash ./gradlew test --tests OrderServiceTest' }, 36)
    expect(long.tool.endsWith('…')).toBe(true)
    expect(cells(line(long))).toBeLessThanOrEqual(36)
  })

  test('결정할 것 줄 접기 (T32): 칸 폭에 맞추고 둘째 줄부터 2칸 내어 쓴다', async () => {
    const line = '- 캐시 후보 조사(CACHE_NOTES.md, 09-18): 주문 조회 밖의 후보 29개를 살펴봤고, 새로 붙일 것은 0건으로 정했습니다.'
    for (const w of [82, 40, 32, 20]) {
      const parts = wrapCells(line, w)
      expect(parts.length).toBeGreaterThan(1)
      for (const p of parts) expect(cells(p)).toBeLessThanOrEqual(w)
      for (const p of parts.slice(1)) expect(p).toMatch(/^  \S/)
      // 글자는 빠지지 않는다. 줄보다 긴 낱말이 없으면 띄어쓰기에서만 끊어 이어 붙이면 원문 그대로
      expect(parts.join('').replace(/ /g, '')).toBe(line.replace(/ /g, ''))
      if (w >= 32) expect(parts.map(p => p.trim()).join(' ')).toBe(line)
    }
    expect(wrapCells('짧은 줄', 40)).toEqual(['짧은 줄'])
    // 들여쓴 원문은 첫 줄 들여쓰기를 지킨다
    expect(wrapCells('  - 하위 항목', 40)).toEqual(['  - 하위 항목'])
    // 띄어쓰기 없는 긴 낱말은 글자 단위로 자른다
    const long = wrapCells('가'.repeat(30), 20)
    expect(long).toEqual(['가'.repeat(10), '  ' + '가'.repeat(9), '  ' + '가'.repeat(9), '  ' + '가'.repeat(2)])
  })

  test('보조 줄: 도는 것 먼저, 넘치면 마지막 줄을 +k 요약으로', async () => {
    const a = (id: string, status: string, startedAt: number, endedAt: number | null, tool = '') => ({ id, desc: 'd' + id, type: 'Explore', model: 'haiku', status, tool, startedAt, endedAt, tokens: 0 }) as any
    const list = [a('1', 'done', NOW, NOW + 6_000), a('2', 'working', NOW, null, 'Grep'), a('3', 'failed', NOW, NOW + 3_000), a('4', 'done', NOW, NOW + 4_000)]
    const rows = agentStrips(list, NOW + 12_000)
    expect(rows[0]).toEqual({ n: 2, label: 'd2', model: 'haiku', tool: 'Grep', time: '12초', status: 'working' })
    expect(rows[1]).toMatchObject({ n: 1, time: '6초', tool: '' })
    expect(rows[2]).toEqual({ more: 2, done: 2 })
    expect(agentStrips(list.slice(0, 3), NOW + 12_000)).toHaveLength(3)
    expect(agentStrips(list.slice(0, 3), NOW + 12_000)[2]).toMatchObject({ n: 3, tool: '실패' })
  })
})

describe('알림 소리 (T24, 모든 터미널)', () => {
  test('어디서 울릴지: 드라이브 문자면 Windows, uname 이 Darwin 이면 macOS, 나머지는 Linux', async () => {
    expect(soundOs('C:\\Users\\me\\.claude\\plugins\\team-board', '')).toBe('windows')
    expect(soundOs('/Users/me/.claude/plugins/team-board', 'Darwin\n')).toBe('mac')
    expect(soundOs('/home/me/.claude/plugins/team-board', 'Linux\n')).toBe('linux')
  })
  test('명령 후보: macOS 는 없음(엔진 플레이어), Linux 는 paplay → aplay, Windows 는 경로를 환경 변수로 PowerShell 에', async () => {
    expect(soundCommands('mac', '/r/sounds/chime.wav')).toEqual([])
    expect(soundCommands('linux', '/r/sounds/chime.wav').map(c => c.argv)).toEqual([['paplay', '/r/sounds/chime.wav'], ['aplay', '-q', '/r/sounds/chime.wav']])
    const [win] = soundCommands('windows', "C:/Users/O'Brien/team-board/sounds/chime.wav")
    expect(win!.argv[0]).toBe('powershell')
    expect(win!.argv.join(' ')).not.toContain("O'Brien")
    expect(win!.env).toEqual({ TEAM_BOARD_WAV: "C:\\Users\\O'Brien\\team-board\\sounds\\chime.wav" })
  })
  test('Linux: /board sound test 는 paplay 가 안 되면 aplay 로, 음성은 내지 않는다', async ($, on) => {
    const runs: string[][] = []
    let spoke = 0
    mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/repo/a' }))
    on('session.repo', () => ({ value: { root: '/repo/a', remote: null, internal: false, name: 'a' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', () => ({ value: undefined }))
    on('fs.list', () => ({ value: [] }))
    on('fs.read', () => ({ value: '' }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('process.run', ($, e: any) => {
      runs.push(e.argv)
      return { value: { stdout: e.argv[0] === 'uname' ? 'Linux\n' : '', stderr: '', exitCode: e.argv[0] === 'aplay' ? 0 : 1, isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('audio.play', () => ({ value: undefined }))
    on('audio.speak', () => { spoke += 1; return { value: { via: 'system' as const } } })
    on('ui.notify', () => ({ value: { isSent: false, reason: 'no-channel' } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/a' } as any)
    runs.length = 0
    // OS 알림이 나가지 않으면 이유와 켜는 법을 그대로 보인다 (T34 A2: Orca·Warp 기본 설정은 no-channel)
    const tested = await $.command.run({ command: 'board', args: 'sound test' } as any)
    expect(tested.text).toContain('OS 알림: 안 나감 (no-channel)')
    expect(tested.text).toContain('preferredNotifChannel')
    expect(runs.map(a => a[0])).toEqual(['uname', 'paplay', 'aplay'])
    expect(runs[1]![1]).toMatch(/\/sounds\/chime\.wav$/)
    expect(spoke).toBe(0)
    // 두 번째부터는 uname 을 다시 묻지 않는다
    runs.length = 0
    await $.command.run({ command: 'board', args: 'sound test' } as any)
    expect(runs.map(a => a[0])).toEqual(['paplay', 'aplay'])
  })
})

describe('palette', () => {
  test('설정값으로 팔레트를 고르고, 모르는 값은 night', async () => {
    expect(paletteOf('theme').ask).toBe('warning')
    expect(paletteOf('nope').ask).toBe(paletteOf('night').ask)
    expect(bar(3, 4, 4)).toBe('▰▰▰▱')
    expect(contextTone(85, paletteOf('night'))).toBe(paletteOf('night').bad)
  })
  test('theme 팔레트의 색은 모두 Claude Code 테마 색 이름 (없는 이름은 엉뚱한 색으로 그려진다)', async () => {
    const KEYS = ['text', 'inverseText', 'inactive', 'subtle', 'suggestion', 'remember', 'success', 'error', 'warning', 'merged', 'claude', 'permission', 'planMode', 'autoAccept', 'promptBorder', 'bashBorder', 'ide']
    const { card, isRaw, ...colors } = paletteOf('theme')
    expect(card).toBe('')
    expect(Object.values(colors).filter(c => !KEYS.includes(c))).toEqual([])
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

  test('묻는 줄이 대상 없이 일반적이면 그 앞의 번호 항목 제목으로 줄인다', async () => {
    const q = [
      '1. 캐시 만료 시간',
      '   - 5분: 주문 상태 변경이 빨리 반영됨',
      '   - 추천: 5분.',
      '2. 배포 시점',
      '   - 내일 오전: 팀 전원이 근무 중',
      '',
      '어느 쪽으로 할까요?',
    ].join('\n')
    expect(questionSummary(q)).toBe('캐시 만료 시간 · 배포 시점')
    // 제목은 : 앞까지. 선택지만 번호로 나열해도 무엇 중에서 고르는지 보인다
    expect(questionSummary('1. 5분: 빠르게 반영\n2. 1시간: 부하가 적음\n어떻게 진행할까요?')).toBe('5분 · 1시간')
    expect(questionSummary('1) 온라인 마이그레이션\n2) 점검 시간 마이그레이션\n결정해 주세요.')).toBe('온라인 마이그레이션 · 점검 시간 마이그레이션')
    // 대상이 있는 질문, 앞에 번호 항목이 없는 질문, 들여쓴 번호는 그대로
    // 글머리표는 뗀다 (T32)
    expect(questionSummary('조사했습니다.\n- 캐시 만료를 5분으로 할까요?')).toBe('캐시 만료를 5분으로 할까요?')
    expect(questionSummary('* 배포는 오늘 할까요?')).toBe('배포는 오늘 할까요?')
    expect(questionSummary('• 배포는 오늘 할까요?')).toBe('배포는 오늘 할까요?')
    expect(questionSummary('1번은 5분으로 정했습니다.\n2번 배포 시점이 남았습니다.\n배포는 어느 쪽으로 할까요?')).toBe('배포는 어느 쪽으로 할까요?')
    expect(questionSummary('검토를 마쳤습니다.\n어느 쪽으로 할까요?')).toBe('어느 쪽으로 할까요?')
    expect(questionSummary('캐시 만료\n   1. 5분\n   2. 1시간\n어느 쪽으로 할까요?')).toBe('어느 쪽으로 할까요?')
  })

  test('끝 1500자의 줄마다 본다. 조건문·확인 부탁·? 로 끝나는 제목은 결정 요청이 아니다', async () => {
    expect(looksLikeQuestion('1. push 여부\n2. PR38 착수 시점을 정해 주십시오.')).toBe(true)
    expect(looksLikeQuestion('어느 쪽으로 할까요?\n\n1. A안: 캐시를 둔다\n2. B안: 인덱스를 둔다\n3. C안: 둘 다')).toBe(true)
    expect(looksLikeQuestion('어떤 DB 를 쓰는지 알려 주세요.')).toBe(true)
    expect(looksLikeQuestion('문제가 있으면 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('## 왜 캐시가 필요할까?\n\n조회가 느려서 캐시를 넣었습니다.\n만료는 5분으로 두었습니다.\n\n적용했습니다.')).toBe(false)
    expect(looksLikeQuestion('결과를 확인해 주세요.')).toBe(false)
    expect(questionSummary('어느 쪽으로 할까요?\n1. A안\n2. B안')).toBe('어느 쪽으로 할까요?')
  })

  test('질문 뒤에 선택지·추천·표·코드 블록·부연이 와도 잡고, 코드 블록 안과 ? 로 끝나는 제목은 뺀다', async () => {
    const body = '변경 사항을 적용했습니다. 테스트 28개가 통과했습니다.\n\n'
    const asks = [
      '어느 쪽으로 할까요?\n\n- A: 빠름\n- B: 안전\n\n제 추천은 A입니다.',
      '어느 쪽으로 할까요?\n\n1. A안\n   캐시를 둔다\n2. B안\n   인덱스를 둔다',
      '어느 쪽으로 할까요?\n\n1) A안\n2) B안\n3) C안',
      '어느 쪽으로 할까요?\n\n**A안**: 캐시\n**B안**: 인덱스\n**C안**: 둘 다',
      '어느 쪽으로 할까요?\n\n• A안\n• B안\n• C안',
      '이렇게 바꿀까요?\n\n```ts\nconst a = 1\nconst b = 2\n```',
      '어느 쪽으로 할까요?\n\n| 안 | 장점 |\n|---|---|\n| A | 빠름 |\n| B | 안전 |',
      '진행할까요?\n\n참고로 테스트는 모두 통과했습니다.\n변경 파일은 3개입니다.',
      '확인할 것:\n- 캐시 만료는 5분이 맞나요?\n- 키 이름은 괜찮나요?',
    ]
    expect(asks.filter(t => !looksLikeQuestion(body + t))).toEqual([])
    expect(looksLikeQuestion(body + '## 다음 단계는?\n\n없습니다.')).toBe(false)
    expect(looksLikeQuestion(body + '```ts\nconst x = a ?\n  b : c\n```')).toBe(false)
  })

  test('"…면/경우 (한 낱말) 알려 주세요" 는 맺음 인사라 결정 요청이 아니다', async () => {
    expect(looksLikeQuestion('궁금한 점이 있으면 언제든 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('문제가 있으면 바로 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('문제가 있을 경우 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('어떤 DB 를 쓰는지 알려 주세요.')).toBe(true)
    expect(looksLikeQuestion('가능하면 어떤 DB 를 쓰는지 알려 주세요.')).toBe(true)
    expect(questionSummary('어느 쪽으로 할까요?\n1. A\n2. B\n궁금한 점이 있으면 언제든 알려 주세요.')).toBe('어느 쪽으로 할까요?')
  })

  test('"필요하면 (세 낱말까지) 알려 주세요" 도 맺음말이다 (0.15.0 ai-test V8)', async () => {
    expect(looksLikeQuestion('설정 변경이나 배포 체크리스트 작성이 필요하면 해당 저장소 경로를 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('필요하면 해당 저장소 경로를 알려 주세요.')).toBe(false)
  })

  test('조건문은 문제·필요·궁금함만 뺀다. "되면/괜찮으시면 알려 주세요" 는 허락을 묻는 결정 요청이다', async () => {
    expect(looksLikeQuestion('진행해도 되면 알려 주세요.')).toBe(true)
    expect(looksLikeQuestion('괜찮으시면 알려 주세요, 바로 적용하겠습니다.')).toBe(true)
    expect(looksLikeQuestion('원하시는 방식을 고르시면 알려 주세요.')).toBe(true)
    expect(looksLikeQuestion('문제가 있으면 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('문제가 있으시면 바로 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('필요하시면 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('궁금한 점이 있으면 언제든 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('문제가 있을 경우 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('문제가 있으면 알려 주세요. 궁금한 점이 있으면 알려 주세요.')).toBe(false)
  })

  test('"뜻이었다면/다르면/아니라면 알려 주세요" 와 도움 제안 인사는 결정 요청이 아니다', async () => {
    expect(looksLikeQuestion('다른 뜻이었다면 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('제가 잘못 이해했다면 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('의도와 다르면 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('이 방향이 아니라면 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('안녕하세요. 무엇을 도와드릴까요?')).toBe(false)
    expect(looksLikeQuestion('어떤 작업을 도와드릴까요?')).toBe(false)
    expect(looksLikeQuestion('어느 작업부터 할까요?')).toBe(true)
    expect(looksLikeQuestion('진행해도 되면 알려 주세요.')).toBe(true)
  })

  test('결과·끝남·보이는 것을 알려 달라는 부탁은 결정 요청이 아니다 (2026-10-20 시험 F4)', async () => {
    expect(looksLikeQuestion('두 결과를 함께 알려 주세요. 스크린샷이면 더 좋습니다.')).toBe(false)
    expect(looksLikeQuestion('시험 결과를 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('실행이 끝나면 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('이상한 동작이 보이면 해당 탭의 화면을 알려 주세요.')).toBe(false)
    expect(looksLikeQuestion('재시작 뒤 띠가 어떻게 됐는지 알려 주세요.')).toBe(false)
    // 결과를 보고 고르는 것, 할지 말지는 결정이다
    expect(looksLikeQuestion('결과를 보고 진행할지 알려 주세요.')).toBe(true)
    expect(looksLikeQuestion('커밋할지 알려 주세요.')).toBe(true)
    expect(looksLikeQuestion('어떻게 할지 알려 주세요.')).toBe(true)
  })

  test('한국어 의문 어미 + ? 뒤에 문장이 이어져도 결정 요청이다 (T5 S4 준비 턴). URL·영어 중간의 ? 는 아니다', async () => {
    expect(looksLikeQuestion('파일을 몇 개 만들까요? 답을 받을 때까지 기다리겠습니다.')).toBe(true)
    expect(looksLikeQuestion('이대로 진행해도 되나요? 확인되면 바로 적용합니다.')).toBe(true)
    expect(looksLikeQuestion('A안이 괜찮은가요? 아니면 B안으로 바꾸겠습니다.')).toBe(true)
    expect(looksLikeQuestion('무엇을 도와드릴까요? 편하게 말씀해 주세요.')).toBe(false)
    expect(looksLikeQuestion('검색은 https://example.com/search?q=team 으로 했습니다.')).toBe(false)
    expect(looksLikeQuestion('The flag is `a ? b : c` here.')).toBe(false)
  })

  test('직전 대화: 글 있는 행만, 같은 사람 행은 합치고, 질문 원문은 빼고, 마지막 3턴, 글마다 400자 (2026-10-16 messages() 시험 모양)', async () => {
    const u = (text: string) => ({ role: 'user' as const, text })
    const a = (text: string) => ({ role: 'assistant' as const, text })
    // 내용 블록마다 한 행: thinking·tool_use·도구 결과 행은 글이 비어 있다
    const rows = [
      u('첫 요청'), a(''), a('첫 답'),
      u('a.txt 에 hello 를 써'), a(''), u(''), a('a.txt 를 썼습니다.'),
      u('<task-notification>done</task-notification>'),
      u('b.txt 이름을 물어봐'), a('확인할게요.'), a(''), u(''), a('b1 과 b2 중 무엇으로 할까요?'),
    ]
    expect(recentTurns(rows, true, 2)).toEqual([u('a.txt 에 hello 를 써'), a('a.txt 를 썼습니다.'), u('b.txt 이름을 물어봐'), a('확인할게요.')])
    // AskUserQuestion 시점: 질문은 도구 입력에 있으므로 마지막 글을 남긴다
    expect(recentTurns(rows, false, 1)).toEqual([u('b.txt 이름을 물어봐'), a('확인할게요. b1 과 b2 중 무엇으로 할까요?')])
    expect(recentTurns(rows, true).length).toBe(6)
    expect(recentTurns([u('x'.repeat(500))], true)[0]!.text).toHaveLength(400)
    expect(recentTurns([], true)).toEqual([])
    expect(recentTurns([a('질문만')], true)).toEqual([])
  })

  test('직전 대화: 플러그인이 보낸 요청·중단 표시는 빼고, 사용자 행은 합치지 않아 답이 잘리지 않는다 (0.17.0 실세션 G5 뒤)', async () => {
    const u = (text: string) => ({ role: 'user' as const, text })
    const a = (text: string) => ({ role: 'assistant' as const, text })
    const rows = [
      u('ttl 기본값을 물어봐'), a('무엇으로 할까요?'),
      u('The team-board plugin sent a message: 팀 상황판에서 아래 결정의 HTML 설명을 요청했어. ' + '맥락 '.repeat(200)),
      u('[Request interrupted by user for tool use]'),
      u('5분으로 할게. cache.py 의 ttl 기본값을 300 으로 바꿔.'), a('300 으로 바꿨습니다.'),
      u('테스트를 물어봐'), a('어느 프레임워크로 할까요?'),
    ]
    expect(recentTurns(rows, true)).toEqual([
      u('ttl 기본값을 물어봐'), a('무엇으로 할까요?'),
      u('5분으로 할게. cache.py 의 ttl 기본값을 300 으로 바꿔.'), a('300 으로 바꿨습니다.'),
      u('테스트를 물어봐'),
    ])
    // 글 있는 assistant 행 없이 사용자 행이 이어지면 따로 둔다 (각각 한 턴)
    expect(recentTurns([u('하나'), u('둘'), a('질문')], true, 1)).toEqual([u('둘')])
  })

  test('마크다운 기호를 걷어낸다', async () => {
    expect(stripMarkdown('**1. 요약**\n```\n# 제목\n`code`')).toBe('1. 요약\n\n제목\ncode')
  })

  test('Python 식별자의 밑줄 두 개는 그대로 둔다', async () => {
    expect(stripMarkdown('if __name__ == "__main__":')).toBe('if __name__ == "__main__":')
    expect(stripMarkdown('`__init__` 를 고쳤습니다')).toBe('__init__ 를 고쳤습니다')
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

  test('work-plan 계획 → 할 일: 4종 변환, 막힘 접두어, 모르는 모양은 무시', async () => {
    const plan = (over: Record<string, unknown> = {}) => ({
      v: 1,
      steps: [
        { title: 'math.py 만들기', status: 'done' },
        { title: '테스트 쓰기', status: 'doing' },
        { title: '실행', status: 'todo' },
        { title: '배포 승인', status: 'blocked' },
      ],
      updatedAt: NOW,
      stale: false,
      ended: null,
      ...over,
    })
    expect(tasksFromPlan(plan())).toEqual({
      tasks: [
        { id: '1', subject: 'math.py 만들기', status: 'completed' },
        { id: '2', subject: '테스트 쓰기', status: 'in_progress' },
        { id: '3', subject: '실행', status: 'pending' },
        { id: '4', subject: '막힘: 배포 승인', status: 'pending' },
      ],
      step: '할 일: 테스트 쓰기',
      ended: false,
    })
    // compaction 뒤 새 보고 전
    expect(tasksFromPlan(plan({ stale: true }))!.step).toBe('할 일(압축 전): 테스트 쓰기')
    // 진행 중인 단계가 없으면 단계 줄은 비운다 (team-board 자신의 줄을 덮지 않는다)
    expect(tasksFromPlan(plan({ steps: [{ title: 'a', status: 'todo' }] }))!.step).toBe('')
    expect(tasksFromPlan({ ...plan(), steps: [] })).toEqual({ tasks: [], step: '', ended: false })
    // 모르는 모양·없음
    expect(tasksFromPlan(plan({ v: 2 }))).toBeNull()
    expect(tasksFromPlan(undefined)).toBeNull()
    expect(tasksFromPlan({ v: 1 })).toBeNull()
  })

  test('work-plan 턴 끝: 답으로 끝나면 (질문이어도) 남은 단계도 완료, 그 밖엔 그대로', async () => {
    const steps = [
      { title: 'a', status: 'done' },
      { title: 'b', status: 'doing' },
      { title: 'c', status: 'todo' },
    ]
    const ended = (reason: string) => ({ v: 1, steps, updatedAt: NOW, stale: false, ended: { reason, at: NOW } })
    const statuses = (r: ReturnType<typeof tasksFromPlan>) => r!.tasks.map(t => t.status)
    expect(statuses(tasksFromPlan(ended('answer')))).toEqual(['completed', 'completed', 'completed'])
    expect(tasksFromPlan(ended('answer'))!.step).toBe('')
    for (const reason of ['aborted', 'error', 'refusal']) {
      expect(statuses(tasksFromPlan(ended(reason)))).toEqual(['completed', 'in_progress', 'pending'])
      // 끝난 계획은 진행 중 단계가 남아도 단계 줄을 비운다 (T27)
      expect(tasksFromPlan(ended(reason))).toMatchObject({ step: '', ended: true })
    }
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

  test('턴은 끝났지만 보조 에이전트가 도는 세션은 대기가 아니라 보조 기다림이다', async () => {
    const run = { id: 's', desc: '', type: 'Explore', model: 'm', status: 'working', tool: '', startedAt: 1, endedAt: null, tokens: 0 }
    const waits = beat({ id: 'g', name: 'ars0', state: 'idle', agents: [run] })
    expect(waitsOnAgents(waits)).toBe(true)
    expect(waitsOnAgents(beat({ state: 'idle', agents: [{ ...run, status: 'done' }] }))).toBe(false)
    expect(waitsOnAgents(beat({ state: 'working', agents: [run] }))).toBe(false)
    expect(waitsOnAgents(beat({ state: 'asking', agents: [run] }))).toBe(false)
    expect(label(waits, NOW)).toBe('보조 기다림')
    expect(label(beat({ state: 'idle' }), NOW)).toBe('대기')
    const list = visible([beat({ id: 'i', name: 'a-idle', state: 'idle' }), waits, beat({ id: 'w', name: 'z-work', state: 'working' })], NOW)
    expect(list.map(b => b.name)).toEqual(['z-work', 'ars0', 'a-idle'])
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

describe('좁은 폭 (N2)', () => {
  // 카드 머리 한 줄: 배지는 줄지 않고, 오른쪽은 막대 → 몇 초 전 → 캐시(경고 아닐 때) → ctx 순으로 덜어 낸다. 좁으면 (이 세션) 대신 *
  const P = { badge: '결정 필요', name: 'devflow-sub', me: true, pct: 6, cache: '캐시 60분', cacheHot: false, ago: '40초 전' }
  test('폭마다 고르는 칸', async () => {
    const shown = (avail: number, p = P) => {
      const h = headParts(avail, p)
      return [h.me, h.bar ? 'bar' : '', h.ctx ? 'ctx' : '', h.cache ? 'cache' : '', h.ago ? 'ago' : ''].filter(Boolean).join(' ')
    }
    expect(shown(90)).toBe('(이 세션) bar ctx cache ago')
    expect(shown(64)).toBe('* bar ctx cache ago')
    expect(shown(50)).toBe('* ctx cache')
    expect(shown(40)).toBe('* ctx')
    expect(shown(30)).toBe('* ctx')
    expect(shown(26)).toBe('*') // 오른쪽을 다 덜어도 넘치면 비운다
    // 캐시가 곧 끝나면(경고) ctx 보다 오래 남긴다
    expect(shown(38, { ...P, cache: '캐시 3분', cacheHot: true })).toBe('* cache')
    expect(shown(38, { ...P, cache: '캐시 3분' })).toBe('* ctx')
    // 이 세션이 아니면 표시 없음
    expect(shown(90, { ...P, me: false })).toBe('bar ctx cache ago')
    // 고른 칸의 합이 폭을 넘지 않는다 (배지 + 이름 최소 8칸 + 표시 + 오른쪽)
    for (const w of [30, 34, 40, 44, 50, 56, 64, 72, 90]) expect(headParts(w, P).width).toBeLessThanOrEqual(w)
  })

  test('STE 선택지 이름이 상자 안쪽 폭의 40% 를 넘으면 이름을 위에 두고 글을 아래에 쓴다', async () => {
    expect(steStacked(8, 72)).toBe(false) // 8+7=15 ≤ 28.8
    expect(steStacked(8, 30)).toBe(true) // 15 > 12
    expect(steStacked(24, 72)).toBe(true) // 31 > 28.8
  })
})

describe('보조 에이전트 장부', () => {
  const start = (id: string, at = 1) => ({ id, desc: `일 ${id}`, type: 'Explore', model: 'haiku', at })

  test('시작·도구·끝을 장부에 담고 한 줄로 요약한다', async () => {
    let l = agentStart([], start('a'))
    l = agentStart(l, start('b'))
    l = agentPatch(l, 'b', a => ({ ...a, tool: 'Grep' }))
    l = agentEnd(l, 'a', true, 5)
    expect(agentSummary(l)).toBe('● 1 작업 · ✓ 1 끝 · Explore: Grep')
    l = agentEnd(l, 'b', false, 6)
    expect(agentSummary(l)).toBe('✓ 1 끝 · ✗ 1 실패')
    expect(l.find(a => a.id === 'b')).toMatchObject({ status: 'failed', tool: '', endedAt: 6 })
    expect(agentSummary([])).toBe('')
  })

  test('모르는 id 와 이미 끝난 것은 바꾸지 않는다', async () => {
    let l = agentEnd(agentStart([], start('a')), 'a', true, 5)
    expect(agentEnd(l, 'a', false, 9)[0]).toMatchObject({ status: 'done', endedAt: 5 })
    expect(agentPatch(l, 'zz', a => ({ ...a, tool: 'x' }))).toEqual(l)
  })

  test('엔진 목록으로 놓친 끝을 보정하고, 사람 프롬프트에 끝난 것을 지운다', async () => {
    let l = agentStart(agentStart(agentStart([], start('a')), start('b')), start('c'))
    l = agentSync(l, [{ id: 'a', status: 'completed' }, { id: 'b', status: 'killed' }, { id: 'c', status: 'running' }], 7)
    expect(l.map(a => a.status)).toEqual(['done', 'failed', 'working'])
    expect(agentClearEnded(l).map(a => a.id)).toEqual(['c'])
  })

  test('턴이 끝났어도 엔진이 아직 돈다(running·waiting·pending)고 하면 다시 작업 중이다: 제 백그라운드 셸을 기다리는 보조 (T15 실화면)', async () => {
    let l = agentEnd(agentEnd(agentEnd(agentStart(agentStart(agentStart([], start('a')), start('b')), start('c')), 'a', true, 5), 'b', true, 5), 'c', true, 5)
    l = agentSync(l, [{ id: 'a', status: 'waiting' }, { id: 'b', status: 'idle' }, { id: 'c', status: 'completed' }], 7)
    expect(l.map(a => `${a.id}:${a.status}:${a.endedAt}`)).toEqual(['a:working:null', 'b:done:5', 'c:done:5'])
  })

  test('엔진 목록에 없는 작업 중 에이전트는 끝(실패)으로 본다: 재시작 전 프로세스의 것', async () => {
    let l = agentEnd(agentStart(agentStart(agentStart([], start('a')), start('b')), start('c')), 'c', true, 3)
    l = agentGone(l, [{ id: 'b' }], 9)
    expect(l.map(a => `${a.id}:${a.status}:${a.endedAt}`)).toEqual(['a:failed:9', 'b:working:null', 'c:done:3'])
  })

  test('12개를 넘으면 끝난 것부터 버리고, 같은 id 는 다시 작업 중으로', async () => {
    let l = agentEnd(agentStart([], start('old')), 'old', true, 2)
    for (let i = 0; i < 12; i++) l = agentStart(l, start(`n${i}`))
    expect(l.length).toBe(12)
    expect(l.some(a => a.id === 'old')).toBe(false)
    l = agentEnd(l, 'n0', true, 3)
    l = agentStart(l, start('n0', 4))
    expect(l.find(a => a.id === 'n0')).toMatchObject({ status: 'working', endedAt: null, startedAt: 4 })
  })

  test('옛 파일에는 agents 가 없어도 빈 목록으로 읽는다', async () => {
    expect(normalize({ id: 'x', name: 'old' }).agents).toEqual([])
  })

  test('토큰을 짧게 쓴다', async () => {
    expect([tokensText(950), tokensText(41_200), tokensText(1_234_567)]).toEqual(['950', '41k', '1.2M'])
  })

  test('작업 알림에서 보조 에이전트의 토큰을 읽는다: 여러 개, 토큰 없는 알림은 빼고', () => {
    expect(notificationTokens(NOTIFY('a1', 36863) + '\n' + NOTIFY('b2', 12))).toEqual([{ id: 'a1', tokens: 36863 }, { id: 'b2', tokens: 12 }])
    expect(notificationTokens('<task-notification><task-id>sh1</task-id><status>completed</status></task-notification>')).toEqual([])
    expect(notificationTokens('그냥 글')).toEqual([])
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
    // Claude 가 "다른 명령이라 안 지워진다" 고 추측하지 않도록 지워지는 규칙을 알린다
    expect(noteForClaude(a)).toContain('같은 명령(`./gradlew test` 로 시작)이 실패 흔적 없이 다시 돌면 이 표시는 저절로 지워집니다')
  })

  test('Maven, Spring, Kotlin 컴파일 오류', async () => {
    expect(scanOutput('[ERROR] Tests run: 8, Failures: 2, Errors: 0, Skipped: 0').map(f => f.label)).toContain('실패한 테스트')
    expect(scanOutput('Tests run: 8, Failures: 0, Errors: 1, Skipped: 0')[0]!.label).toBe('실패한 테스트')
    expect(scanOutput('***************************\nAPPLICATION FAILED TO START\n***************************')[0]!.label).toBe('Spring 기동 실패')
    expect(scanOutput('e: file:///w/src/main/kotlin/Order.kt:12:5 Unresolved reference: foo')[0]!.label).toBe('컴파일 오류')
    expect(scanOutput('Caused by: java.sql.SQLSyntaxErrorException: Table not found')[0]!.label).toBe('예외 발생')
  })

  test('감지 규칙 같은 정규식 소스 코드 줄은 실패로 보지 않고, 같은 출력의 실제 실패는 잡는다 (2026-10-18 오탐)', async () => {
    // sed -n 과 claude plugin list 를 && 로 이어 failure.ts 를 출력한 경우
    const code = [
      "52:const READ_MISSING = /^(?:(?:ls|stat|cat): .*No such file or directory.*|\"[^\"\\n]*\": No such file or directory \\(os error 2\\))$/gm",
      "  { label: 'Spring 기동 실패', pattern: /APPLICATION FAILED TO START|Application run failed/, severity: 'high' },",
      "  { label: '컴파일 오류', pattern: /^e: (?:file:\\/\\/)?\\S+\\.kts?[:(]|Compilation failed/m, severity: 'high' },",
      "  { label: '실행된 테스트 없음', pattern: /No tests found for given includes|\\bno tests? (?:found|ran)\\b/i, severity: 'warn' },",
    ].join('\n')
    expect(judge('cd team-board && sed -n 1,50p hooks/failure.ts && claude plugin list', code, 1)).toBeNull()
    // 같은 규칙의 매칭이 코드 줄 뒤에 실제로 있으면 그 줄을 보인다
    const both = `${code}\nbash: foo: command not found`
    expect(scanOutput(both)).toEqual([{ label: '명령·파일 없음', severity: 'high', line: 'bash: foo: command not found' }])
    // 실제 오류 메시지는 그대로 잡는다
    expect(scanOutput("python3: can't open file '/x/run.py': [Errno 2] No such file or directory")[0]!.label).toBe('명령·파일 없음')
    expect(scanOutput('***************************\nAPPLICATION FAILED TO START\n***************************')[0]!.label).toBe('Spring 기동 실패')
  })

  test('빈 줄 뒤의 실패 줄도 흔적 줄로 그 줄을 보인다 (빈 흔적 줄이 찍혔다)', async () => {
    expect(scanOutput('ok\n\nFAIL: broken')).toEqual([{ label: 'FAIL 표시', severity: 'high', line: 'FAIL: broken' }])
    expect(scanOutput('ok\n\n  Error: bad')).toEqual([{ label: '오류 줄', severity: 'high', line: 'Error: bad' }])
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

  test('도움말·버전 출력은 판정하지 않는다 (2026-10-26 오탐: `codex exec --help` 의 `Error out when …`)', async () => {
    const help = '      --strict-config\n          Error out when config.toml contains fields that are not recognized'
    expect(judge('codex exec --help', help, 1)).toBeNull()
    expect(judge('sed -n 1,5p a.ts; codex exec --help | head -40', help, 1)).toBeNull()
    expect(judge('git --help', '   Error handling options:', 1)).toBeNull()
    expect(judge('git help commit', '   Error handling options:', 1)).toBeNull()
    expect(judge('node --version', 'Error: x', 1)).toBeNull()
    expect(isReadOnly('which codex && man git')).toBe(true)
    // 진짜 오류는 그대로 잡는다. 쌍점 없는 오류 줄도
    expect(judge('node app.js', 'Error: Cannot find module x', 1)?.signs[0]).toMatch(/^오류 줄/)
    expect(judge('ffmpeg -i a.mp4 out.jpg', 'Error opening input file a.mp4.', 1)?.signs[0]).toMatch(/^오류 줄/)
    // -h 는 넣지 않는다: 실행 명령의 인자일 수 있다
    expect(judge('npm test -- -h', 'FAIL src/a.test.ts', 1)?.level).toBe('high')
    expect(judge('codex exec --help && npm test', ' 2 fail', 1)?.level).toBe('high')
  })

  test('읽기 전용 단계가 앞에 있어도 모든 단계가 읽기 전용일 때만 제외한다', async () => {
    expect(judge('echo "== build" && ./gradlew test 2>&1 | tail -20', GRADLE, 1)?.level).toBe('high')
    expect(judge('git status; npm test | tail', '  3 passing\n  2 failing', 1)?.level).toBe('high')
    expect(judge('ls && ./gradlew test', GRADLE, 1)?.level).toBe('high')
    expect(isReadOnly('echo y | ./gradlew test')).toBe(false)
    expect(isReadOnly('ls build || ./gradlew build')).toBe(false)
    expect(isReadOnly('grep -n FAILED build/test.log | head -20')).toBe(true)
  })

  test('heredoc 본문은 단계가 아니다 (2026-10-23 오탐: 본문의 테스트 코드 줄이 명령 키가 됨)', async () => {
    expect(isReadOnly("cat <<'EOF'\nrm -rf build\n./gradlew test\nEOF")).toBe(true)
    expect(isReadOnly("cat <<-EOF\n\tnpm test\n\tEOF\ngrep -n x a.ts")).toBe(true)
    expect(commandKey("cat >> tests/a.test.ts <<'EOF'\ndescribe('x', () => {\n})\nEOF\ncd .. && ./gradlew test 2>&1 | grep fail")).toBe('./gradlew test')
    expect(commandKey("python3 - <<'EOF'\nimport os\nEOF\n./gradlew test")).toBe('python3 -')
    // 본문 뒤 명령은 그대로 판정한다
    expect(isReadOnly("cat <<'EOF'\nx\nEOF\n./gradlew test")).toBe(false)
  })

  test('{ } · ( ) 묶음은 벗기고 안쪽 명령으로 판정한다 (2026-10-23 오탐)', async () => {
    // 계획 파일을 읽은 출력 속 테스트 문자열이 「실패한 테스트」로 잡힌 명령 형태
    expect(isReadOnly('cd $R 2>/dev/null && { ls; find . -maxdepth 3 -name "*.md" | head -30; }; head -30 a.md | cut -c1-160')).toBe(true)
    expect(isReadOnly('( cd svc && grep -n FAILED build/test.log )')).toBe(true)
    expect(isReadOnly('{ ls; ./gradlew test; }')).toBe(false)
    expect(isReadOnly('(./gradlew test)')).toBe(false)
    expect(commandKey('(./gradlew test)')).toBe('./gradlew test')
    expect(commandKey('{ ./gradlew test; }')).toBe('./gradlew test')
  })

  test('반복·조건 구문은 건너뛰고 안쪽 명령으로 판정한다, 파일로 쓰는 단계는 읽기 전용이 아니다 (2026-10-18 표본)', async () => {
    // 로그 보기: 표본의 오탐
    expect(isReadOnly('D=data/logs; for f in a b; do echo "== $f"; grep -m3 ERROR $D/$f.log; done')).toBe(true)
    expect(isReadOnly('for f in a b; do [ -f $f ] && tail -5 $f; done 2>&1')).toBe(true)
    expect(isReadOnly("sed 's/\\x1b\\[[0-9;]*m//g' red.log | grep -E 'Tests run|FAIL'")).toBe(true)
    expect(isReadOnly('/bin/ls -la logs && /usr/bin/grep -n FAILED logs/x.log | fold -w 200')).toBe(true)
    expect(isReadOnly('if [ -s x.log ]; then cat x.log; fi')).toBe(true)
    // 안쪽에 실행 명령이 있으면 판정한다
    expect(isReadOnly('for m in a b; do ./gradlew :$m:test; done')).toBe(false)
    expect(isReadOnly('if ./gradlew test; then echo ok; fi')).toBe(false)
    expect(isReadOnly("sed -i '' 's/a/b/' x.ts && cat x.ts")).toBe(false)
    expect(isReadOnly('sed --in-place s/a/b/ x.ts')).toBe(false)
    // 파일로 쓰는 단계: 표본의 정탐(쓰기 실패)을 놓치지 않는다
    expect(isReadOnly('for c in a b; do git show $c:docs/x.md > /tmp/out/$c.md; done')).toBe(false)
    expect(isReadOnly('grep -n x a.log >> notes.txt')).toBe(false)
    expect(isReadOnly('grep -n x a.log 2>/dev/null; cat b.log 2>&1 >/dev/null; echo "a > b"')).toBe(true)
  })

  test('`tests 52 failures 0` 의 52 는 실패 수가 아니다', async () => {
    expect(scanOutput('tests 52 failures 0 errors 0 skipped 0')).toEqual([])
    expect(scanOutput('Tests: 3 failed, 9 passed')[0]!.label).toBe('실패한 테스트')
    expect(scanOutput('12 tests completed, 1 failed')[0]!.label).toBe('실패한 테스트')
  })

  test('따옴표 안의 | ; 는 단계 구분자가 아니다', async () => {
    expect(judge('grep -E "FAILED|ERROR" build.log', GRADLE, 1)).toBeNull()
    expect(judge("grep -n 'a;b' x", GRADLE, 1)).toBeNull()
    const a = judge('echo "a|b" && ./gradlew test', GRADLE, 1)
    expect(a?.level).toBe('high')
    expect(a?.key).toBe('./gradlew test')
  })

  test('재실행 비교 키는 읽기 전용이 아닌 첫 단계에서, run·-m·exec 이면 세 낱말', async () => {
    expect(commandKey('npm run test')).toBe('npm run test')
    expect(commandKey('npm run lint')).toBe('npm run lint')
    expect(commandKey('python -m pytest -k foo')).toBe('python -m pytest')
    expect(commandKey('pnpm exec vitest run')).toBe('pnpm exec vitest')
    expect(commandKey('echo "== build" && ./gradlew test 2>&1 | tail -20')).toBe('./gradlew test')
    expect(judge('echo "== build" && ./gradlew test 2>&1 | tail -20', GRADLE, 1)!.key).toBe('./gradlew test')
    expect(commandKey('docker compose logs --no-log-prefix app --tail 30')).toBe('')
  })

  test('파일·컨테이너 로그를 읽기만 하면 판정하지 않는다', async () => {
    expect(judge('S=/x; cd /y; sed -n 1,40p failure.ts', GRADLE, 1)).toBeNull()
    expect(judge('docker logs api', GRADLE, 1)).toBeNull()
    expect(judge('docker compose logs api --tail 50', GRADLE, 1)).toBeNull()
    expect(judge('kubectl logs pod', GRADLE, 1)).toBeNull()
  })

  test('bun 형식 요약 "N fail" 줄을 잡고, 비슷한 낱말은 지나친다', async () => {
    expect(judge('bun test', ' 26 pass\n 2 fail\nRan 28 tests across 3 files.', 1)?.level).toBe('high')
    expect(scanOutput(' 28 pass\n 0 fail')).toEqual([])
    expect(scanOutput('retry 3\nfail-safe')).toEqual([])
    expect(scanOutput('Step 2\nFail fast mode')).toEqual([])
  })

  test('Maven 테스트 건너뜀은 확인 필요(warn), -DskipTests 처럼 일부러 건너뛰면 조용하다', async () => {
    const a = judge('./mvnw test', '[INFO] Tests are skipped.\n[INFO] BUILD SUCCESS', 1)!
    expect(a.level).toBe('warn')
    expect(noteForClaude(a)).toBeNull()
    expect(judge('./mvnw package -DskipTests', '[INFO] Tests are skipped.\n[INFO] BUILD SUCCESS', 1)).toBeNull()
    expect(judge('mvn install -Dmaven.test.skip=true', '[INFO] Tests are skipped.\n[INFO] BUILD SUCCESS', 1)).toBeNull()
  })

  test('-DskipITs 로 일부러 건너뛴 통합 테스트도 조용하다', async () => {
    expect(judge('./mvnw verify -DskipITs', '[INFO] Tests are skipped.', 1)).toBeNull()
  })

  test('sort·uniq·cut, xargs grep 처럼 읽기만 하는 단계로 된 파이프는 판정하지 않는다', async () => {
    expect(judge('grep -rhoE "(pass|fail)$" logs/ | sort | uniq -c', '      3 fail', 1)).toBeNull()
    expect(judge(`find . -name '*.md' | xargs grep -n "No such file"`, 'docs/faq.md:12:`No such file or directory`', 1)).toBeNull()
    expect(judge(`find . -name '*.ts' | xargs grep -l TODO`, 'grep: ./gen/x.ts: No such file or directory', 1)).toBeNull()
    expect(judge('git log --oneline | cut -c1-60', 'abc123 fix: 3 tests failed on CI', 1)).toBeNull()
    expect(judge('grep -rn "Traceback" docs | sort', 'docs/a.md:3:Traceback (most recent call last):', 1)).toBeNull()
    expect(judge('npm test 2>&1 | tee out.log', '  3 passing\n  2 failing', 1)?.level).toBe('high')
  })

  test('|& 도 파이프로 나눈다', async () => {
    expect(judge('cat build.log |& grep FAILED', GRADLE, 1)).toBeNull()
  })

  test('따로 선 true · : 단계는 빼고 본다: 읽기 명령에 || true 를 붙여도 판정하지 않는다', async () => {
    expect(judge('grep -rn "No such file" src/ || true', "src/x.ts:12: throw new Error('No such file or directory')", 1)).toBeNull()
    expect(judge('cat build/reports/summary.txt 2>&1 || true', 'BUILD FAILED', 1)).toBeNull()
    expect(judge('cat out.txt 2>/dev/null || :', '> Task :app:test FAILED', 1)).toBeNull()
    expect(judge('grep -rn FAILED build/ ; true', 'build/log.txt:3:> Task :app:test FAILED', 1)).toBeNull()
    const a = judge('./gradlew test 2>&1 || true', GRADLE, 1)
    expect(a?.level).toBe('high')
    expect(a?.key).toBe('./gradlew test')
  })

  test('주석 줄은 단계로 보지 않는다', async () => {
    expect(commandKey('# 테스트 실행\n./gradlew test')).toBe('./gradlew test')
    // 주석 안의 ' 가 뒤의 따옴표와 짝지어 줄바꿈·파이프를 가리지 않는다
    const a = judge("# Let's see the log\n./gradlew test 2>&1 | grep -E 'FAILED'", '> Task :app:test FAILED', 1)
    expect(a?.level).toBe('high')
    expect(a?.key).toBe('./gradlew test')
    expect(commandKey("# Check what's failing\n./gradlew test 2>&1 | grep -E 'FAILED|tests completed'")).toBe('./gradlew test')
  })

  test('명령·키·흔적에 든 비밀 값은 *** 로 가린다', async () => {
    expect(redact('API_TOKEN=abc123 ./gradlew test')).toBe('API_TOKEN=*** ./gradlew test')
    expect(redact('mysql --password=hunter2 -u me')).toBe('mysql --password=*** -u me')
    expect(redact('cli login --token abc123')).toBe('cli login --token ***')
    expect(redact('curl -H "Authorization: Bearer abc.def" https://x')).toBe('curl -H "Authorization: Bearer ***" https://x')
    expect(redact('git clone https://me:pw123@github.com/a/b')).toBe('git clone https://me:***@github.com/a/b')
    expect(redact('key sk-ant-api03-AAAA_bbbb-1234 and ghp_abcdefABCDEF123456')).toBe('key *** and ***')
    expect(redact('AKIAABCDEFGHIJKLMNOP eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl')).toBe('*** ***')
    expect(redact('./gradlew test --tests OrderTest')).toBe('./gradlew test --tests OrderTest')
    const a = judge(
      "export OPENAI_API_KEY=sk-test0000000000000000000000AAAA && python3 run.py",
      'Traceback (most recent call last):\n  File "run.py", line 3\nRuntimeError: bad key sk-test0000000000000000000000AAAA',
      1,
    )!
    expect(JSON.stringify(a)).not.toContain('sk-test')
    expect(a.command).toContain('OPENAI_API_KEY=***')
    // 같은 명령을 다시 돌리면 가린 키끼리 같다
    expect(commandKey('export OPENAI_API_KEY=sk-test0000000000000000000000AAAA && python3 run.py')).toBe(a.key)
    expect(describeTool('Bash', { command: 'TOKEN=abc123 ./deploy.sh' })).toBe('Bash TOKEN=*** ./deploy.sh')
  })

  test('읽기 도구가 알린 "없음" 은 실패가 아니다 (존재 확인)', async () => {
    expect(judge('ls -la tmp-replay && rm -r tmp-replay && ls tmp-replay 2>&1; git status --short', '"tmp-replay": No such file or directory (os error 2)', 1)).toBeNull()
    expect(judge('f=$(ls -t Q_* 2>/dev/null | head -1); wc -l "$f"; sed -n 1,40p "$f"', 'wc: : open: No such file or directory', 1)).toBeNull()
    expect(judge('git log -1; grep -n x raw/a.md', 'grep: raw/a.md: No such file or directory', 1)).toBeNull()
    // 빌드·실행 도구가 낸 없음과 command not found 는 지금처럼 잡는다
    expect(judge('./run.sh', './run.sh: line 3: config.yml: No such file or directory', 1)?.level).toBe('high')
    expect(judge('npm test', 'sh: jest: command not found', 1)?.level).toBe('high')
  })

  test('Traceback 은 다음 줄에 File 이 와야 Python 예외다', async () => {
    expect(judge(`python3 -c "print('Traceback (most recent call last):')"`, 'Traceback (most recent call last):', 1)).toBeNull()
    const a = judge('python3 app.py', 'Traceback (most recent call last):\n  File "app.py", line 1, in <module>\nKeyError: x', 1)
    expect(a?.signs[0]).toBe('Python 예외: Traceback (most recent call last):')
  })

  test('ok=1 skipped=0 처럼 앞 항목의 값인 숫자는 개수로 읽지 않는다', async () => {
    expect(judge('codeviz build-global', '== summary == ok=1 skipped=0 failed=0', 1)).toBeNull()
    expect(judge('codeviz build-global', 'ok=1 failed=0', 1)).toBeNull()
    expect(judge('./gradlew test', '12 tests completed, 1 failed', 1)?.level).toBe('high')
    expect(judge('npm test', 'Tests: 2 failed, 10 passed', 1)?.level).toBe('high')
    expect(judge('bash -c run', '1 test skipped', 1)?.level).toBe('warn')
  })

  test('git rev-parse 같은 출력만 하는 git 명령과 pwd 는 읽기 전용이다', async () => {
    const cmd = `git rev-parse --short HEAD; echo "== C1"; rg -n 'or-ars-svc\\.log' docs --glob '!docs/HANDOFF.md' | cut -c1-300; pwd`
    expect(judge(cmd, 'abc1234\n== C1\ndocs/a.md:7: 실측: `Tests run: 538, Failures: 1, Errors: 0`', 1)).toBeNull()
  })

  test('git -C <경로> 뒤의 읽기 전용 git 명령도 읽기 전용이다', async () => {
    const cmd = `git -C /repo rev-parse --show-toplevel && rg -n 'Failures: 1' tests | head -3; echo done`
    expect(judge(cmd, '/repo\ntests/a.test.ts:7: Tests run: 538, Failures: 1\ndone', 1)).toBeNull()
    expect(judge('git -C /repo log -1', 'BUILD FAILED in 3s', 1)).toBeNull()
    expect(judge('git -C /repo commit -m x && ./gradlew test', 'BUILD FAILED in 3s', 1)?.level).toBe('high')
  })

  test('소문자 변수 대입 단계도 빼고 본다. $( ) 로 명령을 돌리는 대입은 남긴다', async () => {
    expect(judge('f=docs/a.md; grep -n Failures "$f"', '46: Tests run: 538, Failures: 1', 1)).toBeNull()
    expect(judge('c=$(./gradlew test 2>&1); echo "$c"', 'BUILD FAILED in 3s', 1)?.level).toBe('high')
    expect(commandKey('f=x; ./gradlew test')).toBe('./gradlew test')
  })

  test('team-board 상태 파일을 다시 출력하는 명령은 판정하지 않는다', async () => {
    expect(judge('python3 -c "import json; print(open(\'/Users/me/.claude/team-board/r/a.json\').read())"', '"signs": ["실패한 테스트: 3 tests completed, 1 failed"]', 1)).toBeNull()
  })
})

describe('팀 창 배치 (세션 수에 따라)', () => {
  test('머리줄 줄 수: 버튼을 뺀 폭에서 칩 단위로 넘어간다 (칩 사이 2칸, 한글 2칸)', async () => {
    const chips = ['◆ TEAM 8', ' 결정 1 ', ' ⚠ 실패 1 ', ' 작업 1 ', ' 대기 5 ']
    // 60칸 터미널(띠 55칸): 칩 자리 55 - 4 - 15 = 36칸 → "◆ TEAM 8 · 결정 1 · ⚠ 실패 1" 30칸 뒤 작업 1 은 다음 줄
    expect(headLines(chips, 55, 15)).toBe(2)
    expect(headLines(chips, 160, 15)).toBe(1)
    expect(headLines(['◆ TEAM 2'], 30, 15)).toBe(1)
    // 칩 하나가 자리보다 넓어도 빈 줄을 세지 않는다
    expect(headLines(['◆ TEAM 2', ' 결정 12345678901234567890 '], 40, 15)).toBe(2)
  })
  test('한 줄 모양 칩 수: 줄 수 안에 들어가는 만큼, 가린 칩이 있으면 끝이 "+k 더 · /board"', async () => {
    const chips = ['● a', '● b', '● c']
    expect(lineShown([' TEAM 3 '], chips, 100, 1)).toBe(3)
    // 폭 18칸: 한 줄에는 TEAM 과 "+k 더 · /board"(14칸)도 같이 못 들어간다 → 0, 두 줄이면 모두
    expect(lineShown([' TEAM 3 '], chips, 20, 1)).toBe(0)
    expect(lineShown([' TEAM 3 '], chips, 20, 2)).toBe(3)
    // 폭 38칸 한 줄: TEAM(8) + ● a + "+2 더 · /board" 는 들어가고 ● b 까지는 안 들어간다
    expect(lineShown([' TEAM 3 '], ['● a', '● bbbbbbbbbbbb', '● c'], 40, 1)).toBe(1)
  })
  test('혼자면 한 줄, 몇 개면 두 줄 칸, 많으면 한 줄 칸, 넘치면 +k', async () => {
    expect(bandLayout(1, 150, 10).mode).toBe('solo')
    const five = bandLayout(5, 150, 10)
    expect(five).toMatchObject({ mode: 'full', shown: 5 })
    expect(five.slotW).toBeGreaterThanOrEqual(22)
    expect(bandLayout(9, 150, 10)).toMatchObject({ mode: 'full', shown: 9 }) // 두 줄로 줄바꿈
    expect(bandLayout(9, 150, 6)).toMatchObject({ mode: 'compact', shown: 9 }) // 높이가 모자라면 한 줄 칸
    // 머리줄이 2줄이면 그만큼 칸 높이가 줄어든다 (낮은 터미널에서 띠 아래가 잘리던 것)
    expect(bandLayout(9, 150, 7)).toMatchObject({ mode: 'full', shown: 9 })
    expect(bandLayout(9, 150, 7, 2)).toMatchObject({ mode: 'compact', shown: 9 })
    const many = bandLayout(30, 150, 10)
    expect(many.mode).toBe('compact')
    expect(many.shown).toBeLessThan(30)
    expect(bandLayout(4, 80, 10)).toMatchObject({ mode: 'full', shown: 4 })
    // 한 줄 칸은 배지(6칸) + 이름이 들어가도록 20칸 이상: 'order-svc*' 가 잘리지 않는다
    expect(bandLayout(8, 76, 10)).toMatchObject({ mode: 'compact', slotW: 20, shown: 8 })
    // 20칸으로 다 안 보이면 18칸으로 줄여 모두 보인다 (칸 영역 58칸, 높이 2줄: 20칸이면 2칸씩 4자리라 +k)
    expect(bandLayout(5, 62, 5)).toMatchObject({ mode: 'compact', slotW: 18, shown: 5 })
    // 같은 폭이라도 높이가 넉넉해 20칸으로 다 들어가면 줄이지 않는다
    expect(bandLayout(5, 62, 6)).toMatchObject({ mode: 'compact', slotW: 20, shown: 5 })
    // 다 안 들어가도 18칸이 더 많이 보이면 줄인다 (20칸이면 1개 +4, 18칸이면 2개 +3)
    expect(bandLayout(5, 62, 4)).toMatchObject({ mode: 'compact', slotW: 18, shown: 2 })
    // 18칸으로 줄여도 더 보이지 않으면 줄이지 않는다 (20칸·18칸 모두 한 줄 7칸)
    expect(bandLayout(30, 150, 10)).toMatchObject({ mode: 'compact', slotW: 20, shown: 20 })
  })

  test('먼저 보일 세션: 결정 대기 > 숨은 실패 > 이 세션 > 작업중 > 보조 기다림 > 대기', async () => {
    const now = 1_000_000
    const mk = (id: string, patch: object) => ({ ...emptyBeat(id, id, '/r'), updatedAt: now, ...patch })
    const fail = { at: 1, command: 'x', key: 'x', level: 'high' as const, signs: [], masks: [] }
    const order = bandOrder([
      mk('idle', {}), mk('work', { state: 'working' }), mk('me', {}), mk('fail', { fail }), mk('ask', { state: 'asking' }),
      mk('old', { updatedAt: 0 }),
      mk('help', { agents: [{ id: 's', desc: '', type: 'Explore', model: 'm', status: 'working', tool: '', startedAt: 1, endedAt: null, tokens: 0 }] }),
    ], now, 'me').map(b => b.id)
    expect(order).toEqual(['ask', 'fail', 'me', 'work', 'help', 'idle', 'old'])
  })
})

describe('프롬프트 캐시', () => {
  test('마지막 메인 요청에서 1시간. 기록이 없으면 null, 지나면 0 이하', async () => {
    expect(cacheLeft(null, NOW)).toBeNull()
    expect(cacheLeft(NOW - 18 * 60_000, NOW)).toBe(42 * 60_000)
    expect(cacheLeft(NOW - 61 * 60_000, NOW)!).toBeLessThanOrEqual(0)
  })
  test('분은 올려서, 지나면 만료, 기록이 없으면 빈 글', async () => {
    expect(cacheText(42 * 60_000 - 1)).toBe('캐시 42분')
    expect(cacheText(30_000)).toBe('캐시 1분')
    expect(cacheText(0)).toBe('캐시 만료')
    expect(cacheText(null)).toBe('')
    expect(cacheMinutes(9 * 60_000 - 1)).toBe('9분')
  })
  test('작업 중이 아니고 10분 이하로 남았을 때만 띠에서 알린다', async () => {
    const at = (min: number, patch: object = {}) => beat({ cacheAt: NOW - (60 - min) * 60_000, ...patch })
    expect(cacheWarn(at(8), NOW)).toBe(true)
    expect(cacheWarn(at(10), NOW)).toBe(true)
    expect(cacheWarn(at(11), NOW)).toBe(false)
    expect(cacheWarn(at(0), NOW)).toBe(false) // 만료는 띠에 남기지 않는다 (보드에만)
    expect(cacheWarn(at(8, { state: 'working' }), NOW)).toBe(false) // 일하는 중이면 곧 갱신된다
    expect(cacheWarn(beat({}), NOW)).toBe(false) // 예전 파일: cacheAt 없음
  })

  test('메인 요청 시각을 기록하고, 서브에이전트는 빼고, /clear·compact 에서 비운다', async ($, on) => {
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('turn.complete', () => ({ text: '' }))
    on('session.end', () => ({ sessionId: 'me' }))
    on('session.compact', ($, e: any) => ({ messages: e.messages }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }))
    on('turn.step', async function* ($, e: any) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { ...USAGE, model: 'm' } }
    })
    const step = async (agentId?: string) => {
      const s = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 3, ...(agentId ? { agentId } : {}) } as any)
      for await (const _ of s) { /* 조각 없음 */ }
    }
    // 직전 기록과 1.5초 안이면 미뤄져 다음 틱(3초)에 써진다
    const answer = async (turnId: string) => {
      await $.turn.complete({ reason: 'answer', answer: '끝났습니다.', durationMs: 1, isAborted: false, turnId } as any)
      await clock.advance(3_000)
    }

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    const mine = () => JSON.parse(files.get([...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!)!)
    expect(mine().cacheAt).toBeNull()

    await step()
    await answer('t1')
    expect(mine().cacheAt).toBe(NOW)

    // 서브에이전트 요청은 메인 캐시를 갱신하지 않는다
    await clock.advance(5 * 60_000)
    await step('sub-1')
    await answer('t2')
    expect(mine().cacheAt).toBe(NOW)

    // 메인 요청 51분 뒤: 띠에 9분 남음, 보드에도 같은 값
    await clock.advance(51 * 60_000 - (5 * 60_000 + 6_000))
    const band = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } } as any)
    // 세션 하나(solo): 캐시 배지 + 남은 분
    expect((await band.find({ type: 'Text', text: /^ 캐시 $/ }))?.props.backgroundColor).toBe(paletteOf('night').ask)
    expect(await band.find({ type: 'Text', text: /^9분$/ })).toBeDefined()
    await band.unmount()
    await $.command.run({ command: 'board', args: 'band line' } as any)
    const line = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } } as any)
    expect(await line.find({ type: 'Text', text: /캐시 9분/ })).toBeDefined()
    await line.unmount()
    await $.command.run({ command: 'board', args: 'band hud' } as any)
    await $.command.run({ command: 'board', args: '' } as any)
    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any)
    expect(await pane.find({ type: 'Text', text: /캐시 9분/ })).toBeDefined()
    // 라벨 칸은 6칸이다. 세 글자 라벨은 내용과 붙어 보이므로 두 글자 '최근'
    expect(await pane.find({ type: 'Text', text: /^최근$/ })).toBeDefined()
    await pane.unmount()

    // compact 뒤에는 새 prefix 라 캐시가 없다. 다음 메인 요청에서 다시 잰다
    await $.session.compact({ trigger: 'manual', messages: [{ role: 'user', text: '요약', toolUses: [] }] } as any)
    expect(mine().cacheAt).toBeNull()
    await step()
    await answer('t3')
    expect(mine().cacheAt).toBe(NOW + 51 * 60_000)

    // /clear 도 새 대화다
    await $.session.end({ reason: 'clear' } as any)
    expect(mine().cacheAt).toBeNull()

    // 세션 하나(solo)로 결정 대기: 띠 바탕이 노랗지 않으므로 질문 요약은 노란 글자
    await $.turn.complete({ reason: 'answer', answer: '1. 캐시 만료 시간\n2. 배포 시점\n어느 쪽으로 할까요?', durationMs: 1, isAborted: false, turnId: 't4' } as any)
    await clock.advance(3_000)
    const asking = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } } as any)
    expect((await asking.find({ type: 'Text', text: /^캐시 만료 시간 · 배포 시점$/ }))?.props.color).toBe(paletteOf('night').ask)
    await asking.unmount()
  })
})

describe('같은 파일 겹침 (T34 D1)', () => {
  test('저장소 안 경로는 상대 경로로, 1시간 안에 두 살아 있는 세션이 고친 같은 경로만 겹침', async () => {
    expect(touchPath('/repo/order-svc', '/repo/order-svc/src/a.ts')).toBe('src/a.ts')
    expect(touchPath('/repo/order-svc', '/tmp/x.ts')).toBe('/tmp/x.ts')
    expect(pushTouch([{ path: 'a', at: 1 }, { path: 'b', at: 2 }], 'a', 3)).toEqual([{ path: 'a', at: 3 }, { path: 'b', at: 2 }])
    const me = beat({ id: 'me', touched: [{ path: 'src/a.ts', at: NOW - 5 * 60_000 }, { path: 'README.md', at: NOW - 2 * 60 * 60_000 }] })
    const peer = beat({ id: 'p', name: 'sub-2', touched: [{ path: 'src/a.ts', at: NOW - 12 * 60_000 }, { path: 'README.md', at: NOW - 60_000 }] })
    // 다른 폴더의 같은 이름(basename)은 겹침이 아니다
    const other = beat({ id: 'o', name: 'sub-3', touched: [{ path: 'lib/a.ts', at: NOW }] })
    expect(overlaps(me, [me, peer, other], NOW)).toEqual([{ path: 'src/a.ts', name: 'sub-2', at: NOW - 12 * 60_000 }])
    // 오래된(소식 없는) 세션·옛 파일(touched 없음)은 빼고 본다
    expect(overlaps(me, [beat({ ...peer, updatedAt: NOW - 10 * 60_000 })], NOW)).toEqual([])
    expect(overlaps(me, [normalize({ id: 'old', name: 'old', cwd: '/r', updatedAt: NOW } as any)], NOW)).toEqual([])
  })

  test('다른 세션이 1시간 안에 고친 파일을 고치면 Claude 에게 한 번 알리고, 보드 카드에 겹침 줄', async ($, on) => {
    const pal = paletteOf('night')
    const DIR = '/home/me/.claude/team-board/repo-order-svc'
    const files = new Map<string, string>()
    files.set(`${DIR}/peer.json`, JSON.stringify(beat({ id: 'peer', name: 'sub-2', state: 'working', touched: [{ path: 'src/order.ts', at: NOW - 12 * 60_000 }] })))
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.call', () => ({ result: 'ok' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)

    const edit = (file_path: string) => $.tool.call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b' } as any) as Promise<any>
    const first = await edit('/repo/order-svc/src/order.ts')
    expect(first.context?.join('\n')).toMatch(/src\/order\.ts.*sub-2 12분 전/)
    // 같은 파일·같은 세션은 다시 알리지 않는다. 겹치지 않는 파일은 조용하다
    expect((await edit('/repo/order-svc/src/order.ts')).context ?? []).toEqual([])
    expect((await edit('/repo/order-svc/src/other.ts')).context ?? []).toEqual([])
    // 도구 호출이 몰리면 1.5초에 한 번만 쓰고 다음 틱에 쓴다
    await clock.advance(3_000)
    const mine = JSON.parse(files.get([...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!)!)
    expect(mine.touched.map((t: any) => t.path)).toEqual(['src/other.ts', 'src/order.ts'])

    await $.command.run({ command: 'board', args: '' } as any)
    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any)
    // 양쪽 카드에 모두: 내 카드에는 상대 이름, 상대 카드에는 내 이름
    expect((await pane.find({ type: 'Text', text: /^⚠ src\/order\.ts · sub-2 12분 전$/ }))?.props.color).toBe(pal.ask)
    expect(await pane.find({ type: 'Text', text: /^⚠ src\/order\.ts · order-svc \d+초 전$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^ ⚠ 겹침 1 $/ })).toBeDefined()
    await pane.unmount()
  })
})

describe('복귀 요약·세션 나이 (T34 D2·D4)', () => {
  const T0 = NOW - 30 * 60_000
  const peer = beat({
    id: 'peer', name: 'sub-2', state: 'asking', question: '캐시 만료를 5분으로 할까요?', startedAt: NOW - 3 * 60 * 60_000,
    timeline: [
      { at: NOW - 2 * 60 * 60_000, kind: 'prompt', text: '옛 요청' },
      { at: NOW - 2 * 60 * 60_000 + 1, kind: 'fail', text: '옛 실패' },
      { at: T0, kind: 'prompt', text: '캐시 정리' },
      { at: T0 + 60_000, kind: 'fail', text: './gradlew test · 1 failed' },
      { at: T0 + 20 * 60_000, kind: 'ask', text: '캐시 만료를 5분으로 할까요?' },
    ],
    tasks: [
      { id: '1', subject: '조사', status: 'completed', doneAt: T0 - 1 },
      { id: '2', subject: '구현', status: 'completed', doneAt: T0 + 5 * 60_000 },
      { id: '3', subject: '테스트', status: 'completed', doneAt: T0 + 9 * 60_000 },
      { id: '4', subject: '문서', status: 'in_progress' },
    ],
    touched: [{ path: 'src/a.ts', at: T0 + 2 * 60_000 }, { path: 'src/b.ts', at: T0 + 3 * 60_000 }, { path: 'README.md', at: T0 - 60_000 }],
  })

  test('흐름이 12개로 잘려 요청 줄이 밀려나도 마지막 요청 시각(promptAt)으로 센다', async () => {
    const at = NOW - 40 * 60_000
    const busy = beat({
      promptAt: at,
      timeline: Array.from({ length: 12 }, (_, i) => ({ at: at + (i + 1) * 60_000, kind: 'done', text: `턴 ${i}` })),
      touched: [{ path: 'src/a.ts', at: at + 5 * 60_000 }],
    })
    expect(sinceLastPrompt(busy)).toEqual({ at, steps: 0, files: 1, asks: 0, fails: 0 })
  })

  test('마지막 요청 뒤에 끝난 단계·고친 파일·질문·실패를 센다', async () => {
    expect(sinceLastPrompt(peer)).toEqual({ at: T0, steps: 2, files: 2, asks: 1, fails: 1 })
    expect(sinceText(sinceLastPrompt(peer)!, NOW)).toBe('30분 전 요청 뒤 · ✓ 단계 2 · 파일 2 · ⚑ 질문 1 · ⚠ 실패 1')
    // 요청이 없거나, 그 뒤 아무 일도 없으면 null
    expect(sinceLastPrompt(beat({ timeline: [] }))).toBeNull()
    expect(sinceLastPrompt(beat({ timeline: [{ at: T0, kind: 'prompt', text: 'x' }, { at: T0 + 1, kind: 'done', text: '끝' }] }))).toBeNull()
  })

  test('보드 카드에 경과 줄(요청 5분 뒤부터), 자세히에 시작 시각', async ($, on) => {
    const DIR = '/home/me/.claude/team-board/repo-order-svc'
    const files = new Map<string, string>()
    files.set(`${DIR}/peer.json`, JSON.stringify(peer))
    files.set(`${DIR}/fresh.json`, JSON.stringify(beat({ id: 'fresh', name: 'sub-3', timeline: [{ at: NOW - 60_000, kind: 'prompt', text: '방금' }], touched: [{ path: 'x.ts', at: NOW - 30_000 }] })))
    mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    // 새 세션 기록에는 시작 시각이 있다
    const mine = JSON.parse(files.get([...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!)!)
    expect(mine.startedAt).toBe(NOW)

    await $.command.run({ command: 'board', args: '' } as any)
    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 100 } } as any)
    expect(await pane.find({ type: 'Text', text: '30분 전 요청 뒤 · ✓ 단계 2 · 파일 2 · ⚑ 질문 1 · ⚠ 실패 1' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^경과$/ })).toBeDefined()
    // 요청한 지 5분이 안 된 세션은 경과 줄이 없다
    expect((await pane.findAll({ type: 'Text', text: /요청 뒤 · / })).length).toBe(1)
    await pane.unmount()

    await $.command.run({ command: 'board', args: 'sub-2' } as any)
    const detail = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 100 } } as any)
    expect(await detail.find({ type: 'Text', text: '3시간 전 시작' })).toBeDefined()
    expect(await detail.find({ type: 'Text', text: /요청 뒤 · ✓ 단계 2/ })).toBeDefined()
    await detail.unmount()
  })
})

describe('보조 에이전트 대화 보기 (T34 D3)', () => {
  test('자기 세션 자세히의 보조 줄 [보기] 를 누르면 그 대화로, 안 되면 이유를 알린다. 보는 중이면 [← 메인 대화]', async ($, on) => {
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'sub-1' }))
    on('agent.list', () => ({ value: [{ id: 'sub-1', status: 'running' }] as any }))
    const views: any[] = []
    let deny = ''
    on('ui.view', ($, e: any) => { views.push({ ...e }); return { value: deny ? { deny } : {} } })
    const toasts: string[] = []
    on('ui.toast', ($, e: any) => { toasts.push(e.text); return { value: undefined } })
    // 다른 세션의 보조는 볼 수 없다 (자기 세션 것만)
    const DIR = '/home/me/.claude/team-board/repo-order-svc'
    files.set(`${DIR}/peer.json`, JSON.stringify(beat({ id: 'peer', name: 'sub-2', agents: [{ id: 'p-1', desc: '남의 보조', type: 'Explore', model: 'm', status: 'working', tool: '', startedAt: NOW, endedAt: null, tokens: 0 }] })))

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.agent.spawn({ prompt: '표본 고르기', description: 'G4 표본 고르기', subagentType: 'Explore' } as any)
    await clock.advance(3_000)

    await $.command.run({ command: 'board', args: 'order-svc' } as any)
    const detail = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90, view: {} } } as any)
    expect(await detail.find({ type: 'Button', key: 'view-sub-1' })).toBeDefined()
    await detail.press({ key: 'view-sub-1' })
    expect(views).toEqual([{ agentId: 'sub-1' }])
    deny = 'not person-initiated'
    await detail.press({ key: 'view-sub-1' })
    expect(toasts.at(-1)).toBe('보조 대화를 열지 못했어요: not person-initiated')
    await detail.unmount()

    await $.command.run({ command: 'board', args: 'sub-2' } as any)
    const peer = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90, view: {} } } as any)
    expect(await peer.find({ type: 'Button', key: 'view-p-1' })).toBeUndefined()
    await peer.unmount()

    deny = ''
    const viewing = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90, view: { agentId: 'sub-1' } } } as any)
    await viewing.press({ key: 'view-main' })
    expect(views.at(-1)).toEqual({})
    await viewing.unmount()
  })
})

describe('검증 없음 (T34 B1)', () => {
  test('검증 명령: 테스트·빌드·타입 검사·린트. 읽기만 하는 명령과 echo 는 아니다', async () => {
    for (const c of ['cd svc && ./gradlew test --tests X', 'mvn -q verify', 'npm test', 'npm run build', 'pnpm lint', 'bun test', 'pytest -k a', 'python -m pytest', 'cargo check', 'go test ./...', 'bunx -p typescript tsc --noEmit -p .', 'npx eslint .', 'make test', 'claude plugin test ./team-board', 'claude plugin validate ./a'])
      expect([c, isVerify(c)]).toEqual([c, true])
    for (const c of ['git status', 'echo test', 'cat build/test.log', 'grep -n test a.ts', 'ls tests', 'npm install', 'git commit -m test'])
      expect([c, isVerify(c)]).toEqual([c, false])
  })

  test('검증이 필요한 편집: 저장소 안 코드. 문서·저장소 밖 파일은 아니다', async () => {
    expect(needsVerify('src/order.ts')).toBe(true)
    expect(needsVerify('build.gradle.kts')).toBe(true)
    expect(needsVerify('README.md')).toBe(false)
    expect(needsVerify('docs/guide.txt')).toBe(false)
    expect(needsVerify('docs/images/a.webp')).toBe(false)
    expect(needsVerify('/home/me/.claude/plans/p.md')).toBe(false)
    expect(needsVerify('/tmp/x.ts')).toBe(false)
  })

  test('코드를 고친 뒤 검증 없이 턴이 끝나면 카드에 표시, 검증 명령이 돌면 지운다. 문서만 고치면 조용하다', async ($, on) => {
    const pal = paletteOf('night')
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('turn.complete', () => ({ text: '' }))
    let bashErr = ''
    let bashOut: Record<string, unknown> | undefined
    on('tool.call', ($, e: any) => (e.tool === 'Bash'
      ? bashErr ? { result: `Error: ${bashErr}`, text: bashErr, isError: true } : { result: bashOut ?? { stdout: 'BUILD SUCCESSFUL in 3s', stderr: '', interrupted: false }, text: 'ok' }
      : { result: 'ok', text: 'ok' }) as any)
    const mine = () => JSON.parse(files.get([...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!)!)
    const done = async () => {
      await $.turn.complete({ reason: 'answer', answer: '고쳤습니다.', durationMs: 1, isAborted: false, turnId: 't' } as any)
      await clock.advance(3_000)
    }
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)

    // 문서만 고치면 조용하다
    await $.tool.call({ tool: 'Edit', file_path: '/repo/order-svc/README.md', old_string: 'a', new_string: 'b', tool_use_id: 'e0' } as any)
    await done()
    expect(mine().unverified ?? null).toBeNull()

    // 코드 두 개를 고치고 검증 없이 끝남
    await $.tool.call({ tool: 'Edit', file_path: '/repo/order-svc/src/a.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e1' } as any)
    await $.tool.call({ tool: 'Write', file_path: '/repo/order-svc/src/b.ts', content: 'x', tool_use_id: 'e2' } as any)
    await $.tool.call({ tool: 'Bash', command: 'git status', tool_use_id: 'b0' } as any)
    await done()
    expect(mine().unverified).toEqual({ at: NOW + 3_000, files: 2 })
    await $.command.run({ command: 'board', args: '' } as any)
    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 100 } } as any)
    expect((await pane.find({ type: 'Text', text: /^△ 마지막 코드 수정 뒤 테스트·빌드 없음 · 파일 2 · \d+초 전$/ }))?.props.color).toBe(pal.ask)
    expect(await pane.find({ type: 'Text', text: /^ △ 검증 없음 1 $/ })).toBeDefined()
    await pane.unmount()

    // 보조 에이전트가 돌린 테스트도 검증이다
    await $.tool.call({ tool: 'Bash', command: './gradlew test', agentId: 'sub-1', tool_use_id: 'b1' } as any)
    await done()
    expect(mine().unverified).toBeNull()

    // 검증 뒤 다시 고치면 다시 표시
    await $.tool.call({ tool: 'Edit', file_path: '/repo/order-svc/src/a.ts', old_string: 'b', new_string: 'c', tool_use_id: 'e3' } as any)
    await done()
    expect(mine().unverified?.files).toBe(1)

    // 돌지 않은 검증 명령(auto 모드 분류기 판정 없음)은 검증이 아니다. 돌았으면 실패해도 검증이다
    bashErr = 'The server-side auto mode classifier gave no verdict (error), so auto mode cannot determine the safety of Bash.'
    await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b2' } as any)
    await done()
    expect(mine().unverified?.files).toBe(1)
    bashErr = 'Exit code 1\nFAIL src/a.test.ts'
    await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b3' } as any)
    await done()
    expect(mine().unverified).toBeNull()

    // 중단했거나 백그라운드로 시작만 한 검증은 끝난 검증이 아니다 (Codex 검토)
    bashErr = ''
    await $.tool.call({ tool: 'Edit', file_path: '/repo/order-svc/src/a.ts', old_string: 'c', new_string: 'd', tool_use_id: 'e4' } as any)
    bashOut = { stdout: '', stderr: '', interrupted: true }
    await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b4' } as any)
    bashOut = { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bg1' }
    await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b5' } as any)
    await done()
    expect(mine().unverified?.files).toBe(1)
    bashOut = undefined
    await $.tool.call({ tool: 'Bash', command: 'npm test', tool_use_id: 'b6' } as any)
    await done()
    expect(mine().unverified).toBeNull()
  })
})

describe('결정할 것 블록 (T32)', () => {
  test('접힌 줄마다 막대를 잇고 둘째 줄부터 내어 쓴다. 묻는 줄은 ┃, 그 앞에 빈 줄', async ($, on) => {
    const pal = paletteOf('night')
    const DIR = '/home/me/.claude/team-board/repo-order-svc'
    const files = new Map<string, string>()
    const question = [
      '- 캐시 후보 조사(CACHE_NOTES.md, 09-18): 주문 조회 밖의 후보 29개를 살펴봤고, 새로 붙일 것은 0건으로 정했습니다.',
      '결정할 사항',
      '캐시 만료를 5분으로 할지 정해 주세요.',
    ].join('\n')
    files.set(`${DIR}/peer.json`, JSON.stringify(beat({ id: 'peer', name: 'sub-2', state: 'asking', question, decisions: [{ at: NOW - 60_000, question: 'push 할까요?', answer: '예' }] })))
    mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: JSON.parse(files.get(k)!).updatedAt, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.command.run({ command: 'board', args: '' } as any)

    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 40 } } as any)
    // 첫 원문 줄은 40 - 8 = 32칸으로 접혀 여러 줄. 줄마다 │ 가 붙는다
    const parts = wrapCells(question.split('\n')[0]!, 32)
    expect(parts.length).toBeGreaterThan(2)
    for (const p of parts) expect(await pane.find({ type: 'Text', text: p })).toBeDefined()
    // 노란 │ 만 센다 (탭 줄의 흐린 │ 는 구분자)
    const bars = (await pane.findAll({ type: 'Text', text: /^│$/ })).filter(t => t.props.color === pal.ask)
    expect(bars.length).toBe(parts.length + 1) // + '결정할 사항'

    // 묻는 줄: ┃ 노랑 굵게, 앞에 빈 줄 하나 (marginTop)
    expect((await pane.findAll({ type: 'Text', text: /^┃$/ })).length).toBeGreaterThan(0)
    const asking = await pane.find({ type: 'Text', text: /^캐시 만료를 5분으로/ })
    expect(asking?.props).toMatchObject({ color: pal.ask, bold: true })
    const groups = (await pane.findAll({ type: 'Box' })).filter(x => x.props.marginTop === 1 && JSON.stringify(x).includes('┃') && !JSON.stringify(x).includes('⚑'))
    expect(groups.length).toBe(1)
    await pane.unmount()

    // 자세히의 결정 기록도 카드의 답함 줄과 같은 ✓ (예전 ◆)
    await $.command.run({ command: 'board', args: 'sub-2' } as any)
    const detail = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any)
    expect((await detail.find({ type: 'Text', text: /^  ✓ $/ }))?.props.color).toBe(pal.ok)
    expect(await detail.find({ type: 'Text', text: /^  ◆ $/ })).toBeUndefined()
    await detail.unmount()
  })
})

describe('팀 창 배지', () => {
  test('칸마다 이름 앞에 상태 배지, 머리줄은 개수 있는 상태만 블록', async ($, on) => {
    const pal = paletteOf('night')
    const DIR = '/home/me/.claude/team-board/repo-order-svc'
    const files = new Map<string, string>()
    const put = (over: Record<string, unknown>) => files.set(`${DIR}/${over.id}.json`, JSON.stringify(beat(over)))
    put({ id: 'w', name: 'sub-w', state: 'working', step: 'Bash ls' })
    put({ id: 'c', name: 'sub-c', state: 'idle', cacheAt: NOW - 51 * 60_000 })
    put({ id: 'i', name: 'sub-i', state: 'idle' })
    put({ id: 'z', name: 'sub-z', state: 'idle', updatedAt: NOW - 5 * 60_000 })
    mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: JSON.parse(files.get(k)!).updatedAt, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)

    const band = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } } as any)
    const badges = await band.findAll({ type: 'Text', text: /^ (작업|캐시|대기) $|^  zz  $/ })
    expect(badges.map(t => [t.text, t.props.backgroundColor])).toEqual(expect.arrayContaining([
      [' 작업 ', pal.work], [' 캐시 ', pal.ask], [' 대기 ', pal.dim], ['  zz  ', pal.frame],
    ]))
    // 이름은 배지 뒤에 그대로, 이 세션엔 *, 캐시 경고 칸엔 남은 분
    expect(await band.find({ type: 'Text', text: /^sub-w$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^order-svc\*$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^9분$/ })).toBeDefined()
    // 오른쪽 끝 태그와 ●○ 표시는 없다
    expect(await band.find({ type: 'Text', text: /^ ?(작업|대기)$|[●○]/ })).toBeUndefined()
    // 머리줄: 작업 1, 대기 3 (나·sub-c·sub-i). 결정·실패는 0 이라 없다
    expect((await band.find({ type: 'Text', text: /^ 작업 1 $/ }))?.props.backgroundColor).toBe(pal.work)
    expect((await band.find({ type: 'Text', text: /^ 대기 3 $/ }))?.props.backgroundColor).toBe(pal.dim)
    expect(await band.find({ type: 'Text', text: /결정|실패/ })).toBeUndefined()
    await band.unmount()

    // 좁은 화면(compact)도 같은 배지
    const narrow = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 160 } } as any)
    expect(await narrow.find({ type: 'Text', text: /^ 작업 $/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /^9분$/ })).toBeDefined()
    await narrow.unmount()

    // 좁고 낮은 창: 20칸이면 한 줄 2칸씩 4자리라 +1 이 되므로 18칸으로 줄여 모두 보인다
    const low = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 62 } } as any)
    for (const name of [/^order-svc\*$/, /^sub-w$/, /^sub-c$/, /^sub-i$/, /^sub-z$/]) expect(await low.find({ type: 'Text', text: name })).toBeDefined()
    expect(await low.find({ type: 'Text', text: /더 · \/board/ })).toBeUndefined()
    const slots = (await low.findAll({ type: 'Box' })).filter(x => x.key?.startsWith('slot-'))
    expect(slots.map(x => x.props.width)).toEqual([18, 18, 18, 18, 18])
    await low.unmount()

    // 더 좁으면 머리줄 칩(TEAM 5 · 작업 1 · 대기 3)이 2줄이 되어 칸 자리가 1줄 줄어든다: 높이 6줄에 칸 2줄 → 1줄
    const tight = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 40 } } as any)
    expect((await tight.findAll({ type: 'Box' })).filter(x => x.key?.startsWith('slot-'))).toHaveLength(1)
    expect(await tight.find({ type: 'Text', text: /\+4 더 · \/board/ })).toBeDefined()
    await tight.unmount()

    // 테두리 2 + 머리줄 2 + 칸 1 = 5줄도 안 들어가면 한 줄 모양으로 그린다 (설정은 그대로 hud)
    const lowest = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 40 } } as any)
    expect(await lowest.find({ type: 'Text', text: /^ TEAM 5 $/ })).toBeDefined()
    expect((await lowest.findAll({ type: 'Box' })).filter(x => x.key?.startsWith('slot-'))).toHaveLength(0)
    await lowest.unmount()
    const back = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 5, bodyColumns: 40 } } as any)
    expect((await back.findAll({ type: 'Box' })).filter(x => x.key?.startsWith('slot-'))).toHaveLength(1)
    await back.unmount()
    // 한 줄 모양도 줄이 넘치면 중요한 세션부터 (이 세션 → 작업중 → 대기), 나머지는 +k. 높이 1줄 · 폭 38칸에는 이 세션 하나
    const oneRow = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 1, bodyColumns: 40 } } as any)
    expect(await oneRow.find({ type: 'Text', text: /^○ order-svc\*$/ })).toBeDefined()
    expect(await oneRow.find({ type: 'Text', text: /sub-w/ })).toBeUndefined()
    expect(await oneRow.find({ type: 'Text', text: /^\+4 더 · \/board$/ })).toBeDefined()
    await oneRow.unmount()
    // 높이가 넉넉하면 전과 같이 모두, 끝은 /board
    const roomy = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 4, bodyColumns: 40 } } as any)
    for (const name of [/order-svc\*/, /sub-w/, /sub-c/, /sub-i/, /sub-z/]) expect(await roomy.find({ type: 'Text', text: name })).toBeDefined()
    expect(await roomy.find({ type: 'Text', text: /^\/board$/ })).toBeDefined()
    await roomy.unmount()
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
        recent: [{ role: 'user', text: 'PR39 로그 정리 끝나면 PR38 도 봐 줘' }, { role: 'assistant', text: 'PR39 로그를 정리했습니다.' }],
      }),
    ))
    // 같은 폴더·이름의 닫힌 탭 잔재: 숨기고, 살아 있는 세션 이름에 ·2 를 붙이지 않는다
    files.set(`${DIR}/a-ghost.json`, JSON.stringify(beat({ id: 'a-ghost', name: 'sub-2', updatedAt: NOW - 5 * 60_000 })))
    // 12시간 넘게 그대로인 기록: 읽지 않고 건너뛴다
    files.set(`${DIR}/old.json`, JSON.stringify(beat({ id: 'old', name: 'gone', updatedAt: NOW - 13 * 3600_000 })))
    const reads: string[] = []

    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    let asked = ''
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    // 엔진처럼 대화마다 값이 다르다: /clear 한 빈 대화(me-c)는 percent 가 없고, /resume 으로 연 대화(other)는 30%
    on('session.usage', () => ({
      value: { startedAt: 0, rateLimits: [], context: sid === 'me-c' ? { window: 200_000 } : { tokens: 24_000, window: 200_000, percent: sid === 'other' ? 30 : 12 } },
    }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    let sid = 'me'
    on('session.id', () => ({ value: sid }))
    // 결정 대기로 바뀔 때 읽는 직전 대화. 마지막 행은 이번 답(질문 원문)이다
    let talk: { role: 'user' | 'assistant'; text: string; toolUses?: [] }[] = []
    on('session.messages', () => ({ value: talk.map(m => ({ toolUses: [], ...m })) }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      // 파일은 모두 updatedAt 에 쓰였으므로 그 시각을 수정 시각으로 둔다
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: JSON.parse(files.get(k)!).updatedAt, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => { reads.push(e.path); return { value: files.get(e.path) ?? '' } })
    // 패널이 그려졌는지: 엔진이 { isPlaced: false, reason } 을 돌려주는 경우도 시험한다
    let placed: any = { isPlaced: true }
    on('ui.open', () => ({ value: placed }))
    on('session.end', () => ({ sessionId: 'me' }))
    // 대화 기록 grep 이 돌려줄 세션 이름 줄 (비어 있으면 이름 없음)
    let titleLine = ''
    let greps = 0
    on('process.run', ($, e: any) => {
      if (e.argv[0] === 'grep') greps += 1
      return { value: { stdout: e.argv[0] === 'grep' ? titleLine : e.argv[0] === 'uname' ? 'Darwin\n' : '', stderr: '', exitCode: e.argv[0] === 'grep' && titleLine ? 0 : 1, isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('command.run', { command: 'rename' }, () => ({ text: 'renamed' }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    const submitted: any[] = []
    on('prompt.submit', ($, e: any) => { submitted.push(e); return { text: e.text } })
    on('turn.complete', () => ({ text: '' }))
    on('turn.start', ($, e: any) => ({ turnId: e.turnId }))
    on('tool.call', ($, e: any) => {
      if (e.tool === 'TaskCreate') return { result: { task: { id: '7', subject: e.subject } }, text: 'ok' }
      if (e.tool === 'TaskUpdate') return { result: { success: true }, text: 'ok' }
      if (e.tool === 'Bash') {
        const c = String(e.command)
        const stdout = c.startsWith('docker compose logs') ? 'Caused by: java.lang.IllegalStateException: boom'
          : c.includes('tail') ? '12 tests completed, 1 failed\nBUILD FAILED in 3s'
          : c.includes('pytest') ? 'no tests ran in 0.01s'
          : c.includes(' -q') ? ''
          : 'BUILD SUCCESSFUL in 3s'
        return { result: { stdout, stderr: '', interrupted: false }, text: 'ok' }
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
    on('audio.speak', ($, e: any) => { spoken.push(e.text); return { value: { via: 'system' as const } } })
    const notified: { text: string; title?: string }[] = []
    on('ui.notify', ($, e: any) => { notified.push({ text: e.text, title: e.title }); return { value: { isSent: true, channel: 'iterm2' } } })
    let calls = 0
    const JSON_ANSWER = JSON.stringify({
      why: 'PR38 착수가 이 답을 기다림',
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
    const STE_ANSWER = JSON.stringify({
      why: 'PR11 갱신이 이 결정을 기다립니다.',
      items: [{
        title: 'PR11 작업 시점', decide: 'PR11 의 작업 시점을 정하세요.',
        options: [
          { label: '이번 주', ste: ['이번 주를 고르면 PR11 을 지금 갱신합니다.'] },
          { label: '다음 주', ste: ['다음 주를 고르면 현재 작업을 먼저 끝냅니다.'] },
        ],
        suggest: '세션은 이번 주를 제안합니다.',
      }],
    })
    // 0.14 까지의 평평한 목록 형식 (재생성 첫 번째 답으로 쓴다)
    const STE_OLD = JSON.stringify({ items: [{ title: 'PR11 작업 시점', ste: ['PR11 의 작업 시점을 정하세요.', '예전 형식 문장입니다.'] }] })
    let steCalls = 0
    let askedMax = 0
    on('model.complete', ($, e: any) => {
      asked = e.prompt
      askedMax = e.maxTokens
      // ASD-STE100 요청은 따로 센다 (12살 쪽 순번을 밀지 않게)
      if (e.prompt.includes('"ste"')) {
        steCalls += 1
        return { value: { isAnswered: true, text: steCalls === 2 ? STE_OLD : STE_ANSWER, usage: USAGE } }
      }
      calls += 1
      // 세 번째는 던져서 건너뛰고, 그 아래 답할 구현이 없으므로 $.model.complete 가 reject 된다. 네 번째는 답 없음
      if (calls === 3) throw new Error('blocked model')
      if (calls === 4) return { value: { isAnswered: false, reason: 'empty-reply', usage: USAGE } }
      // 첫 번째는 형식이 틀린 답 (글로 보여주는지), 그다음부터는 JSON
      const text = calls === 1 ? '**1. PR38 착수**\n비유: 숙제 순서 정하기' : '네, 여기요:\n' + JSON_ANSWER
      return { value: { isAnswered: true, text, usage: USAGE } }
    })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    const myPath = [...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!
    const mine = () => JSON.parse(files.get(myPath)!)
    expect(mine().name).toBe('order-svc')
    // --resume·--continue 로 연 대화처럼 시작 때 usage 에 percent 가 있으면 첫 턴 전에도 그 값
    expect(mine().contextPct).toBe(12)
    expect(reads).toContain(`${DIR}/peer.json`)
    expect(reads).not.toContain(`${DIR}/old.json`)

    // 작업 진행: 할 일 추가와 진행
    await clock.advance(2_000)
    await $.tool.call({ tool: 'TaskCreate', subject: 'JOIN 감시 규칙', description: 'x', tool_use_id: 'u1' } as any)
    await clock.advance(2_000)
    await $.tool.call({ tool: 'TaskUpdate', taskId: '7', status: 'in_progress', tool_use_id: 'u2' } as any)
    await clock.advance(3_000) // 미뤄진 기록이 다음 틱에 써지는지
    expect(mine().tasks).toEqual([{ id: '7', subject: 'JOIN 감시 규칙', status: 'in_progress' }])

    // 작업 도중 결정 1: AskUserQuestion 의 답. 질문 맥락에 마지막 도구 작업을 싣는다 (할 일 도구는 계획 줄이 따로 있어 빼고)
    await $.tool.call({ tool: 'Read', file_path: '/repo/order-svc/README.md', tool_use_id: 'u2r' } as any)
    await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: 'Approval Test 범위는?', header: '범위', options: [{ label: '변경 파일만' }, { label: '전체' }], multiSelect: false }], tool_use_id: 'u3' } as any)
    expect(mine().decisions.at(-1)).toMatchObject({ question: 'Approval Test 범위는?', answer: '변경 파일만' })
    expect(mine().lastTool).toBe('Read README.md')

    // 작업 도중 결정 2: 답변 끝의 질문에 사용자가 다음 프롬프트로 답함
    await clock.advance(2_000)
    talk = [{ role: 'user', text: 'PR38 준비해 줘' }, { role: 'assistant', text: '' }, { role: 'assistant', text: '1. push 여부\n2. PR38 착수 시점을 정해 주십시오.' }]
    await $.turn.complete({ reason: 'answer', answer: '1. push 여부\n2. PR38 착수 시점을 정해 주십시오.', durationMs: 1, isAborted: false, turnId: 't1' } as any)
    expect(mine().state).toBe('asking')
    // 직전 대화는 질문 원문을 빼고 싣는다
    expect(mine().recent).toEqual([{ role: 'user', text: 'PR38 준비해 줘' }])
    await clock.advance(2_000)
    await $.prompt.submit({ text: 'PR38은 10장 수정 뒤에 시작해', origin: { kind: 'composer' } } as any)
    expect(mine().decisions.at(-1)).toMatchObject({ question: '2. PR38 착수 시점을 정해 주십시오.', answer: 'PR38은 10장 수정 뒤에 시작해' })
    expect(mine().recent).toEqual([])
    expect(mine().timeline.map((t: any) => t.kind)).toEqual(['ask', 'decide', 'ask', 'decide', 'prompt'])
    // 앞에 공백이 있는 / 글은 엔진이 일반 메시지로 보낸다: 사람 요청으로 남긴다 (2026-10-20 시험 F5)
    await $.prompt.submit({ text: ' /lookback 오늘', origin: { kind: 'composer' } } as any)
    expect(mine().timeline.at(-1)).toMatchObject({ kind: 'prompt', text: '/lookback 오늘' })
    // 새 요청 뒤 도구 없이 물으면 지난 요청의 도구 작업을 싣지 않는다
    await $.tool.call({ tool: 'AskUserQuestion', questions: [{ question: '오늘 범위는?', header: '범위', options: [{ label: '변경 파일만' }, { label: '전체' }], multiSelect: false }], tool_use_id: 'u4' } as any)
    expect(mine().lastTool).toBe('')

    // 바로 답했으니 소리 없음. 결정을 20초 넘게 기다리면 한 번만 알린다.
    await clock.advance(30_000)
    expect(spoken).toEqual([])
    await $.turn.complete({ reason: 'answer', answer: 'push 를 develop 까지 할까요?', durationMs: 1, isAborted: false, turnId: 't2' } as any)
    await clock.advance(12_000)
    expect(spoken).toEqual([])
    await clock.advance(12_000)
    expect(spoken).toEqual(['order-svc 세션이 결정을 기다립니다'])
    // OS 알림도 함께: 세션 이름과 질문 한 줄 (T34 A2)
    expect(notified).toEqual([{ title: 'team-board 결정 대기', text: 'order-svc: push 를 develop 까지 할까요?' }])
    await clock.advance(60_000)
    expect(spoken.length).toBe(1)
    expect(notified.length).toBe(1)
    // 끄면 새 질문이어도 조용
    await $.command.run({ command: 'board', args: 'sound off' } as any)
    await $.turn.complete({ reason: 'answer', answer: '테스트 범위는 어느 쪽으로 할까요?', durationMs: 1, isAborted: false, turnId: 't3' } as any)
    await clock.advance(30_000)
    expect(spoken.length).toBe(1)
    expect(notified.length).toBe(1)
    await $.command.run({ command: 'board', args: 'sound on' } as any)
    // 사용자가 치지 않은 입력(백그라운드 작업 알림)은 요청으로도, 결정의 답으로도 기록하지 않는다
    const decided = mine().decisions.length
    const noticed = await $.prompt.submit({ text: '<task-notification>done</task-notification>', origin: { kind: 'task-notification' } } as any)
    expect(noticed).toMatchObject({ text: '<task-notification>done</task-notification>' })
    expect(mine().decisions.length).toBe(decided)
    // harness 는 turn.start 를 보내지 않아서 성립한다. 실제로는 알림이 시작한 턴의 turn.start 가 asking 을 지운다 (알려진 한계, 보류)
    expect(mine().state).toBe('asking')
    expect(mine().timeline.at(-1).kind).toBe('ask')
    // 답으로 보낸 요청을 답도 도구 호출도 없이 중단하면, 그 결정 기록을 지우고 같은 질문의 결정 대기로 돌아간다
    await $.prompt.submit({ text: '다른 걸 먼저 물어볼게', origin: { kind: 'composer' } } as any)
    expect(mine().decisions.length).toBe(decided + 1)
    await $.turn.complete({ reason: 'aborted', answer: '', durationMs: 1, isAborted: true, turnId: 't-undo' } as any)
    // 결정 대기로 돌아가면 직전 대화도 돌아온다
    expect(mine()).toMatchObject({ state: 'asking', question: '테스트 범위는 어느 쪽으로 할까요?', recent: [{ role: 'user', text: 'PR38 준비해 줘' }] })
    expect(mine().decisions.length).toBe(decided)
    expect(mine().timeline.filter((t: any) => t.kind === 'decide' && t.text.includes('다른 걸 먼저'))).toEqual([])
    expect(mine().timeline.at(-1)).toMatchObject({ kind: 'abort' })
    await $.prompt.submit({ text: '변경 파일만', origin: { kind: 'composer' } } as any)
    expect(mine().decisions.at(-1)).toMatchObject({ question: '테스트 범위는 어느 쪽으로 할까요?', answer: '변경 파일만' })
    // 도구를 쓴 뒤의 중단은 답을 받아 일하던 중이라 결정 기록을 그대로 둔다
    await $.tool.call({ tool: 'Read', file_path: '/repo/order-svc/a.ts', tool_use_id: 'r-undo' } as any)
    await $.turn.complete({ reason: 'aborted', answer: '', durationMs: 1, isAborted: true, turnId: 't-keep' } as any)
    expect(mine().decisions.at(-1)).toMatchObject({ answer: '변경 파일만' })
    expect(mine().state).toBe('idle')
    await $.turn.start({ text: '', turnId: 't-after' } as any) // 뒤 시나리오는 작업 중인 이 세션에서 이어진다

    // 띠
    await clock.advance(3_000)
    const band = await $.ui.mount({
      plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 },
    } as any)
    expect(await band.find({ type: 'Text', text: /OTHER-MOD-BAND/ })).toBeDefined()
    // 기본은 HUD 창: 머리줄 + 세션 칸
    expect(await band.find({ type: 'Text', text: /◆ TEAM 2/ })).toBeDefined()
    // 머리줄 칩 줄은 좁으면 다음 줄로 넘긴다 (55칸에서 칩이 글자마다 쪼개졌다)
    expect((await band.findAll({ type: 'Box' })).find(x => x.key === 'band-chips')?.props.flexWrap).toBe('wrap')
    expect(await band.find({ type: 'Text', text: /^ 결정 1 $/ })).toBeDefined()
    // 머리줄에 세션 단계 합계 막대는 없다 (T25: 서로 다른 작업의 단계를 더한 수라 뜻이 없었다)
    expect(await band.find({ type: 'Text', text: /^[▰▱]{8}$/ })).toBeUndefined()
    // 결정 대기 칸 (T32): 칸을 노랗게 칠하지 않고 왼쪽 막대 ▌ 로 표시한다. 배지 노랑 · 이름 흰 글자 · 질문 노란 글자
    // (칸 전체가 노랑이면 배지·이름·질문이 한 색이었다). 이름 앞 표시(⚑)는 배지로 바뀌었다
    const askBadge = await band.find({ type: 'Text', text: /^ 결정 $/ })
    expect(askBadge?.props).toMatchObject({ color: paletteOf('night').onBadge, backgroundColor: paletteOf('night').ask })
    expect((await band.find({ type: 'Text', text: /^5\. PR38을 지금 시작할까요\?$/ }))?.props.color).toBe(paletteOf('night').ask)
    expect((await band.find({ type: 'Text', text: /^sub-2$/ }))?.props.color).toBe(paletteOf('night').text)
    expect((await band.findAll({ type: 'Text', text: /^▌$/ })).map(t => t.props.color)).toEqual([paletteOf('night').ask, paletteOf('night').ask])
    const askSlot = (await band.findAll({ type: 'Box' })).find(x => x.key === 'slot-peer')
    expect(askSlot?.props.backgroundColor).toBe(paletteOf('night').card)
    expect(await band.find({ type: 'Text', text: /⚑/ })).toBeUndefined()
    expect(await band.find({ type: 'Text', text: /sub-2·2/ })).toBeUndefined()
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

    // 패널이 그려지지 않으면 열었다고 하지 않고 엔진이 준 이유를 그대로 보여 준다
    placed = { isPlaced: false, reason: 'the attached surfaces place no panes' }
    const notShown = await $.command.run({ command: 'board', args: '' } as any)
    expect(notShown.text).toContain('그리지 못했어요')
    expect(notShown.text).toContain('the attached surfaces place no panes')
    expect(notShown.text).not.toContain('열었어요')
    placed = { isPlaced: true }

    // 전체 보기
    await $.command.run({ command: 'board', args: '' } as any)
    const PANE = { plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any
    let pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /결정 대기 1/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^[▰▱]+$/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /→ 예, release 만/ })).toBeDefined()
    // 이름표 (T32): 기다리는 질문은 '질문', 이미 내린 결정은 '답함' + ✓. 둘 다 '결정' 이라 구분되지 않았다
    expect(await pane.find({ type: 'Text', text: /^질문$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^답함$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^결정$/ })).toBeUndefined()
    expect((await pane.find({ type: 'Text', text: /^✓ $/ }))?.props.color).toBe(paletteOf('night').ok)
    // 결정할 것 블록에서 묻는 줄은 굵은 노란 막대 ┃
    expect((await pane.find({ type: 'Text', text: /^┃$/ }))?.props.color).toBe(paletteOf('night').ask)
    // 알약 막대 (T24 B안): 채움 끝에 결정을 기다리는 지금 단계, 남은 구간, %
    expect((await pane.find({ type: 'Text', text: /^ \? PR38 래퍼 $/ }))?.props.backgroundColor).toBe(chip('ask'))
    expect(await pane.find({ type: 'Text', text: /^━+$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^  50%$/ })).toBeDefined()
    expect(await pane.find({ type: 'Raster' })).toBeDefined() // 픽셀 아이콘
    expect(await pane.find({ type: 'Text', text: /PR38 래퍼/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /결정을 기다려요/ })).toBeDefined() // 주의 띠
    // 질문 줄과 탭 줄 사이 흐린 가로줄 (카드 테두리 노랑과 겹치지 않게 흐린 색)
    const sep = await pane.find({ key: 'sep-peer' })
    expect(sep?.text).toMatch(/^─+$/)
    expect(JSON.stringify(sep)).toContain(paletteOf('night').dim)

    // 12살 탭: 지난 결정까지 맥락으로 넘긴다
    expect(await pane.find({ key: 'regen-kid-peer' })).toBeUndefined() // 만들기 전에는 재생성 없음
    await pane.press({ key: 'tab-kid-peer' })
    await clock.advance(3_000)
    expect(asked).toContain('PR38을 지금 시작할까요?')
    expect(asked).toContain('질문 직전 대화:\n사용자: PR39 로그 정리 끝나면 PR38 도 봐 줘\nClaude: PR39 로그를 정리했습니다.')
    expect(asked).toContain('push 할까요? → 예, release 만')
    expect(await pane.find({ type: 'Text', text: /^1\. PR38 착수$/ })).toBeDefined()
    await pane.unmount()

    // 그 세션의 질문이 바뀌면 지난 설명은 보이지 않는다
    files.set(`${DIR}/peer.json`, JSON.stringify({ ...JSON.parse(files.get(`${DIR}/peer.json`)!), question: 'PR11 은 이번 주에 할까요?', updatedAt: NOW + 20_000 }))
    await clock.advance(3_000)
    pane = await $.ui.mount(PANE)
    expect(await pane.find({ type: 'Text', text: /PR11 은 이번 주에 할까요/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^1\. PR38 착수$/ })).toBeUndefined()

    // 새 질문의 설명은 JSON 으로 받아 mod 가 ASCII 그림으로 그린다. 12살 요청에는 STE 규격이 없다
    await pane.press({ key: 'tab-kid-peer' })
    await clock.advance(3_000)
    expect(asked).toContain('"items"')
    expect(asked).not.toContain('"ste"')
    expect(await pane.find({ type: 'Text', text: /│ PR11 바로 갱신 │ → │ 문서 최신 │/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /▸ 다음 주/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /앞서 release 만 push 하기로 함/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /PR38 과 겹치는지 확인/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^ 왜 지금 $/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^PR38 착수가 이 답을 기다림$/ })).toBeDefined()
    // 고른 탭은 배지처럼 색 바탕, 안 고른 탭은 색 글자. 만든 종류에만 재생성(↻)
    const night = paletteOf('night')
    expect((await pane.find({ type: 'Text', text: /^ 12살 ▴ $/ }))?.props).toMatchObject({ backgroundColor: night.ok, color: night.onBadge })
    expect((await pane.find({ type: 'Text', text: /^\[ ASD-STE100 \]$/ }))?.props).toMatchObject({ color: night.work })
    // 재생성은 괄호 없는 ↻, 평소 흐리게 (이모지 🔄 는 2칸 고정 색 타일이라 괄호까지 6칸이었다).
    // 앞뒤 공백까지 3칸: 1칸이면 초점 반전이 눈에 잘 안 띈다 (Orca 실화면)
    expect((await pane.find({ key: 'regen-kid-peer' }))?.props).toMatchObject({ plain: true, label: ' ↻ ', dimColor: true })
    expect(await pane.find({ key: 'regen-ste-peer' })).toBeUndefined()

    // 열린 탭을 다시 누르면 접기 / 펼치기
    await pane.press({ key: 'tab-kid-peer' })
    expect(await pane.find({ type: 'Text', text: /PR11 바로 갱신/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /^ 12살 ▾ $/ })).toBeDefined()
    await pane.press({ key: 'tab-kid-peer' })
    expect(await pane.find({ type: 'Text', text: /PR11 바로 갱신/ })).toBeDefined()

    // ASD-STE100 탭: 따로 만들고, 상자에는 고른 탭의 설명만 보인다
    await pane.press({ key: 'tab-ste-peer' })
    expect(await pane.find({ type: 'Text', text: /설명 만드는 중…/ })).toBeDefined()
    expect(await pane.find({ key: 'regen-ste-peer' })).toBeUndefined() // 만드는 중에는 재생성을 숨긴다
    await clock.advance(3_000)
    expect(steCalls).toBe(1)
    // 생각(thinking) 토큰도 한도 안에서 쓰므로 6항목 답이 잘리지 않게 넉넉히 (0.15.0 ai-test V9)
    expect(askedMax).toBe(8000)
    expect(asked).toContain('ASD-STE100')
    expect(asked).toContain('"ste"')
    expect(await pane.find({ type: 'Text', text: /^이번 주를 고르면 PR11 을 지금 갱신합니다\.$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^1\. PR11 작업 시점$/ })).toBeDefined()
    // 역할별 세로 목록: ▶ 정할 것, ▸ 선택지 이름 칸 + 그 문장, ★ 세션 제안
    expect(await pane.find({ type: 'Text', text: /^▶$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^PR11 의 작업 시점을 정하세요\.$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^ {3}▸ 이번 주$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^ {3}▸ 다음 주$/ })).toBeDefined()
    expect((await pane.find({ type: 'Text', text: /^세션은 이번 주를 제안합니다\.$/ }))?.props).toMatchObject({ color: night.ask })
    expect(await pane.find({ type: 'Text', text: /^PR11 갱신이 이 결정을 기다립니다\.$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /PR11 바로 갱신/ })).toBeUndefined()
    expect((await pane.find({ type: 'Text', text: /^ ASD-STE100 ▴ $/ }))?.props).toMatchObject({ backgroundColor: night.work })
    expect(await pane.find({ type: 'Text', text: /^\[ 12살 \]$/ })).toBeDefined()

    // 이미 만든 탭으로 돌아가면 모델을 다시 부르지 않는다
    const kidCalls = calls
    await pane.press({ key: 'tab-kid-peer' })
    await clock.advance(3_000)
    expect(calls).toBe(kidCalls)
    expect(await pane.find({ type: 'Text', text: /PR11 바로 갱신/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^이번 주를 고르면/ })).toBeUndefined()

    // 재생성: 누르면 만드는 동안 버튼이 숨어서 두 번 누를 수 없고, 한 번만 만든다
    await pane.press({ key: 'regen-ste-peer' })
    expect(await pane.find({ key: 'regen-ste-peer' })).toBeUndefined()
    await clock.advance(3_000)
    await clock.advance(3_000)
    expect(steCalls).toBe(2)
    expect(await pane.find({ key: 'regen-ste-peer' })).toBeDefined()
    // 좁은 패널(N2b): 탭 줄은 묶음 사이에서 줄바꿈. 탭과 그 ↻ 는 한 묶음, │ 는 둘째 묶음부터 앞에
    const tabs = await pane.find({ key: 'tabs-peer' })
    expect(tabs?.props).toMatchObject({ flexWrap: 'wrap' })
    expect(JSON.stringify(await pane.find({ key: 'tabgrp-kid-peer' }))).toContain('regen-kid-peer')
    const steGrp = JSON.stringify(await pane.find({ key: 'tabgrp-ste-peer' }))
    expect(steGrp).toContain('regen-ste-peer')
    expect(steGrp).toContain('│')
    expect(JSON.stringify(await pane.find({ key: 'tabgrp-html-peer' }))).toContain('html-peer')
    // 예전 형식 답은 · 목록으로 보인다
    expect(await pane.find({ type: 'Text', text: /^예전 형식 문장입니다\.$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^·$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^▶$/ })).toBeUndefined()

    // 두 탭의 재생성을 같은 틱에 눌러도 둘 다 만든다 (요청 줄). 12살 쪽은 모델 호출이 거부(reject)되어 이유를 보여준다
    await pane.press({ key: 'regen-kid-peer' })
    await pane.press({ key: 'regen-ste-peer' })
    await clock.advance(3_000)
    await clock.advance(3_000)
    expect(steCalls).toBe(3)
    await pane.press({ key: 'tab-kid-peer' })
    expect(await pane.find({ type: 'Text', text: /설명을 만들지 못했어요 \(.*no implementation for model\.complete\)/ })).toBeDefined()
    // 답이 없을 때도 로딩에 머물지 않는다
    await pane.press({ key: 'regen-kid-peer' })
    await clock.advance(3_000)
    expect(await pane.find({ type: 'Text', text: /설명을 만들지 못했어요 \(empty-reply\)/ })).toBeDefined()

    // HTML: 보드를 연 이 세션에 Artifact 발행을 요청한다. 질문 하나에 한 번
    await $.turn.complete({ reason: 'answer', answer: 'release 태그도 달까요?', durationMs: 1, isAborted: false, turnId: 't-ask' } as any)
    expect(mine()).toMatchObject({ state: 'asking', question: 'release 태그도 달까요?' })
    const sentBefore = submitted.length
    await pane.press({ key: 'html-peer' })
    expect(submitted.length).toBe(sentBefore + 1)
    const req = submitted.at(-1)
    expect(req.origin).toMatchObject({ kind: 'plugin', name: 'team-board' })
    expect(req.text).toContain('Artifact')
    expect(req.text).toContain('PR11 은 이번 주에 할까요?')
    expect(req.text).toContain('push 할까요? → 예, release 만')
    // 보낸 뒤에는 버튼 대신 글자라 다시 누를 수 없다
    expect(await pane.find({ key: 'html-peer' })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /^HTML 요청함$/ })).toBeDefined()
    // 이 세션도 결정 대기 중이었으니, 요청 턴(중단 포함)이 끝난 뒤 그 결정 대기로 돌아간다
    await $.turn.start({ text: req.text, turnId: 't-html' } as any)
    expect(mine().state).toBe('working')
    await $.turn.complete({ reason: 'answer', answer: '발행했어요: https://claude.ai/artifact/x 어느 쪽으로 할까요?', durationMs: 1, isAborted: false, turnId: 't-html' } as any)
    expect(mine()).toMatchObject({ state: 'asking', question: 'release 태그도 달까요?' })
    expect(mine().timeline.at(-1).text).not.toContain('artifact')
    await $.turn.start({ text: '', turnId: 't-next' } as any) // 뒤 시나리오는 작업 중인 이 세션에서 이어진다
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
    // 자세히의 할 일 (T25): plan-progress 띠 모양. 줄 끝까지 옅은 작업색 바탕, 오른쪽 끝 상태 글, 취소선 없음
    const strip = await pane.find({ type: 'Text', text: /^ ● 1  JOIN 감시 규칙 +진행 중 $/ })
    expect(strip).toBeDefined()
    expect(JSON.stringify(strip)).toContain('backgroundColor')
    expect(JSON.stringify(strip)).not.toContain('strikethrough')
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

    // 인자 없는 /rename: 이름이 기록 파일에 늦게 쓰여도 다음 확인에서 잡는다
    await $.command.run({ command: 'rename', args: '' } as any)
    expect(mine().name).toBe('order-svc')
    titleLine = '"customTitle":"cache-design"\n'
    await clock.advance(15_000)
    expect(mine().name).toBe('cache-design')
    // 이름을 찾았으면 더 찾지 않는다
    const found = greps
    await clock.advance(15_000)
    expect(greps).toBe(found)
    // /clear·/resume 로 세션 id 가 바뀌면 새 기록 파일에서 한 번 더 찾는다
    sid = 'me-2'
    await clock.advance(3_000)
    expect(greps).toBe(found + 1)
    sid = 'me'
    await clock.advance(3_000)
    expect(greps).toBe(found + 2)
    // session.start 가 다른 id 로 다시 와도 (모듈은 그대로) 새 기록 파일에서 한 번 더 찾는다
    sid = 'me-3'
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await clock.advance(15_000)
    expect(greps).toBe(found + 3)
    sid = 'me'
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)

    // /rename 을 따라가고, 다시 로드돼도 그 이름
    await $.command.run({ command: 'rename', args: 'api-fix' } as any)
    expect(mine().name).toBe('api-fix')

    // 숨은 실패: exit 0 인데 실패 출력 → Claude 메모, 띠 표시, 같은 명령 재실행으로 해제
    const ran: any = await $.tool.call({ tool: 'Bash', command: './gradlew test 2>&1 | tail -20', tool_use_id: 'b1' } as any)
    expect(ran.context?.join('\n')).toContain('exit 0 으로 끝났지만')
    expect(mine().fail).toMatchObject({ level: 'high', key: './gradlew test' })
    const fb = await $.ui.mount(BAND)
    expect(await fb.find({ type: 'Text', text: /⚠ 실패 1/ })).toBeDefined()
    expect((await fb.find({ type: 'Text', text: /^ 실패 $/ }))?.props.backgroundColor).toBe(paletteOf('night').bad)
    await fb.unmount()
    expect((await $.command.run({ command: 'board', args: 'fail' } as any)).text).toContain('12 tests completed, 1 failed')
    // 다른 명령의 확인 필요(warn)는 남아 있는 실패(high)를 덮지 않는다. 기록에는 남긴다
    await $.tool.call({ tool: 'Bash', command: 'pytest -k foo', tool_use_id: 'b1w' } as any)
    expect(mine().fail).toMatchObject({ level: 'high', key: './gradlew test' })
    expect(mine().timeline.at(-1)).toMatchObject({ kind: 'fail', text: expect.stringContaining('pytest -k') })
    await $.tool.call({ tool: 'Bash', command: './gradlew test --tests Order', tool_use_id: 'b2' } as any)
    expect(mine().fail).toBeNull()
    expect(mine().timeline.some((t: any) => t.kind === 'fail')).toBe(true)
    // 출력 없이 성공해도 같은 명령이면 해제한다
    await $.tool.call({ tool: 'Bash', command: './gradlew test 2>&1 | tail -5', tool_use_id: 'b3' } as any)
    expect(mine().fail).toMatchObject({ level: 'high', key: './gradlew test' })
    await $.tool.call({ tool: 'Bash', command: './gradlew test -q', tool_use_id: 'b4' } as any)
    expect(mine().fail).toBeNull()
    // 실패 코드를 가리는 명령(|| true)이 출력 없이 끝나면 통과했는지 알 수 없으니 지우지 않는다
    await $.tool.call({ tool: 'Bash', command: './gradlew test 2>&1 | tail -5', tool_use_id: 'b5' } as any)
    await $.tool.call({ tool: 'Bash', command: './gradlew test -q > out.log 2>&1 || true', tool_use_id: 'b6' } as any)
    expect(mine().fail).toMatchObject({ level: 'high', key: './gradlew test' })
    await $.tool.call({ tool: 'Bash', command: './gradlew test -q', tool_use_id: 'b7' } as any)
    expect(mine().fail).toBeNull()
    // 로그를 읽기만 하는 명령은 앞 낱말이 같아도(docker compose) 실패 표시를 지우지 않는다
    await $.tool.call({ tool: 'Bash', command: 'docker compose run --rm app ./gradlew test 2>&1 | tail -20', tool_use_id: 'b8' } as any)
    expect(mine().fail).toMatchObject({ level: 'high', key: 'docker compose' })
    await $.tool.call({ tool: 'Bash', command: 'docker compose logs --no-log-prefix app --tail 30', tool_use_id: 'b9' } as any)
    expect(mine().fail).toMatchObject({ level: 'high', key: 'docker compose' })
    await $.tool.call({ tool: 'Bash', command: 'docker compose run --rm app ./gradlew test', tool_use_id: 'b10' } as any)
    expect(mine().fail).toBeNull()

    expect((await $.command.run({ command: 'board', args: 'band solo off' } as any)).text).toContain('숨겨요')
    expect((await $.command.run({ command: 'board', args: 'band solo on' } as any)).text).toContain('보여요')

    const missing = await $.command.run({ command: 'board', args: 'nobody' } as any)
    expect(missing.text).toContain('찾지 못했어요')

    // 명령 안내: /board help, 모르는 옵션은 help 로
    const help = (await $.command.run({ command: 'board', args: 'help' } as any)).text
    for (const w of ['/board band hud | line', '/board sound test', '/board fail clear', '/board name <이름>']) expect(help).toContain(w)
    expect((await $.command.run({ command: 'board', args: 'band blue' } as any)).text).toContain('모르는 옵션')

    // /clear: 숨지 않고 대기로. 결정 기록은 남고 대기 질문·할 일·숨은 실패는 비운다
    await $.tool.call({ tool: 'Bash', command: './gradlew test 2>&1 | tail -5', tool_use_id: 'b11' } as any)
    expect(mine().fail).toMatchObject({ level: 'high', key: './gradlew test' })
    await $.turn.complete({ reason: 'answer', answer: '배포를 오늘 할까요?', durationMs: 1, isAborted: false, turnId: 't9' } as any)
    expect(mine().state).toBe('asking')
    const kept = mine().decisions.length
    expect(mine().contextPct).toBe(12)
    await $.session.end({ reason: 'clear', sessionId: 'me', resume: {} } as any)
    // ctx 는 다음 턴이 끝나야 다시 재므로, /clear 가 비운 대화는 0 으로 둔다 (옛 12% 가 남던 것)
    expect(mine()).toMatchObject({ state: 'idle', question: '', tasks: [], fail: null, contextPct: 0 })
    expect(mine().decisions.length).toBe(kept)
    expect(mine().timeline.at(-1).kind).toBe('clear')
    await clock.advance(3_000)
    const cb = await $.ui.mount(BAND)
    expect(await cb.find({ type: 'Text', text: /api-fix\*/ })).toBeDefined()
    await cb.unmount()
    // /clear 로 id 가 바뀌면 같은 대화가 이어지므로 직접 정한 이름이 새 id 로 따라간다
    sid = 'me-c'
    await clock.advance(3_000)
    expect(mine().name).toBe('api-fix')
    expect(mine().contextPct).toBe(0)
    // /resume 으로 다른 대화로 옮기면 그 대화의 이름을 쓴다. 이 이름을 그 대화에 옮겨 적지 않는다
    // (2026-10-20 F2: claude -c 가 옆 세션의 대화를 연 뒤 제 대화로 옮겼더니 옆 세션 이름이 남았다)
    await $.session.end({ reason: 'resume', sessionId: 'me-c', resume: {} } as any)
    // session.end 때 usage 는 아직 떠나는 대화의 값이라 비워 두고, id 가 바뀐 뒤 옮긴 대화의 값을 읽는다
    expect(mine().contextPct).toBeNull()
    sid = 'other'
    titleLine = '"customTitle":"devflow1"\n'
    await clock.advance(3_000)
    expect(mine().name).toBe('devflow1')
    expect(mine().contextPct).toBe(30)
    await clock.advance(15_000)
    expect(mine().name).toBe('devflow1')
    // 진짜 종료는 숨김
    await $.session.end({ reason: 'prompt_input_exit', sessionId: 'me', resume: {} } as any)
    expect(mine().state).toBe('ended')
  })

  test('새 세션은 첫 턴 전에도 ctx 0% (usage 에 percent 가 없음), 모듈만 다시 로드되면 저장된 값을 둔다', async ($, on) => {
    const files = new Map<string, string>()
    mock.clock(on, { now: NOW })
    mock.store(on)
    let context: { tokens?: number; window: number; percent?: number } = { window: 200_000 }
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context } }))
    on('session.cwd', () => ({ value: '/repo/a' }))
    on('session.repo', () => ({ value: { root: '/repo/a', remote: null, internal: false, name: 'a' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', () => ({ value: [] }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/a' } as any)
    const mine = () => JSON.parse([...files.entries()].find(([k]) => /\/me-[0-9a-f]{8}\.json$/.test(k))![1])
    expect(mine().contextPct).toBe(0)
    context = { tokens: 80_000, window: 200_000, percent: 40 }
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/a' } as any)
    expect(mine().contextPct).toBe(0)
  })
})

// work-plan 대역: 테스트가 준 계획을 자기 atom 에 쓴다 (atom 은 주인만 쓸 수 있다)
const WORK_PLAN = {
  name: 'work-plan',
  register(on: any) {
    on('tool.call', { tool: 'SetPlan' }, async ($: any, e: any) => {
      await $.state.set({ plugin: 'work-plan', key: 'plan' }, e.plan)
      return { result: 'ok' }
    })
  },
}

describe('work-plan 연동', () => {
  test('계획 atom 을 관찰해 할 일로 옮기고, 턴 끝은 결정 대기 여부로 그린다 (hook 순서 무관)', { plugins: [WORK_PLAN] }, async ($, on) => {
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', () => ({ value: [...files.keys()].map(p => ({ kind: 'file' as const, name: p.split('/').pop()!, mtimeMs: NOW, size: 0, isLink: false })) }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('turn.complete', () => ({ text: '' }))
    on('turn.start', ($, e: any) => ({ turnId: e.turnId }))
    on('tool.call', () => ({ result: 'ok: 3 steps', text: 'ok' }) as any)
    on('ui.render', { component: 'Spinner' }, ($, e: any) => ({ type: 'Text', props: {}, children: [e.props.message ?? e.props.word] }) as any)
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => $.ui.resolve(e).Text({ children: '' }))

    const plan = (steps: [string, string][], over: Record<string, unknown> = {}) => ({
      v: 1, steps: steps.map(([title, status]) => ({ title, status })), updatedAt: NOW, stale: false, ended: null, ...over,
    })
    const STEPS: [string, string][] = [['math.py 만들기', 'done'], ['테스트 쓰기', 'doing'], ['실행', 'todo']]
    const setPlan = (p: unknown) => $.tool.call({ tool: 'SetPlan', plan: p, tool_use_id: 'sp' } as any)
    const mine = () => JSON.parse([...files.entries()].find(([k]) => /\/me-[0-9a-f]{8}\.json$/.test(k))![1])
    const statuses = () => mine().tasks.map((t: any) => t.status)
    const flush = () => clock.advance(3_000) // 미룬 기록은 다음 틱에 써진다

    // 모듈이 로드되기 전에 쓰인 계획도 session.start 에서 읽는다
    await setPlan(plan([['math.py 만들기', 'doing']]))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await flush()
    expect(mine().tasks).toEqual([{ id: '1', subject: 'math.py 만들기', status: 'in_progress' }])

    // 일하는 중: 할 일과 단계 줄. plan_update 호출 자체는 단계 줄을 덮지 않는다
    await $.turn.start({ text: 'math.py 와 테스트', turnId: 't1' } as any)
    await setPlan(plan(STEPS, { updatedAt: NOW + 1_000 }))
    await $.tool.call({ tool: 'mcp__work-plan__plan_update', steps: [], tool_use_id: 'pu' } as any)
    await flush()
    expect(statuses()).toEqual(['completed', 'in_progress', 'pending'])
    // 단계별 시간 (T25 B): 끝난 시각은 기록한 때(지금)가 아니라 보고 시각, 계획 시작은 첫 보고 시각
    expect(mine().tasks[0].doneAt).toBe(NOW + 1_000)
    expect(mine().planStartAt).toBe(NOW)
    expect(mine().step).toBe('할 일: 테스트 쓰기')

    // Spinner 줄 (T24): 지금 단계로 글을 바꾼다. 엔진이 자기 문구를 띄운 동안은 두고, 지금 단계가 없으면 두지 않는다
    const SPIN = { plugin: 'team-board', surface: 'terminal', component: 'Spinner' } as any
    const spinProps = { word: 'Sauteing', message: null, suffix: '…', mode: 'tool-use' }
    expect(await (await $.ui.mount({ ...SPIN, props: spinProps })).find({ type: 'Text', text: '2/3 테스트 쓰기' })).toBeDefined() // 지금 단계의 순번/전체
    expect(await (await $.ui.mount({ ...SPIN, props: { ...spinProps, message: 'Waiting for permission' } })).find({ type: 'Text', text: /2\/3/ })).toBeUndefined()
    // 혼자 띠: 알약 막대에 지금 단계와 %
    const solo = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, bodyColumns: 120, maxRows: 10 } } as any)
    expect((await solo.find({ type: 'Text', text: /^ 테스트 쓰기 $/ }))?.props.backgroundColor).toBe(chip('work'))
    // % 는 알약과 같은 상태색 굵은 글자 (흐린 글자는 잘 안 보였다)
    expect((await solo.find({ type: 'Text', text: /^  33%$/ }))?.props).toMatchObject({ color: paletteOf('night').work, bold: true })
    // 섞은 색이라 흐린 글자 표시는 없다 (theme 팔레트만 dimColor)
    expect((await solo.find({ type: 'Text', text: /^━+$/ }))?.props.dimColor).toBe(false)

    // 모르는 모양은 무시
    await setPlan({ ...plan(STEPS), v: 2, steps: [] })
    await flush()
    expect(mine().tasks).toHaveLength(3)

    // 질문으로 끝난 턴도 남은 단계를 완료로 그린다. 모델은 질문 전에 마지막 done 을 보내지 않는다 (T24 재시험: 1/3 에 멈춰 보였다)
    await setPlan(plan(STEPS, { updatedAt: NOW + 1_000, ended: { reason: 'answer', at: NOW + 9_000 } }))
    await $.turn.complete({ reason: 'answer', answer: '테스트 파일 이름을 무엇으로 할까요?', durationMs: 1, isAborted: false, turnId: 't1' } as any)
    await flush()
    expect(mine().state).toBe('asking')
    expect(statuses()).toEqual(['completed', 'completed', 'completed'])
    // 턴 끝에 완료로 그린 단계는 턴이 끝난 시각: 지금 단계(테스트 쓰기)는 8초, 보고 없이 끝난 실행은 모름
    expect(stepTimes(mine().tasks, mine().planStartAt, NOW + 20_000)).toEqual(['1초', '8초', ''])

    // 답으로 끝난 턴: 남은 단계도 완료. 표시가 나중에 와도(바깥 hook) 같다
    await $.turn.start({ text: 'test_math.py', turnId: 't2' } as any)
    await setPlan(plan(STEPS, { updatedAt: NOW + 30_000 }))
    await flush()
    // 끝난 계획 뒤의 보고는 이름이 같아도 새 계획: 시작 시각을 새 보고로
    expect(mine().planStartAt).toBe(NOW + 30_000)
    await $.turn.complete({ reason: 'answer', answer: '세 단계를 마쳤습니다.', durationMs: 1, isAborted: false, turnId: 't2' } as any)
    await setPlan(plan(STEPS, { ended: { reason: 'answer', at: NOW + 1 } }))
    await flush()
    expect(mine().state).toBe('idle')
    expect(statuses()).toEqual(['completed', 'completed', 'completed'])

    // 중단된 턴 (T25): 남은 단계를 그대로 두고, 띠 알약은 작업색이 아니라 노랑 '멈춤'
    await $.turn.start({ text: '다시', turnId: 't3' } as any)
    await setPlan(plan(STEPS))
    await $.turn.complete({ reason: 'aborted', answer: '', durationMs: 1, isAborted: true, turnId: 't3' } as any)
    await setPlan(plan(STEPS, { ended: { reason: 'aborted', at: NOW + 2 } }))
    await flush()
    expect(mine().state).toBe('idle')
    expect(statuses()).toEqual(['completed', 'in_progress', 'pending'])
    const stopped = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, bodyColumns: 120, maxRows: 10 } } as any)
    expect((await stopped.find({ type: 'Text', text: /^ 멈춤: 테스트 쓰기 $/ }))?.props.backgroundColor).toBe(chip('ask'))

    // 끝난 계획 뒤 계획 없이 일하는 턴 (T27): 옛 단계를 진행 중으로 그리지 않는다
    await $.turn.start({ text: 'git status', turnId: 't4' } as any)
    await flush()
    expect(mine()).toMatchObject({ state: 'working', planEnded: true })
    expect(await (await $.ui.mount({ ...SPIN, props: spinProps })).find({ type: 'Text', text: /2\/3/ })).toBeUndefined()
    const busy = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, bodyColumns: 120, maxRows: 10 } } as any)
    expect((await busy.find({ type: 'Text', text: /^ 멈춤: 테스트 쓰기 $/ }))?.props.backgroundColor).toBe(chip('ask'))
    // 새 보고가 오면 다시 지금 단계
    await setPlan(plan(STEPS))
    await flush()
    expect(mine().planEnded).toBe(false)
    expect(await (await $.ui.mount({ ...SPIN, props: spinProps })).find({ type: 'Text', text: '2/3 테스트 쓰기' })).toBeDefined()
  })
})

describe('알약 막대 팔레트 (T24)', () => {
  test('theme 팔레트(이름 색)는 채움을 흐린 글자로, 알약은 상태색 바탕', { plugins: [WORK_PLAN], options: { palette: 'theme' } }, async ($, on) => {
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/a' }))
    on('session.repo', () => ({ value: { root: '/repo/a', remote: null, internal: false, name: 'a' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', () => ({ value: [...files.keys()].map(p => ({ kind: 'file' as const, name: p.split('/').pop()!, mtimeMs: NOW, size: 0, isLink: false })) }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('turn.start', ($, e: any) => ({ turnId: e.turnId }))
    on('tool.call', () => ({ result: 'ok', text: 'ok' }) as any)
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => $.ui.resolve(e).Text({ children: '' }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/a' } as any)
    await $.turn.start({ text: 'x', turnId: 't1' } as any)
    await $.tool.call({ tool: 'SetPlan', plan: { v: 1, steps: [{ title: 'a', status: 'done' }, { title: '테스트 쓰기', status: 'doing' }, { title: 'c', status: 'todo' }], updatedAt: NOW, stale: false, ended: null }, tool_use_id: 'sp' } as any)
    await clock.advance(3_000)
    const band = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: true, bodyColumns: 120, maxRows: 10 } } as any)
    expect((await band.find({ type: 'Text', text: /^━+$/ }))?.props).toMatchObject({ color: 'suggestion', dimColor: true })
    expect((await band.find({ type: 'Text', text: /^ 테스트 쓰기 $/ }))?.props.backgroundColor).toBe('suggestion')
  })
})

// 상황판 atom 엿보기: 테스트 키트의 $ 에는 state 가 없다
const PEEK = {
  name: 'peek',
  register(on: any) {
    on('tool.call', { tool: 'Peek' }, async ($: any) => ({ result: JSON.stringify(await $.state.get({ plugin: 'team-board', key: 'beats' })) }))
  },
}

describe('깜빡임', () => {
  test('늦게 끝난 이전 scan 이 새 계획을 옛 값으로 덮지 않는다 (T5 S4·S6)', { plugins: [WORK_PLAN, PEEK] }, async ($, on) => {
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    let hold: ((v: unknown) => void) | null = null
    let armed = false
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', () => ({ value: [...files.keys()].map(p => ({ kind: 'file' as const, name: p.split('/').pop()!, mtimeMs: NOW, size: 0, isLink: false })) }))
    on('fs.read', ($, e: any) => {
      const text = files.get(e.path) ?? ''
      if (!armed) return { value: text }
      armed = false
      // 읽은 순간의 내용을 늦게 돌려준다
      return new Promise(r => { hold = () => r({ value: text }) })
    })
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('turn.start', ($, e: any) => ({ turnId: e.turnId }))
    on('tool.call', () => ({ result: 'ok', text: 'ok' }) as any)

    const plan = (steps: [string, string][]) => ({ v: 1, steps: steps.map(([title, status]) => ({ title, status })), updatedAt: NOW, stale: false, ended: null })
    const setPlan = (p: unknown) => $.tool.call({ tool: 'SetPlan', plan: p, tool_use_id: 'sp' } as any)
    const shown = async () => {
      const r: any = await $.tool.call({ tool: 'Peek', tool_use_id: 'pk' } as any)
      return JSON.parse(r.result).value[0].tasks.map((t: any) => t.status)
    }

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.turn.start({ text: '세 단계', turnId: 't1' } as any)
    await setPlan(plan([['가', 'doing'], ['나', 'todo'], ['다', 'todo']]))
    await clock.advance(3_000)
    expect(await shown()).toEqual(['in_progress', 'pending', 'pending'])

    // 틱의 scan 이 옛 파일을 읽고 멈춘 사이 계획이 바뀌고, 다른 scan(/board fail clear) 이 새 값을 그린다.
    // 실제 엔진은 clock.every 콜백을 겹쳐 부르므로 틱끼리도 같다 (100ms 주기·450ms 본문에서 동시 5개, 2026-10-16 -p 시험)
    armed = true
    const slow = clock.advance(3_000)
    for (let i = 0; i < 100 && !hold; i++) await new Promise(r => (globalThis as any).setTimeout(r, 1))
    expect(hold).not.toBeNull()
    await setPlan(plan([['가', 'done'], ['나', 'doing'], ['다', 'todo']]))
    await clock.advance(1_500)
    await $.command.run({ command: 'board', args: 'fail clear' } as any)
    expect(await shown()).toEqual(['completed', 'in_progress', 'pending'])

    // 멈춰 있던 scan 이 끝나도 새 값이 남아야 한다
    hold!(undefined)
    await slow
    expect(await shown()).toEqual(['completed', 'in_progress', 'pending'])
  })
})

describe('보조 에이전트 (hook)', () => {
  test('시작·도구·토큰·끝을 장부에 쓰고, 메인 상태를 바꾸지 않으며, 사람 프롬프트에 끝난 것을 지운다', async ($, on) => {
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('prompt.submit', ($, e: any) => ({ text: e.text }))
    on('turn.start', ($, e: any) => ({ turnId: e.turnId }))
    on('turn.complete', () => ({ text: '' }))
    // 앞에서 돈 Agent 는 결과에 엔진이 센 토큰이 온다
    on('tool.call', ($, e: any) => (e.tool === 'Agent' ? { result: { status: 'completed', agentId: e.description, totalTokens: 4200 }, text: 'ok' } : { result: 'ok', text: 'ok' }) as any)
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }))
    let spawned = 0
    on('agent.spawn', () => {
      const n = ++spawned
      // 엔진이 에이전트를 띄우는 동안 다른 hook 이 끼어들 수 있게 한 박자 늦게 답한다
      return Promise.resolve().then(() => ({ model: n === 1 ? 'claude-haiku-5-5' : 'claude-sonnet-5-5', agentId: `sub-${n}` }))
    })
    let listed: any[] = []
    on('agent.list', () => ({ value: listed }))
    on('turn.step', async function* ($, e: any) {
      return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn' as const, usage: { ...USAGE, model: 'm' } }
    })
    const step = async (agentId: string) => {
      const s = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 3, agentId } as any)
      for await (const _ of s) { /* 조각 없음 */ }
    }

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    const mine = () => JSON.parse(files.get([...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!)!)

    // 도는 동안의 요청 토큰은 세지 않는다. 엔진이 센 수는 끝날 때 온다
    await step('sub-1')
    await $.agent.spawn({ prompt: '표본 고르기', description: 'G4 표본 고르기', subagentType: 'Explore' } as any)
    await $.turn.start({ turnId: 's1', agentId: 'sub-1' } as any)
    await $.tool.call({ tool: 'Grep', pattern: 'flowArt', agentId: 'sub-1', tool_use_id: 'g1' } as any)
    await clock.advance(3_000)
    expect(mine().agents).toMatchObject([{ id: 'sub-1', desc: 'G4 표본 고르기', type: 'Explore', model: 'claude-haiku-5-5', status: 'working', tokens: 0 }])
    expect(mine().agents[0].tool).toContain('flowArt')
    // 서브의 시작과 도구는 메인 상태·단계를 바꾸지 않는다
    expect(mine().state).toBe('idle')
    expect(mine().step).toBe('')

    await $.command.run({ command: 'board', args: '' } as any)
    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any)
    expect(await pane.find({ type: 'Text', text: /^보조$/ })).toBeDefined()
    // 보조 줄 (T24 B안): 번호, 설명, 모델, 지금 도구, 시간
    expect(await pane.find({ type: 'Text', text: /^↳ 1 $/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^G4 표본 고르기$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^ \(haiku 5\.5\)$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^  .*flowArt/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^  3초$/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /● 보조 1/ })).toBeDefined()
    // 메인 턴은 끝났어도 보조가 돌면 대기가 아니라 보조 기다림
    expect(await pane.find({ type: 'Text', text: /^◐ 보조 기다림 1$/ })).toBeDefined()
    // 0 인 칩은 그리지 않는다 (띠와 같이)
    expect(await pane.find({ type: 'Text', text: /^○ 대기/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /^● 작업/ })).toBeUndefined()
    expect(await pane.find({ type: 'Text', text: /^ 보조 기다림 $/ })).toBeDefined()
    await pane.unmount()
    const band = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } } as any)
    expect((await band.find({ type: 'Text', text: /^ 보조 $/ }))?.props.backgroundColor).toBe(paletteOf('night').work)
    expect(await band.find({ type: 'Text', text: /^보조 1개 기다리는 중$/ })).toBeDefined()
    expect(await band.find({ type: 'Text', text: /^ 대기 $/ })).toBeUndefined()
    await band.unmount()

    // 끝: 엔진 목록 보정과 turn.complete 둘 다 같은 결과
    await $.turn.complete({ reason: 'answer', answer: '골랐습니다.', durationMs: 1, isAborted: false, turnId: 's1', agentId: 'sub-1' } as any)
    expect(mine().agents[0]).toMatchObject({ status: 'done', tool: '' })
    expect(mine().state).toBe('idle')

    const detail = await (async () => {
      await $.command.run({ command: 'board', args: 'order-svc' } as any)
      return $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any)
    })()
    expect(await detail.find({ type: 'Text', text: /^보조 에이전트 $/ })).toBeDefined()
    expect(await detail.find({ type: 'Text', text: /Explore · haiku-5-5 · 끝 · 0:03/ })).toBeDefined()
    await detail.unmount()

    // 작업 알림은 지우지 않고 엔진이 센 토큰을 쓴다. 사람이 보낸 프롬프트에 끝난 에이전트를 지운다
    await $.prompt.submit({ text: '<task-notification>done</task-notification>', origin: { kind: 'task-notification' } } as any)
    expect(mine().agents.length).toBe(1)
    await $.prompt.submit({ text: NOTIFY('sub-1', 36863), origin: { kind: 'task-notification' } } as any)
    expect(mine().agents[0].tokens).toBe(36863)
    // 장부에 없는 에이전트의 알림은 무시한다
    await $.prompt.submit({ text: NOTIFY('zz', 5), origin: { kind: 'task-notification' } } as any)
    expect(mine().agents).toMatchObject([{ id: 'sub-1', tokens: 36863 }])
    await $.prompt.submit({ text: '다음으로 가자', origin: { kind: 'composer' } } as any)
    expect(mine().agents).toEqual([])

    // 끝 신호를 놓쳐도 틱에서 엔진 목록으로 보정한다
    await $.agent.spawn({ prompt: 'x', description: '판정', subagentType: 'general-purpose' } as any)
    listed = [{ id: 'sub-2', status: 'failed' }]
    await clock.advance(3_000)
    expect(mine().agents[0]).toMatchObject({ id: 'sub-2', status: 'failed' })

    // 같은 응답에서 둘을 함께 띄워도 둘 다 장부에 남는다 (실세션 L2: 나중 것이 앞 것을 덮었다)
    await Promise.all([
      $.agent.spawn({ prompt: 'a', description: '하나', subagentType: 'Explore' } as any),
      $.agent.spawn({ prompt: 'b', description: '둘', subagentType: 'Explore' } as any),
    ])
    await Promise.all([
      $.turn.complete({ reason: 'answer', answer: 'a', durationMs: 1, isAborted: false, turnId: 's3', agentId: 'sub-3' } as any),
      $.turn.complete({ reason: 'error', answer: '', durationMs: 1, isAborted: false, turnId: 's4', agentId: 'sub-4' } as any),
    ])
    expect(mine().agents.map((a: any) => `${a.id}:${a.status}`)).toEqual(['sub-2:failed', 'sub-3:done', 'sub-4:failed'])

    // 앞에서 돈 보조는 Agent 도구 결과의 totalTokens 를 쓴다. 보조 안에서 부른 Agent 는 메인 장부를 건드리지 않는다
    await $.tool.call({ tool: 'Agent', description: 'sub-3', agentId: 'sub-4', tool_use_id: 'x0' } as any)
    expect(mine().agents.find((a: any) => a.id === 'sub-3').tokens).toBe(0)
    await $.tool.call({ tool: 'Agent', description: 'sub-3', tool_use_id: 'x1' } as any)
    expect(mine().agents.find((a: any) => a.id === 'sub-3').tokens).toBe(4200)

    // CLI 2.1.304: 작업 알림은 prompt.submit 을 거치지 않고 session.append 로만 온다 (2026-10-20 tmux 탐침: door queue/origin engine, 이어 door prompt/origin task-notification)
    const row = (text: string, over: Record<string, unknown> = {}) =>
      ({ message: { type: 'user', role: 'user', content: [{ type: 'text', text }] }, door: 'queue', origin: { kind: 'engine' }, uuid: `u${Math.random()}`, ...over }) as any
    await $.session.append(row(NOTIFY('sub-4', 27708)))
    expect(mine().agents.find((a: any) => a.id === 'sub-4').tokens).toBe(27708)
    await $.session.append(row(NOTIFY('sub-4', 27708), { door: 'prompt', origin: { kind: 'task-notification' } }))
    expect(mine().agents.find((a: any) => a.id === 'sub-4').tokens).toBe(27708)
    // 보조 에이전트 자기 대화의 줄은 메인 장부를 건드리지 않는다
    await $.session.append(row(NOTIFY('sub-2', 9), { agentId: 'sub-3' }))
    expect(mine().agents.find((a: any) => a.id === 'sub-2').tokens).toBe(0)

    // 다시 시작(claude -r)하면 앞 프로세스의 작업 중 에이전트는 엔진 목록에 없다: 끝(실패)으로 바꾼다.
    // 모듈만 다시 로드된 경우처럼 목록에 있으면 그대로 둔다
    await $.agent.spawn({ prompt: 'c', description: '셋', subagentType: 'Explore' } as any)
    await $.agent.spawn({ prompt: 'd', description: '넷', subagentType: 'Explore' } as any)
    listed = [{ id: 'sub-6', status: 'running' }]
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    expect(mine().agents.filter((a: any) => ['sub-5', 'sub-6'].includes(a.id)).map((a: any) => `${a.id}:${a.status}`)).toEqual(['sub-5:failed', 'sub-6:working'])
  })
})

describe('흐름 복사', () => {
  test('자세히의 흐름 줄을 누르면 원문을 클립보드로. 원문은 몇 초마다 읽는 장부와 따로 둔다', async ($, on) => {
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    const copies: any[] = []
    const toasts: string[] = []
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    const mtimes = new Map<string, number>()
    const writes: string[] = []
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); writes.push(e.path); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: mtimes.get(k) ?? NOW, size: files.get(k)!.length, isLink: false })),
    }))
    on('fs.read', ($, e: any) => {
      if (!files.has(e.path)) throw new Error(`ENOENT: ${e.path}`)
      return { value: files.get(e.path)! }
    })
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('turn.start', ($, e: any) => ({ turnId: e.turnId }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    let copyOk = true
    on('ui.copy', ($, e: any) => { copies.push(e); return { value: copyOk ? { isCopied: true } : { isCopied: false, reason: 'no-clipboard' } } })
    on('prompt.submit', ($, e: any) => ({ text: e.text }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.toast', ($, e: any) => { toasts.push(e.text); return { value: undefined } })

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    const long = '첫 줄 요청입니다.\n' + '가'.repeat(300)
    await $.prompt.submit({ text: long, origin: { kind: 'composer' } } as any)
    await $.turn.complete({ reason: 'answer', answer: '**끝났습니다.**\n' + '나'.repeat(20_000), durationMs: 1, isAborted: false, turnId: 't1' } as any)

    const beatPath = [...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!
    const id = beatPath.split('/').pop()!.replace(/\.json$/, '')
    // 몇 초마다 모든 세션이 읽는 장부에는 원문이 없다. 원문 파일은 .json 이 아니라 옛 판의 scan 도 읽지 않는다
    expect(files.get(beatPath)).not.toContain('가'.repeat(300))
    const flowPath = beatPath.replace(/\.json$/, '.flow')
    expect(files.get(flowPath)).toContain('가'.repeat(300))

    await $.command.run({ command: 'board', args: 'order-svc' } as any)
    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any)
    await pane.press({ key: `flow-${id}-${NOW}-prompt` })
    expect(copies.at(-1)).toMatchObject({ text: long, surface: 'terminal' })
    expect(toasts.at(-1)).toBe('복사함')
    // 원문은 1만 자까지
    await pane.press({ key: `flow-${id}-${NOW}-done` })
    expect(copies.at(-1).text.startsWith('**끝났습니다.**\n나')).toBe(true)
    expect(copies.at(-1).text.length).toBe(10_000)
    expect(copies.at(-1).text.endsWith('…')).toBe(true)
    await pane.unmount()

    // 좁은 패널: (이 세션) 대신 *, ctx 막대는 빼고 % 만 (N2). 넓으면 그대로
    const narrow = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 40 } } as any)
    expect(await narrow.find({ type: 'Text', text: /^\*$/ })).toBeDefined()
    expect(await narrow.find({ type: 'Text', text: /\(이 세션\)/ })).toBeUndefined()
    expect(await narrow.find({ type: 'Text', text: /^ctx \d+%$/ })).toBeDefined()
    await narrow.unmount()
    const wide = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 120 } } as any)
    expect(await wide.find({ type: 'Text', text: /\(이 세션\)/ })).toBeDefined()
    expect(await wide.find({ type: 'Text', text: /^ctx [▰▱]{5} \d+%$/ })).toBeDefined()
    await wide.unmount()

    // 모듈을 다시 불러도(session.start 다시) 앞 원문이 지워지지 않는다
    await clock.advance(1_000)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.prompt.submit({ text: '다음 요청', origin: { kind: 'composer' } } as any)
    expect(files.get(flowPath)).toContain('가'.repeat(300))

    // 붙여 넣은 글을 감싼 엔진 태그는 장부 줄에도 원문에도 남기지 않는다 (2026-10-21 시험 F7)
    await $.prompt.submit({ text: '<pasted_content id="1f0b">\n붙인 첫 줄\n붙인 둘째 줄\n</pasted_content id="1f0b">', origin: { kind: 'composer' } } as any)
    expect(files.get(flowPath)).toContain(JSON.stringify('붙인 첫 줄\n붙인 둘째 줄'))
    expect(files.get(flowPath)).not.toContain('pasted_content')
    expect(files.get(beatPath)).not.toContain('pasted_content')
    expect(files.get(beatPath)).toContain('붙인 첫 줄 붙인 둘째 줄')

    // 원문도 장부처럼 비밀 값을 가린다
    await $.prompt.submit({ text: 'DB_PASSWORD=hunter2 로 접속해 줘', origin: { kind: 'composer' } } as any)
    expect(files.get(flowPath)).not.toContain('hunter2')
    expect(files.get(flowPath)).toContain('DB_PASSWORD=***')

    // 지울 수 없어(fs 에 삭제 없음) 12시간 넘은 다른 세션의 원문 파일은 비운다. 비운 뒤에는 다시 쓰지 않는다
    const dir = flowPath.slice(0, flowPath.lastIndexOf('/'))
    files.set(`${dir}/old-1.flow`, JSON.stringify({ '1:prompt': '오래된 원문' }))
    mtimes.set(`${dir}/old-1.flow`, NOW - 13 * 60 * 60_000)
    files.set(`${dir}/new-1.flow`, JSON.stringify({ '1:prompt': '최근 원문' }))
    await clock.advance(3_000)
    expect(files.get(`${dir}/old-1.flow`)).toBe('{}')
    expect(files.get(`${dir}/new-1.flow`)).toContain('최근 원문')
    const emptied = writes.filter(w => w.endsWith('/old-1.flow')).length
    await clock.advance(3_000)
    expect(writes.filter(w => w.endsWith('/old-1.flow')).length).toBe(emptied)

    // 원문이 없는 줄(이전 판이 쓴 줄)은 장부의 줄을 복사한다. 복사가 안 되면 엔진 이유를 그대로
    files.set(flowPath, '{}')
    copyOk = false
    const pane2 = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any)
    await pane2.press({ key: `flow-${id}-${NOW}-prompt` })
    expect(toasts.at(-1)).toBe('복사 못 함: no-clipboard')
    await pane2.unmount()
  })
})

describe('막힌 보내기', () => {
  test('다른 mod 가 보내기를 막으면(drop) 작업 중으로 바꾼 것과 결정 기록을 되돌린다', async ($, on) => {
    const files = new Map<string, string>()
    mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', () => ({ value: [] }))
    on('fs.read', ($, e: any) => {
      if (!files.has(e.path)) throw new Error(`ENOENT: ${e.path}`)
      return { value: files.get(e.path)! }
    })
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('turn.start', ($, e: any) => ({ turnId: e.turnId }))
    on('prompt.submit', ($, e: any) => (e.text.startsWith('HOLD') ? { drop: 'prompt-coach: 질문에 답하면 다듬어요' } : { text: e.text }))
    on('turn.complete', () => ({ text: '' }))
    const mine = () => JSON.parse(files.get([...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!)!)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.prompt.submit({ text: '첫 요청', origin: { kind: 'composer' } } as any)
    await $.turn.complete({ reason: 'answer', answer: '범위는 어느 쪽으로 할까요?', durationMs: 1, isAborted: false, turnId: 't1' } as any)
    const before = mine()
    expect(before.state).toBe('asking')

    // 결정을 기다리던 중 막힌 보내기: 결정 대기 그대로, 결정 기록도 요청 기록도 남지 않는다
    const r = await $.prompt.submit({ text: 'HOLD 모듈 전체', origin: { kind: 'composer' } } as any)
    expect(r).toMatchObject({ drop: 'prompt-coach: 질문에 답하면 다듬어요' })
    expect(mine()).toMatchObject({ state: 'asking', question: before.question, prompt: before.prompt, step: before.step, decisions: before.decisions, timeline: before.timeline, recent: before.recent })

    // 대기 중 막힌 보내기: 작업 중으로 바뀌지 않는다
    await $.prompt.submit({ text: '모듈 전체', origin: { kind: 'composer' } } as any)
    await $.turn.complete({ reason: 'answer', answer: '끝났습니다.', durationMs: 1, isAborted: false, turnId: 't2' } as any)
    const idle = mine()
    expect(idle.state).toBe('idle')
    await $.prompt.submit({ text: 'HOLD 다음 일', origin: { kind: 'composer' } } as any)
    expect(mine()).toMatchObject({ state: 'idle', prompt: idle.prompt, timeline: idle.timeline })
  })
})

const PROMPT_COACH = {
  name: 'prompt-coach',
  register(on: any) {
    on('tool.call', { tool: 'SetPending' }, async ($: any, e: any) => {
      await $.state.set({ plugin: 'prompt-coach', key: 'pending' }, e.question)
      return { result: 'ok' }
    })
  },
}

describe('prompt-coach 연동', () => {
  test('prompt-coach 가 답을 기다리는 질문은 결정 필요로, 끝나면 앞 상태(대기 또는 Claude 의 질문)로 돌아간다', { plugins: [PROMPT_COACH] }, async ($, on) => {
    const files = new Map<string, string>()
    mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', () => ({ value: [] }))
    on('fs.read', ($, e: any) => {
      if (!files.has(e.path)) throw new Error(`ENOENT: ${e.path}`)
      return { value: files.get(e.path)! }
    })
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('turn.start', ($, e: any) => ({ turnId: e.turnId }))
    on('prompt.submit', ($, e: any) => ({ text: e.text }))
    on('turn.complete', () => ({ text: '' }))
    const mine = () => JSON.parse(files.get([...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!)!)
    const pending = (question: string | null) => $.tool.call({ tool: 'SetPending', question } as any)

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.prompt.submit({ text: '첫 요청', origin: { kind: 'composer' } } as any)
    await $.turn.complete({ reason: 'answer', answer: '끝났습니다.', durationMs: 1, isAborted: false, turnId: 't1' } as any)
    expect(mine().state).toBe('idle')

    await pending('prompt-coach: 범위는?')
    expect(mine()).toMatchObject({ state: 'asking', question: 'prompt-coach: 범위는?' })
    await pending('prompt-coach: 완료 기준은?')
    expect(mine()).toMatchObject({ state: 'asking', question: 'prompt-coach: 완료 기준은?' })
    await pending(null)
    expect(mine()).toMatchObject({ state: 'idle', question: '' })

    // Claude 의 질문을 기다리던 중이면 끝난 뒤 그 질문으로 돌아간다
    await $.prompt.submit({ text: '다음 요청', origin: { kind: 'composer' } } as any)
    await $.turn.complete({ reason: 'answer', answer: '범위는 어느 쪽으로 할까요?', durationMs: 1, isAborted: false, turnId: 't2' } as any)
    await pending('prompt-coach: 어떤 에러인가요?')
    expect(mine().question).toBe('prompt-coach: 어떤 에러인가요?')
    await pending(null)
    expect(mine()).toMatchObject({ state: 'asking', question: '범위는 어느 쪽으로 할까요?' })
  })
})

describe('자기 세션 표시', () => {
  test('띠와 보드는 자기 세션의 상태를 다음 파일 읽기(3초)를 기다리지 않고 바로 보인다. 이름(·2)은 그대로', { plugins: [PROMPT_COACH, WORK_PLAN] }, async ($, on) => {
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('turn.start', ($, e: any) => ({ turnId: e.turnId }))
    on('prompt.submit', ($, e: any) => ({ text: e.text }))
    on('turn.complete', () => ({ text: '' }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.render', { component: 'AbovePrompt' }, ($, e: any) => $.ui.resolve(e).Text({ children: 'OTHER-MOD-BAND' }))
    const pending = (question: string | null) => $.tool.call({ tool: 'SetPending', question } as any)
    const bandHas = async (re: RegExp) => {
      const band = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 160 } } as any)
      const found = await band.find({ type: 'Text', text: re })
      await band.unmount()
      return found !== undefined
    }

    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    // 같은 이름의 다른 세션이 있으면 id 순서로 뒤인 이 세션 이름에 ·2 가 붙는다
    const mineKey = [...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!
    const other = { ...JSON.parse(files.get(mineKey)!), id: 'a-other', updatedAt: NOW - 1 }
    files.set(mineKey.replace(/me-[0-9a-f]{8}\.json$/, 'other-00000000.json'), JSON.stringify(other))
    await $.prompt.submit({ text: '첫 요청', origin: { kind: 'composer' } } as any)
    await $.turn.complete({ reason: 'answer', answer: '끝났습니다.', durationMs: 1, isAborted: false, turnId: 't1' } as any)
    await clock.advance(3_000)
    expect(await bandHas(/prompt-coach: 범위는/)).toBe(false)

    // 시계를 돌리지 않는다: 다음 파일 읽기 전
    await pending('prompt-coach: 범위는?')
    expect(await bandHas(/prompt-coach: 범위는/)).toBe(true)
    const mineId = JSON.parse(files.get(mineKey)!).id as string
    expect(mineId > 'a-other').toBe(true)
    expect(await bandHas(/·2/)).toBe(true)
    await $.command.run({ command: 'board', args: '' } as any)
    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any)
    expect(await pane.find({ type: 'Text', text: /prompt-coach: 범위는/ })).toBeDefined()
    await pane.unmount()
    await pending(null)
    expect(await bandHas(/prompt-coach: 범위는/)).toBe(false)

    // 계획 보고도 바로: 다음 파일 읽기 전에도 칸이 단계 글이 아니라 막대(지금 단계 알약)로 보인다
    await $.prompt.submit({ text: '두 번째 요청', origin: { kind: 'composer' } } as any)
    await $.turn.start({ text: '두 번째 요청', turnId: 't2' } as any)
    const plan = { v: 1, steps: [{ title: '읽기', status: 'doing' }, { title: '고치기', status: 'todo' }], updatedAt: NOW, stale: false, ended: null }
    await $.tool.call({ tool: 'SetPlan', plan, tool_use_id: 'sp' } as any)
    expect(await bandHas(/^ 읽기 $/)).toBe(true)
    expect(await bandHas(/할 일: 읽기/)).toBe(false)
  })
})

describe('결정 대화상자 위 맥락 (T34 A1)', () => {
  // 대화상자 둘레 그리기는 엔진 노드가 있어야 해서 테스트 키트로는 띄우지 못한다 (실화면 시험으로 확인). 내용만 여기서
  test('요청·계획 단계·직전 Claude 글을 줄마다 78칸 안으로, 아는 것이 없으면 []', async () => {
    const tasks = [
      { id: '1', subject: '조사', status: 'completed' as const },
      { id: '2', subject: '만료 정하기', status: 'in_progress' as const },
      { id: '3', subject: '구현', status: 'pending' as const },
    ]
    const said = '조회 로그를 보니 같은 주문을 3분 안에 다시 읽는 비율이 82%입니다. 만료를 정해야 구현을 시작할 수 있어요. '.repeat(3)
    const lines = askContext({ state: 'asking', step: '질문 중', prompt: '주문 조회 캐시를 정리해 줘', recent: [{ role: 'user', text: '주문 조회 캐시를 정리해 줘' }, { role: 'assistant', text: said }] }, tasks)
    expect(lines.slice(0, 2)).toEqual(['요청 · 주문 조회 캐시를 정리해 줘', '계획 · 2/3 만료 정하기'])
    expect(lines[2]).toMatch(/^직전 · 조회 로그를 보니.*…$/)
    // 40칸마다 한 줄로 세는 대화상자 규칙: 머리 1 + 줄마다 2 = 7줄 이하 (12줄 넘으면 엔진 것만 그려진다)
    for (const l of lines) expect(cells(l)).toBeLessThanOrEqual(78)
    expect(askContext({ state: 'asking', step: '질문 중', prompt: '', recent: [] }, [])).toEqual([])
    // 사용자의 글은 직전 글로 쓰지 않는다
    expect(askContext({ state: 'asking', step: '질문 중', prompt: '', recent: [{ role: 'user', text: '답' }] }, [])).toEqual([])
    // 이번 요청 뒤에 한 말이 없으면 마지막 도구 작업. 지난 턴의 답은 직전 글이 아니다 (2026-10-26 실화면: 말없이 읽고 바로 물으면 비었다)
    const lastTurn = [{ role: 'assistant' as const, text: '지난 턴의 답' }, { role: 'user' as const, text: 'README 읽고 물어봐' }]
    expect(askContext({ state: 'asking', step: '질문 중', prompt: '', recent: lastTurn, lastTool: 'Read README.md' }, [])).toEqual(['직전 · Read README.md'])
    expect(askContext({ state: 'asking', step: '질문 중', prompt: '', recent: lastTurn }, [])).toEqual([])
    expect(askContext({ state: 'asking', step: '질문 중', prompt: '', recent: [...lastTurn, { role: 'assistant', text: '읽었습니다' }], lastTool: 'Read README.md' }, [])).toEqual(['직전 · 읽었습니다'])
    // 이 세션의 Claude 가 AskUserQuestion 으로 묻는 중일 때만: 다른 mod 의 $.ui.ask(prompt-coach 질문 등)도 같은 대화상자라 그 위에는 그리지 않는다
    expect(askContext({ state: 'asking', step: '', prompt: '주문 조회 캐시를 정리해 줘', recent: [] }, tasks)).toEqual([])
    expect(askContext({ state: 'working', step: '질문 중', prompt: '주문 조회 캐시를 정리해 줘', recent: [] }, tasks)).toEqual([])
  })
})

describe('같은 실패 반복 (T34 A4)', () => {
  test('수정 없이 같은 명령이 3번 연속 실패하면 Claude 에게 알리고 카드에 막힘 줄. 사이에 고치면 다시 센다. 통과하거나 사람이 요청하면 지운다', async ($, on) => {
    const pal = paletteOf('night')
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('prompt.submit', ($, e: any) => ({ text: e.text }))
    let pass = false
    let blocked = ''
    on('tool.call', ($, e: any) => (e.tool === 'Bash'
      ? blocked ? { result: `Error: ${blocked}`, text: blocked, isError: true } : (pass ?{ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' } : { result: { stdout: '', stderr: 'FAILED', interrupted: false }, text: 'Exit code 1', isError: true })
      : { result: 'ok', text: 'ok' }) as any)
    const mine = () => JSON.parse(files.get([...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!)!)
    const bash = (command: string, agentId?: string) => $.tool.call({ tool: 'Bash', command, tool_use_id: 'b', ...(agentId ? { agentId } : {}) } as any) as Promise<any>
    const edit = () => $.tool.call({ tool: 'Edit', file_path: '/repo/order-svc/src/a.ts', old_string: 'a', new_string: 'b', tool_use_id: 'e' } as any)
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)

    // 고치면서 돌리는 것은 막힘이 아니다
    await bash('./gradlew test --tests A'); await edit()
    await bash('./gradlew test --tests A'); await edit()
    expect((await bash('./gradlew test --tests A')).context ?? []).toEqual([])
    // 수정 없이 같은 명령(키)이 3번째 실패: Claude 에게 한 줄
    // 2번째까지는 조용하다
    expect((await bash('./gradlew test --tests B')).context ?? []).toEqual([])
    await clock.advance(3_000)
    expect(mine().stuck ?? null).toBeNull()
    const third = await bash('./gradlew test 2>&1 | tail -5')
    expect(third.context?.join('\n')).toContain('수정 없이 3번 연속 실패')
    // 다른 명령의 실패나 보조 에이전트의 실패는 세지 않는다
    expect((await bash('./gradlew test', 'sub-1')).context ?? []).toEqual([])
    await clock.advance(3_000)
    expect(mine().stuck).toMatchObject({ key: './gradlew test', count: 3 })

    await $.command.run({ command: 'board', args: '' } as any)
    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 100 } } as any)
    expect((await pane.find({ type: 'Text', text: '✕ ./gradlew test · 수정 없이 3번 연속 실패' }))?.props.color).toBe(pal.bad)
    await pane.unmount()

    // 통과하면 지운다
    pass = true
    await bash('./gradlew test')
    await clock.advance(3_000)
    expect(mine().stuck ?? null).toBeNull()

    // 사람이 요청을 보내도 지운다
    pass = false
    for (let i = 0; i < 3; i++) await bash('npm test')
    await clock.advance(3_000)
    expect(mine().stuck).toMatchObject({ key: 'npm test' })
    await $.prompt.submit({ text: '다른 방법으로 해 봐', origin: { kind: 'composer' } } as any)
    await clock.advance(3_000)
    expect(mine().stuck ?? null).toBeNull()
    // 마지막 요청 시각은 흐름(12개)과 따로 둔다 (T34 D2)
    expect(mine().promptAt).toBe(mine().timeline.findLast((t: any) => t.kind === 'prompt').at)

    // 사이에 다른 명령이 실패하면 처음부터 센다 (연속이 아니다)
    await bash('make a'); await bash('make a')
    expect((await bash('npm test')).context ?? []).toEqual([])
    expect((await bash('make a')).context ?? []).toEqual([])

    // 돌지 않은 명령(분류기 판정 없음·권한 거절)은 실패로 세지도, 연속을 끊지도 않는다. 돈 명령의 오류는 'Exit code N' 으로 시작한다
    // (2026-10-26: 실사용 막힘 1건이 auto 모드 분류기 오류 3번이었다)
    blocked = 'The server-side auto mode classifier gave no verdict (error), so auto mode cannot determine the safety of Bash.'
    for (let i = 0; i < 3; i++) expect((await bash('grep -rn x wiki')).context ?? []).toEqual([])
    blocked = ''
    await bash('cargo test'); await bash('cargo test')
    blocked = 'Permission for this action was denied by the auto mode classifier.'
    await bash('cargo test')
    blocked = ''
    expect((await bash('cargo test')).context?.join('\n')).toContain('수정 없이 3번 연속 실패')
  })
})

describe('변경 요약 (T34 B2)', () => {
  test('git status -b 와 diff --shortstat 을 읽는다', async () => {
    expect(parseGitStatus('## feat/cache...origin/feat/cache [ahead 2, behind 1]\n M src/a.ts\n?? src/new.ts\n')).toEqual({ branch: 'feat/cache', ahead: 2, behind: 1, files: 2 })
    expect(parseGitStatus('## main\n')).toEqual({ branch: 'main', ahead: 0, behind: 0, files: 0 })
    expect(parseGitStatus('## HEAD (no branch)\n M a\n')).toEqual({ branch: 'HEAD', ahead: 0, behind: 0, files: 1 })
    expect(parseGitStatus('')).toBeNull()
    expect(parseShortstat(' 3 files changed, 120 insertions(+), 30 deletions(-)\n')).toEqual({ add: 120, del: 30 })
    expect(parseShortstat(' 1 file changed, 1 deletion(-)\n')).toEqual({ add: 0, del: 1 })
    expect(parseShortstat('')).toEqual({ add: 0, del: 0 })
    expect(gitText({ branch: 'feat/cache', ahead: 2, behind: 0, files: 3, add: 120, del: 30 })).toBe('feat/cache ↑2 · 커밋 안 함 3파일 +120 −30')
    expect(gitText({ branch: 'main', ahead: 0, behind: 1, files: 0, add: 0, del: 0 })).toBe('main ↓1')
    // 깨끗하고 앞선 커밋도 없으면 빈 글 (줄을 숨긴다)
    expect(gitText({ branch: 'main', ahead: 0, behind: 0, files: 0, add: 0, del: 0 })).toBe('')
  })

  test('턴이 끝나면 git 상태를 기록하고 자세히에 변경 줄. 다른 작업 폴더(워크트리) 세션은 카드에도', async ($, on) => {
    const files = new Map<string, string>()
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    const ran: string[][] = []
    on('process.run', ($, e: any) => {
      ran.push(e.argv)
      const out = e.argv.includes('status') ? '## feat/cache...origin/feat/cache [ahead 2]\n M src/a.ts\n M src/b.ts\n' : e.argv.includes('--shortstat') ? ' 2 files changed, 12 insertions(+), 3 deletions(-)\n' : ''
      return { value: { stdout: out, stderr: '', exitCode: out ? 0 : 1, isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('turn.complete', () => ({ text: '' }))
    const DIR = '/home/me/.claude/team-board/repo-order-svc'
    files.set(`${DIR}/wt.json`, JSON.stringify(beat({ id: 'wt', name: 'wt-2', cwd: '/repo/order-svc-wt', git: { branch: 'fix/x', ahead: 1, behind: 0, files: 0, add: 0, del: 0, at: NOW } })))
    files.set(`${DIR}/same.json`, JSON.stringify(beat({ id: 'same', name: 'sub-3', cwd: '/repo/order-svc', git: { branch: 'feat/cache', ahead: 2, behind: 0, files: 2, add: 12, del: 3, at: NOW } })))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await $.turn.complete({ reason: 'answer', answer: '끝났습니다.', durationMs: 1, isAborted: false, turnId: 't' } as any)
    await clock.advance(3_000)
    expect(ran.some(a => a.join(' ') === 'git -C /repo/order-svc status --porcelain=v1 -b')).toBe(true)
    const mine = JSON.parse(files.get([...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!)!)
    expect(mine.git).toEqual({ branch: 'feat/cache', ahead: 2, behind: 0, files: 2, add: 12, del: 3, at: NOW })

    await $.command.run({ command: 'board', args: '' } as any)
    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 100 } } as any)
    // 같은 폴더 세션은 카드에 같은 줄을 되풀이하지 않는다. 다른 워크트리만
    expect(await pane.find({ type: 'Text', text: 'fix/x ↑1' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /^feat\/cache/ })).toBeUndefined()
    await pane.unmount()
    await $.command.run({ command: 'board', args: 'order-svc' } as any)
    const detail = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 100 } } as any)
    expect(await detail.find({ type: 'Text', text: 'feat/cache ↑2 · 커밋 안 함 2파일 +12 −3' })).toBeDefined()
    expect(await detail.find({ type: 'Text', text: /^변경$/ })).toBeDefined()
    await detail.unmount()
  })
})

describe('카드 캐릭터 고르기 (T43)', () => {
  test('parseLook 은 한글·영문 이름을 받고 모르는 값은 null', () => {
    expect(parseLook('말랑이')).toBe('blob')
    expect(parseLook('삐삐')).toBe('bot')
    expect(parseLook('둥실')).toBe('ghost')
    expect(parseLook('섞기')).toBe('mix')
    expect(parseLook('blob')).toBe('blob')
    expect(parseLook(' Ghost ')).toBe('ghost')
    expect(parseLook('mix')).toBe('mix')
    expect(parseLook('')).toBeNull()
    expect(parseLook('cat')).toBeNull()
  })
  test('/board 캐릭터 는 store 에 남기고, 모르는 값이면 지금 값과 고를 값을 보인다', async ($, on) => {
    mock.clock(on, { now: NOW })
    const store = new Map<string, unknown>()
    on('store.get', ($, e: any) => ({ value: store.get(e.key) }))
    on('store.set', ($, e: any) => { store.set(e.key, e.value); return { value: undefined } })
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.cwd', () => ({ value: '/repo/a' }))
    on('session.repo', () => ({ value: { root: '/repo/a', remote: null, internal: false, name: 'a' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', () => ({ value: undefined }))
    on('fs.list', () => ({ value: [] }))
    on('fs.read', () => ({ value: '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/a' } as any)
    const shown = await $.command.run({ command: 'board', args: '캐릭터' } as any)
    expect(shown.text).toContain('지금 말랑이')
    expect(shown.text).toContain('말랑이 | 삐삐 | 둥실 | 섞기')
    expect((await $.command.run({ command: 'board', args: '캐릭터 고양이' } as any)).text).toContain('고를 수 있는 값')
    expect((await $.command.run({ command: 'board', args: '캐릭터 둥실' } as any)).text).toBe('카드 캐릭터를 둥실(으)로 바꿨어요.')
    expect(store.get('look')).toBe('ghost')
    expect((await $.command.run({ command: 'board', args: 'look mix' } as any)).text).toBe('세션 이름으로 캐릭터와 색을 섞어요.')
    expect(store.get('look')).toBe('mix')
    expect((await $.command.run({ command: 'board', args: 'look' } as any)).text).toContain('지금 섞기')
  })
})

describe('리더 왕관 (T43)', () => {
  const peer = (id: string, name: string, updatedAt = 1_000_000) => ({ ...emptyBeat(id, name, '/repo/a'), updatedAt })
  test('SendMessage 받는 이름을 보드의 다른 세션 id 로, ref 는 떼고 보드에 없는 이름은 null', () => {
    const list = [peer('me', 'devflow1'), peer('s1', 'devflow-sub')]
    expect(leadTarget('devflow-sub', list, 'me')).toBe('s1')
    expect(leadTarget('devflow-sub [5cd459]', list, 'me')).toBe('s1')
    expect(leadTarget('devflow1', list, 'me')).toBeNull()
    expect(leadTarget('researcher', list, 'me')).toBeNull()
    expect(leadTarget('main', list, 'me')).toBeNull()
    // 나에게 일을 맡긴 리더에게 보내는 결과 보고는 리더로 치지 않는다
    const led = [peer('me', 'devflow-sub'), { ...peer('L', 'devflow1'), leads: ['me'] }]
    expect(leadTarget('devflow1', led, 'me')).toBeNull()
  })
  test('이름을 안 정한 세션은 엔진 주소(addr)로 찾고, 끝난 세션은 치지 않는다 (T46)', () => {
    const list = [peer('me', 'devflow1'), { ...peer('s1', 'mate-b'), addr: 'mate-b-62' }, { ...peer('old', 'mate-b-9a'), state: 'ended' as const }]
    expect(leadTarget('mate-b-62 [ce3473]', list, 'me')).toBe('s1')
    // 보드 이름은 엔진 주소가 아니다
    expect(leadTarget('mate-b', list, 'me')).toBeNull()
    expect(leadTarget('mate-b-9a', list, 'me')).toBeNull()
    // 같은 주소가 둘이면 어느 쪽인지 모른다
    expect(leadTarget('mate-b-62', [...list, { ...peer('s2', 'other'), addr: 'mate-b-62' }], 'me')).toBeNull()
  })
  test('살아 있는 팀메이트에 일을 맡겼으면 왕관, 팀메이트가 없거나 소식없음이면 보조가 도는 동안만', () => {
    const now = 1_000_000
    const sub = peer('s1', 'devflow-sub', now)
    const lead = { ...peer('me', 'devflow1', now), leads: ['s1'] }
    expect(crowned(lead, [lead, sub], now)).toBe(true)
    expect(crowned(lead, [lead], now)).toBe(false)
    expect(crowned(lead, [lead, { ...sub, updatedAt: 0 }], now)).toBe(false)
    const plain = peer('x', 'solo', now)
    expect(crowned(plain, [plain], now)).toBe(false)
    const helping = { ...plain, agents: [{ id: 'a1', desc: '검수', type: 'agent', model: '', status: 'working' as const, tool: '', startedAt: now, endedAt: null, tokens: 0 }] }
    expect(crowned(helping, [helping], now)).toBe(true)
  })
  test('보드의 다른 세션에 SendMessage 가 전해지면 leads 에 남고 카드 캐릭터에 왕관', async ($, on) => {
    const DIR = '/home/me/.claude/team-board/repo-order-svc'
    const files = new Map<string, string>()
    files.set(`${DIR}/peer.json`, JSON.stringify({ ...beat({ id: 'peer', name: 'sub-2', state: 'working' }), addr: 'order-svc-62' }))
    files.set(`${DIR}/peer2.json`, JSON.stringify({ ...beat({ id: 'peer2', name: 'sub-3', state: 'idle' }), addr: 'order-svc-7a' }))
    // 엔진 세션 목록: 이 세션의 주소 이름은 여기서 읽는다
    files.set('/home/me/.claude/sessions/111.json', JSON.stringify({ sessionId: 'other', name: 'order-svc-62' }))
    files.set('/home/me/.claude/sessions/222.json', JSON.stringify({ sessionId: 'me', name: 'order-svc-1f', nameSource: 'derived' }))
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('tool.call', () => ({ result: 'ok' }))
    // 엔진: 정확한 주소만 전한다 (보드 이름 sub-2 는 주소가 아니라 거절). refuse 면 받는 쪽이 거부
    let refuse = false
    on('session.send', ($, e: any) => (!refuse && /^(order-svc-62|order-svc-7a|researcher)( \[|$)/.test(e.to) ? { isDelivered: true } : { isDelivered: false, reason: `No agent is named '${e.to}' exactly.` }))
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    const mine = () => JSON.parse(files.get([...files.keys()].find(k => /\/me-[0-9a-f]{8}\.json$/.test(k))!)!)
    await clock.advance(3_000)
    expect(mine().addr).toBe('order-svc-1f')

    const send = (to: string) => $.session.send({ to, text: '조각 맡김', origin: { kind: 'model' } } as any)
    // 보드에 없는 이름(보조 에이전트)과 거절된 보내기는 리더로 치지 않는다
    await send('researcher')
    expect(await send('sub-2')).toMatchObject({ isDelivered: false })
    refuse = true
    expect(await send('order-svc-62 [5cd459]')).toMatchObject({ isDelivered: false })
    refuse = false
    await clock.advance(3_000)
    expect(mine().leads).toBeUndefined()
    // 한 응답에서 두 세션에 동시에 보내도 둘 다 남는다
    await Promise.all([send('order-svc-62 [5cd459]'), send('order-svc-7a')])
    await clock.advance(3_000)
    expect([...mine().leads].sort()).toEqual(['peer', 'peer2'])

    // 엔진 목록 파일이 다른 세션 것이 되면(프로세스 끝, 번호 재사용) 다시 찾는다
    files.set('/home/me/.claude/sessions/222.json', JSON.stringify({ sessionId: 'someone', name: 'x-00' }))
    files.set('/home/me/.claude/sessions/333.json', JSON.stringify({ sessionId: 'me', name: 'order-svc-c4' }))
    await clock.advance(16_000)
    await clock.advance(16_000)
    expect(mine().addr).toBe('order-svc-c4')

    await $.command.run({ command: 'board', args: '' } as any)
    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any)
    const crowns = (await pane.findAll({ type: 'Raster' })).map(r => {
      const bytes = Uint8Array.from(atob(String(r.props.cells)), c => c.charCodeAt(0))
      return Array.from(new Uint32Array(bytes.buffer)).includes(0xfde047)
    })
    // 내 카드만 왕관, 맡겨진 sub-2·sub-3 은 맨머리
    expect(crowns.filter(Boolean).length).toBe(1)
    expect(crowns.length).toBe(3)
    // 머리가 한 줄뿐이어도 왕관 카드는 4행, 왕관 없는 짧은 카드는 3행
    expect((await pane.findAll({ type: 'Raster' })).map(r => r.props.rows).sort()).toEqual([3, 3, 4])
  })
  test('작업 중 타일만 0.8초마다 blit 으로 프레임을 바꾸고, 거부되면(패널 닫힘) 멈춘다', async ($, on) => {
    const DIR = '/home/me/.claude/team-board/repo-order-svc'
    const files = new Map<string, string>()
    files.set(`${DIR}/peer.json`, JSON.stringify(beat({ id: 'peer', name: 'sub-2', state: 'working' })))
    files.set(`${DIR}/idle.json`, JSON.stringify(beat({ id: 'idle', name: 'sub-3', state: 'idle' })))
    const clock = mock.clock(on, { now: NOW })
    mock.store(on)
    on('session.start', ($, e) => ({ cwd: e.cwd }))
    on('session.usage', () => ({ value: { startedAt: 0, rateLimits: [], context: { tokens: 24_000, window: 200_000, percent: 12 } } }))
    on('session.cwd', () => ({ value: '/repo/order-svc' }))
    on('session.repo', () => ({ value: { root: '/repo/order-svc', remote: null, internal: false, name: 'order-svc' } }))
    on('session.id', () => ({ value: 'me' }))
    on('session.messages', () => ({ value: [] }))
    on('env.get', () => ({ value: '/home/me' }))
    on('fs.write', ($, e: any) => { files.set(e.path, e.text); return { value: undefined } })
    on('fs.list', ($, e: any) => ({
      value: [...files.keys()].filter(k => k.startsWith(e.path + '/')).map(k => ({ name: k.split('/').pop()!, kind: 'file' as const, mtimeMs: NOW, size: 0, isLink: false })),
    }))
    on('fs.read', ($, e: any) => ({ value: files.get(e.path) ?? '' }))
    on('process.run', () => ({ value: { stdout: '', stderr: '', exitCode: 1, isStdoutTruncated: false, isStderrTruncated: false } }))
    on('command.register', ($, e: any) => ({ value: { command: e.name } }))
    on('ui.open', () => ({ value: { isPlaced: true } }))
    const blits: { key: string; cells: string }[] = []
    let mounted = true
    on('ui.blit', ($, e: any) => {
      blits.push({ key: e.key, cells: e.cells })
      return { value: mounted ? {} : { deny: 'not mounted' } }
    })
    await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/repo/order-svc' } as any)
    await clock.advance(3_000)

    await $.command.run({ command: 'board', args: '' } as any)
    const pane = await $.ui.mount({ plugin: 'team-board', surface: 'terminal', component: 'Pane', requestId: 'team-board', props: { bodyColumns: 90 } } as any)
    const first = (await pane.findAll({ type: 'Raster' })).length
    expect(first).toBe(3)
    blits.length = 0
    await clock.advance(800)
    // 작업 중인 sub-2 만, 대기 중인 sub-3·이 세션은 칠하지 않는다
    expect(blits.map(b => b.key)).toEqual(['icon-peer'])
    await clock.advance(800)
    expect(blits.length).toBe(2)
    expect(blits[0]!.cells).not.toBe(blits[1]!.cells)
    mounted = false
    await clock.advance(800)
    await clock.advance(800)
    expect(blits.length).toBe(3)
  })
})
