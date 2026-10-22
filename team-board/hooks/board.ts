// 순수 함수만 둔다. $ 에 의존하지 않아 테스트와 이식이 쉽다.
import type { Beat, Decision, Event, ExplainKind, RecentLine, SubAgent, Task, WorkPlan } from '../types'
import { cells, clip, EXPLAIN_JSON_SPEC, STE_JSON_SPEC } from './diagram'
import { redact } from './failure'
import { bar } from './palette'

// 살아 있는 세션은 1분마다 기록하므로, 3분 넘게 소식이 없으면 흐리게 표시한다.
export const STALE_MS = 3 * 60_000
export const HIDE_MS = 12 * 60 * 60_000 // 12시간 지나면 숨김
export const MAX_TIMELINE = 12
export const MAX_DECISIONS = 20

export function emptyBeat(id: string, name: string, cwd: string): Beat {
  return {
    id, name, cwd, state: 'idle', step: '', prompt: '', last: '', question: '', recent: [],
    contextPct: null, tasks: [], decisions: [], timeline: [], edits: 0, files: [], fail: null, agents: [], cacheAt: null, updatedAt: 0,
  }
}

// 프롬프트 캐시는 쓸 때마다 수명이 다시 시작된다. Claude Code 메인 세션은 1시간 캐시를 쓴다
// (2026-10-12 대화 기록 실측: 캐시 쓰기 1h 678건, 5m 6건). mods API 는 캐시 수명을 알려 주지 않는다.
export const CACHE_TTL_MS = 60 * 60_000
/** 남은 시간이 이 이하면 띠에서 알린다. */
export const CACHE_WARN_MS = 10 * 60_000

/** 캐시가 남은 시간(ms). 기록이 없으면 null, 만료됐으면 0 이하. */
export function cacheLeft(cacheAt: number | null, now: number): number | null {
  return cacheAt === null ? null : CACHE_TTL_MS - (now - cacheAt)
}

/** 보드에 쓰는 글: 분은 올림 (1분 미만도 1분). */
export function cacheText(left: number | null): string {
  if (left === null) return ''
  return left <= 0 ? '캐시 만료' : `캐시 ${cacheMinutes(left)}`
}

/** 남은 분만: 팀 창 칸은 배지가 "캐시" 를 맡으므로 분만 쓴다. */
export function cacheMinutes(left: number): string {
  return `${Math.ceil(left / 60_000)}분`
}

/** 띠에서 알릴지: 쉬는 세션의 캐시가 곧 만료될 때만. 일하는 중이면 곧 갱신되고, 이미 만료된 건 보드에만 둔다. */
export function cacheWarn(b: Beat, now: number): boolean {
  const left = cacheLeft(b.cacheAt, now)
  return b.state !== 'working' && left !== null && left > 0 && left <= CACHE_WARN_MS
}

/** 예전 버전이 쓴 파일도 읽을 수 있게 빈 칸을 채운다. */
export function normalize(raw: Partial<Beat>): Beat {
  return { ...emptyBeat(raw.id ?? '?', raw.name ?? '?', raw.cwd ?? ''), ...raw } as Beat
}

/** 저장소 루트를 폴더 이름으로 쓸 수 있게 바꾼다. 워크트리도 같은 루트를 가진다. */
export function repoKey(root: string): string {
  return root.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'no-repo'
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** 모델이 섞어 쓰는 마크다운 기호를 터미널 표시용으로 걷어낸다. */
export function stripMarkdown(text: string): string {
  return text
    .replace(/^```[^\n]*$/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
}

/** 붙여 넣은 글을 감싼 엔진 태그(`<pasted_content id="…">`, `</pasted_content id="…">`)를 빼고 글만 남긴다. 태그에 붙은 줄바꿈 하나도 함께 뺀다 */
export function unwrapPaste(text: string): string {
  return text.replace(/<pasted_content(?: id="[^"]*")?>\n?/g, '').replace(/\n?<\/pasted_content(?: id="[^"]*")?>/g, '')
}

export function oneLine(text: string, max: number): string {
  const flat = stripMarkdown(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

// 결정을 묻는 낱말. '확인해 주세요'는 결과를 봐 달라는 부탁이라 넣지 않는다.
const DECIDE = /정해\s*주|결정해\s*주|결정\s*사항|골라\s*주|선택해\s*주|어느\s*쪽|할까요\s*\?|하시겠습니까|알려\s*주세요/
// '문제가 있으면 (바로) 알려 주세요', '필요하면 해당 저장소 경로를 알려 주세요' 처럼 사이 낱말이 세 개까지인 문제·필요·궁금함 조건문은 결정 요청이 아니다. 줄의 모든 곳을 지운다 (g).
// '진행해도 되면 / 괜찮으시면 알려 주세요' 는 허락을 묻는 것이라 남긴다.
// '다른 뜻이었다면 / 의도와 다르면 / 아니라면 알려 주세요' 도 내가 잘못 이해했을 때를 대비한 맺음말이다.
const IF_TELL = /(?:있으(?:시)?면|있(?:으실|을)\s*경우|생기(?:시)?면|이상하(?:시)?면|필요하(?:시)?면|궁금하(?:시)?면|(?:었|였|했)다면|다르(?:시)?면|아니(?:라)?면|끝나(?:시)?면|보이(?:시)?면)\s*(?:\S+\s+){0,3}알려\s*주세요/g
// '끝나면 / 보이면 알려 주세요' (IF_TELL), '(두) 결과를 (함께) 알려 주세요', '어떻게 됐는지 알려 주세요' 는 본 것을 보고해 달라는 부탁이다.
// 사이 낱말은 하나까지: '결과를 보고 진행할지 알려 주세요' 는 결정이다.
const REPORT_TELL = /(?:결과(?:를|는|가)?|어떻게\s*(?:됐|되었|되)는지)\s*(?:\S+\s+)?알려\s*주세요/g
// '무엇을 도와드릴까요?' 같은 도움 제안 인사는 고를 것이 없다.
const HELP_OFFER = /(?:무엇|뭘|어떤\s+\S+?)\s*(?:을|를)?\s*도와\s*드릴까요\s*\?/g
const ENDS_ASKING = /\?\s*$/
// '몇 개 만들까요? 답을 받을 때까지 기다리겠습니다.' 처럼 한국어 의문 어미 + ? 뒤에 문장이 이어진 줄. URL 쿼리와 영어 문장 중간의 ? 는 걸리지 않는다.
const ASKS_MID = /(?:까요|나요|가요|니까|래요)\s*\?\s+\S/
const HEADING = /^#{1,6}\s/

const decides = (line: string) => DECIDE.test(line.replace(IF_TELL, '').replace(REPORT_TELL, ''))

/** 한 줄이 결정을 묻는지: 결정을 묻는 낱말이 있거나 ? 로 끝나거나 줄 중간에 한국어 의문 어미 + ? 가 있다 (마크다운 제목은 ? 로 끝나도 아님). 상황판도 이 줄을 강조한다. */
export function isAskingLine(raw: string): boolean {
  const line = raw.replace(HELP_OFFER, '').trim()
  return decides(line) || ((ENDS_ASKING.test(line) || ASKS_MID.test(line)) && !HEADING.test(line))
}

/** 답변 끝부분이 사용자에게 결정을 요청하는지: 끝 1500자의 줄마다 보되 코드 블록 안은 뺀다. */
export function looksLikeQuestion(answer: string): boolean {
  let inCode = false
  return answer.slice(-1500).split('\n').some(raw => {
    const line = raw.trim()
    if (/^```/.test(line)) inCode = !inCode
    else if (!inCode && line) return isAskingLine(line)
    return false
  })
}

/** 결정 요청 부분만 잘라 보관한다: 끝에서부터 최대 maxChars. */
export function questionText(answer: string, maxChars = 3000): string {
  const text = stripMarkdown(answer).trim()
  return text.length > maxChars ? '…' + text.slice(-maxChars) : text
}

// 대상 없이 결정만 묻는 줄: '어느 쪽으로 할까요?', '어떻게 진행할까요?', '결정해 주세요.'
const GENERIC_ASK = /^(?:그럼|그러면|그렇다면)?\s*(?:어느\s*쪽(?:으로)?|어떤\s*(?:쪽|것|안)(?:으로)?|어떻게|무엇으로|뭘로)?\s*(?:진행)?\s*(?:할까요|하시겠어요|하시겠습니까|정해\s*주(?:세요|십시오)|골라\s*주세요|결정해\s*주(?:세요|십시오))\s*[?.!]?$/
// 들여쓰지 않은 번호 항목 '1. 제목: 설명' / '1) 제목'
const NUMBERED = /^\d+[.)]\s+(.+)$/

/**
 * 긴 결정 요청에서 기록용 한 줄을 뽑는다: 묻는 문장 중 마지막 것.
 * 그 줄이 대상 없이 일반적이면('어느 쪽으로 할까요?') 그 앞의 번호 항목 제목을 · 로 잇는다.
 */
export function questionSummary(question: string): string {
  const raw = question.split('\n')
  const lines = raw.map(l => l.trim()).filter(Boolean)
  const asking = lines.filter(isAskingLine)
  const last = asking[asking.length - 1] ?? lines[lines.length - 1] ?? ''
  if (GENERIC_ASK.test(last)) {
    const at = raw.map(l => l.trim()).lastIndexOf(last)
    const titles = raw
      .slice(0, at)
      .map(l => NUMBERED.exec(l.trimEnd())?.[1]?.split(/[:：]/)[0]?.trim())
      .filter((t): t is string => !!t)
    if (titles.length) return oneLine(titles.join(' · '), 90)
  }
  return oneLine(last, 90)
}

export function describeTool(tool: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Bash':
      return `Bash ${oneLine(redact(pick('command')), 40)}`
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return `${tool} ${basename(pick('file_path') || pick('notebook_path'))}`
    case 'Grep':
    case 'Glob':
      return `${tool} ${oneLine(pick('pattern'), 30)}`
    case 'Agent':
    case 'Task':
      return `서브에이전트 ${oneLine(pick('description'), 30)}`
    case 'TaskCreate':
      return `할 일 추가: ${oneLine(pick('subject'), 30)}`
    case 'TaskUpdate':
      return '할 일 갱신'
    default:
      return tool.startsWith('mcp__') ? tool.split('__').slice(1).join(':') : tool
  }
}

export function askUserText(input: Record<string, unknown>): string {
  const qs = Array.isArray(input.questions) ? (input.questions as Array<Record<string, unknown>>) : []
  return qs
    .map((q, i) => {
      const opts = Array.isArray(q.options)
        ? (q.options as Array<Record<string, unknown>>).map(o => String(o.label ?? '')).join(' / ')
        : ''
      return `${i + 1}. ${String(q.question ?? '')}${opts ? `\n   (${opts})` : ''}`
    })
    .join('\n')
}

/** AskUserQuestion 의 답 { 질문: 답 } 을 결정 기록으로. */
export function decisionsFromAnswers(answers: unknown, at: number): Decision[] {
  if (!answers || typeof answers !== 'object') return []
  return Object.entries(answers as Record<string, unknown>).map(([q, a]) => ({
    at,
    question: oneLine(q, 90),
    answer: oneLine(String(a), 120),
  }))
}

export function pushCapped<T>(list: readonly T[], item: T, cap: number): T[] {
  return [...list, item].slice(-cap)
}

export function event(at: number, kind: Event['kind'], text: string): Event {
  return { at, kind, text: oneLine(text, 100) }
}

/** 흐름 줄 원문의 상한. 넘으면 끝을 … 로 바꾼다 */
export const FLOW_MAX = 10_000

/** 흐름 줄 하나의 이름. 결정과 그 답 요청은 같은 시각이라 종류까지 붙인다 */
export function flowKey(ev: Pick<Event, 'at' | 'kind'>): string {
  return `${ev.at}:${ev.kind}`
}

/** 원문을 상한까지 자른다. 줄바꿈은 그대로 둔다 */
export function flowText(text: string): string {
  return text.length > FLOW_MAX ? text.slice(0, FLOW_MAX - 1) + '…' : text
}

/** 흐름에 남은 줄의 원문만 남긴다 */
export function flowKeep(flow: Record<string, string>, timeline: readonly Event[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const ev of timeline) {
    const k = flowKey(ev)
    if (k in flow) out[k] = flow[k]!
  }
  return out
}

/** TaskCreate / TaskUpdate / TodoWrite 를 할 일 목록에 반영한다. */
export function applyTaskTool(
  tasks: readonly Task[],
  tool: string,
  input: Record<string, unknown>,
  result: unknown,
): Task[] | null {
  if (tool === 'TaskCreate') {
    const task = (result as { task?: { id?: unknown; subject?: unknown } } | undefined)?.task
    const id = task?.id != null ? String(task.id) : `t${tasks.length + 1}`
    const subject = String(task?.subject ?? input.subject ?? '')
    return [...tasks, { id, subject: oneLine(subject, 60), status: 'pending' as const }].slice(-30)
  }
  if (tool === 'TaskUpdate') {
    const id = String(input.taskId ?? '')
    if (input.status === 'deleted') return tasks.filter(t => t.id !== id)
    return tasks.map(t =>
      t.id !== id
        ? t
        : {
            ...t,
            subject: typeof input.subject === 'string' ? oneLine(input.subject, 60) : t.subject,
            status: input.status === 'pending' || input.status === 'in_progress' || input.status === 'completed'
              ? input.status
              : t.status,
          },
    )
  }
  if (tool === 'TodoWrite' && Array.isArray(input.todos)) {
    return (input.todos as Array<Record<string, unknown>>).slice(0, 30).map((t, i) => ({
      id: String(i + 1),
      subject: oneLine(String(t.content ?? ''), 60),
      status: t.status === 'in_progress' || t.status === 'completed' ? t.status : 'pending',
    }))
  }
  return null
}

/**
 * work-plan 의 계획을 할 일 목록과 지금 단계 줄로. 모르는 모양(v 가 1 이 아님)이면 null.
 * 답으로 끝난 턴이면 질문으로 끝났어도 남은 단계를 끝난 것으로 그린다 (모델은 마지막 done 을 보내지 않는다.
 * 결정 대기에 멈춘 막대는 실제로 한 일보다 적게 보였다, T24 재시험). 중단·오류로 끝났으면 보고된 그대로 둔다.
 * compaction 뒤 새 보고 전이면 단계 줄에 그렇게 적는다.
 */
export function tasksFromPlan(plan: unknown): { tasks: Task[]; step: string; ended: boolean } | null {
  const p = plan as WorkPlan | null | undefined
  if (!p || p.v !== 1 || !Array.isArray(p.steps)) return null
  const closed = p.ended?.reason === 'answer'
  // 끝난 계획은 새 보고 전까지 다음 턴이 일해도 진행 중이 아니다: 단계 줄을 비운다 (T27)
  const ended = !!p.ended
  const tasks = p.steps.slice(0, 30).map((s, i): Task => ({
    id: String(i + 1),
    subject: oneLine(s.status === 'blocked' ? `막힘: ${s.title}` : s.title, 60),
    status: closed || s.status === 'done' ? 'completed' : s.status === 'doing' ? 'in_progress' : 'pending',
  }))
  const cur = progress(tasks).current
  return { tasks, step: cur && !ended ? `${p.stale ? '할 일(압축 전)' : '할 일'}: ${cur.subject}` : '', ended }
}

export function progress(tasks: readonly Task[]): { done: number; total: number; current: Task | undefined } {
  return {
    done: tasks.filter(t => t.status === 'completed').length,
    total: tasks.length,
    current: tasks.find(t => t.status === 'in_progress'),
  }
}

export function progressBar(done: number, total: number, width = 8): string {
  if (total === 0) return ''
  const full = Math.round((done / total) * width)
  return '■'.repeat(full) + '□'.repeat(width - full)
}

/** 자기 세션 칸에 방금 바뀐 상태·단계·질문·할 일을 덮는다. 목록은 3초마다 파일을 읽어 만들어 자기 변화도 늦게 보인다. 이름(·2)은 목록의 것을 둔다.
 * 할 일을 덮지 않으면 첫 계획 보고 뒤 몇 초 동안 칸이 막대 대신 단계 글로 보였다 (T24 재시험). */
export function withMe(beats: readonly Beat[], mine: Beat | null): Beat[] {
  if (!mine) return [...beats]
  return beats.map(b => (b.id === mine.id ? { ...b, state: mine.state, step: mine.step, question: mine.question, tasks: mine.tasks, planEnded: mine.planEnded } : b))
}

/** 보여줄 세션만, 보여줄 순서로: 결정 필요 > 작업 중 > 보조 기다림 > 대기 > 오래됨. */
export function visible(beats: readonly Beat[], now: number): Beat[] {
  const rank = (b: Beat) =>
    now - b.updatedAt > STALE_MS ? 4 : b.state === 'asking' ? 0 : b.state === 'working' ? 1 : waitsOnAgents(b) ? 2 : 3
  // 탭을 그냥 닫으면 종료 기록이 남지 않는다. 같은 폴더·이름의 더 새 기록이 있는 오래된 기록은 그 잔재로 보고 숨긴다.
  const leftover = (b: Beat) =>
    now - b.updatedAt > STALE_MS &&
    beats.some(o => o.id !== b.id && o.cwd === b.cwd && o.name === b.name && o.updatedAt > b.updatedAt)
  return beats
    .filter(b => b.state !== 'ended' && now - b.updatedAt < HIDE_MS && !leftover(b))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

export function findByName(beats: readonly Beat[], name: string): Beat | undefined {
  const n = name.trim().toLowerCase()
  return beats.find(b => b.name.toLowerCase() === n) ?? beats.find(b => b.name.toLowerCase().startsWith(n))
}

export function isStale(b: Beat, now: number): boolean {
  return now - b.updatedAt > STALE_MS
}

export function label(b: Beat, now: number): string {
  if (isStale(b, now)) return '소식없음'
  return b.state === 'asking' ? '결정 필요' : b.state === 'working' ? '작업중' : waitsOnAgents(b) ? '보조 기다림' : '대기'
}

/** 메인 턴은 끝났지만 뒤에서 도는 보조 에이전트가 있다: 대기가 아니라 보조를 기다리는 중 */
export function waitsOnAgents(b: Beat): boolean {
  return b.state === 'idle' && b.agents.some(a => a.status === 'working')
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}초 전`
  if (s < 3600) return `${Math.round(s / 60)}분 전`
  return `${Math.round(s / 3600)}시간 전`
}

export const EVENT_MARK: Record<Event['kind'], string> = {
  prompt: '▷ 요청',
  done: '✓ 완료',
  ask: '⚑ 질문',
  decide: '◆ 결정',
  abort: '✗ 중단',
  fail: '⚠ 숨은 실패',
  clear: '⟲ 대화 지움',
}

const NOT_TYPED = /^(?:<|\[Request interrupted|The \S+ plugin sent a message:)/

/**
 * 결정 요청 직전 대화: `$.session.messages()` 에서 글이 있는 행만, Claude 의 연속 행은 합쳐, 사용자 글 기준 마지막 `turns` 턴.
 * 메시지는 내용 블록마다 한 행이고 도구 결과·thinking·tool_use 행은 글이 비어 있다.
 * `dropLast`: turn.complete 시점에는 이번 답(질문 원문)이 이미 마지막 행이라 뺀다.
 * 사람이 쓰지 않은 사용자 행(알림·명령 기록 '<…', 중단 표시, 플러그인이 보낸 요청)은 뺀다. 이 mod 의 HTML 요청은 맥락을 다시 담고 있다.
 * 사용자 행은 합치지 않는다: 합쳐서 자르면 뒤에 온 답이 잘린다.
 */
export function recentTurns(
  messages: readonly { role: 'user' | 'assistant'; text: string }[],
  dropLast: boolean,
  turns = 3,
  chars = 400,
): RecentLine[] {
  const rows = messages
    .map(m => ({ role: m.role, text: m.text.trim() }))
    .filter(m => m.text && !(m.role === 'user' && NOT_TYPED.test(m.text)))
  // 질문 원문 행만 뺀다. 같은 턴의 앞선 글은 남긴다
  if (dropLast && rows.at(-1)?.role === 'assistant') rows.pop()
  const lines: RecentLine[] = []
  for (const m of rows) {
    const prev = lines.at(-1)
    if (m.role === 'assistant' && prev?.role === 'assistant') prev.text += ' ' + m.text
    else lines.push({ ...m })
  }
  let start = lines.length
  for (let seen = 0; start > 0 && seen < turns; ) if (lines[--start]!.role === 'user') seen++
  return lines.slice(start).map(l => ({ role: l.role, text: oneLine(l.text, chars) }))
}

/** 결정을 설명할 때 넘기는 그 세션의 맥락: 이름, 받은 요청, 진행, 지난 결정 */
function contextLines(b: Beat): string[] {
  const { done, total, current } = progress(b.tasks)
  const history = b.decisions.slice(-6).map(d => `- ${d.question} → ${d.answer}`).join('\n')
  const recent = (b.recent ?? []).map(r => `${r.role === 'user' ? '사용자' : 'Claude'}: ${r.text}`).join('\n')
  return [
    `"${b.name}" 작업 세션이 사용자에게 아래 결정을 요청하고 있어.`,
    `이 세션이 받은 요청: ${b.prompt || '(알 수 없음)'}`,
    total ? `작업 진행: ${done}/${total}${current ? `, 지금 "${current.subject}"` : ''}` : '',
    history ? `지금까지 이 세션에서 내려진 결정:\n${history}` : '',
    recent ? `질문 직전 대화:\n${recent}` : '',
  ]
}

export function explainPrompt(b: Beat, kind: ExplainKind = 'kid'): string {
  return [
    ...contextLines(b),
    '',
    kind === 'ste'
      ? '결정 항목마다 ASD-STE100 기준 문장으로 정리해줘. 읽는 사람은 현업 개발자라 정확한 용어를 그대로 살려 줘.'
      : '결정 항목마다 12살도 직관적으로 이해하게 정리해줘. 읽는 사람은 현업 개발자라 정확한 용어도 살려 줘.',
    kind === 'ste' ? STE_JSON_SPEC : EXPLAIN_JSON_SPEC,
    '',
    '--- 결정 요청 원문 ---',
    b.question,
  ]
    .filter(l => l !== '')
    .join('\n')
}

/** HTML 버튼: 보드를 연 세션의 Claude 에게 결정 설명 페이지를 만들어 Artifact 로 발행해 달라고 보내는 글 */
export function htmlPrompt(b: Beat): string {
  return [
    '팀 상황판에서 아래 결정의 HTML 설명을 요청했어. 결정을 설명하는 HTML 페이지를 만들어 Artifact 도구로 발행하고 링크를 답해줘.',
    '읽는 사람은 현업 개발자야. 결정 항목마다 선택지, 고르면 생기는 일, 추천을 담아줘.',
    '결정은 내리지 말고, 이 요청을 작업을 이어 가라는 신호로 받지 마.',
    '',
    ...contextLines(b),
    '',
    '--- 결정 요청 원문 ---',
    b.question,
  ]
    .filter(l => l !== '')
    .join('\n')
}

export type Seg = { text: string; tone: 'done' | 'now' | 'left' | 'end' }

/**
 * 할 일 목록을 길로 그린다:  ●━━━●━━━◉───○───◎
 * ● 끝남 · ◉ 지금 · ○ 남음 · ◎ 도착. 지나온 길은 굵게(━), 남은 길은 가늘게(─).
 * 할 일이 많으면 지금 위치 근처만 보여 주고 양 끝을 … 로 줄인다.
 */
export function routeLine(tasks: readonly Task[], width: number): Seg[] {
  if (tasks.length === 0 || width < 8) return []
  const maxNodes = Math.max(2, Math.min(tasks.length, Math.floor((width - 2) / 3)))
  const firstOpen = tasks.findIndex(t => t.status !== 'completed')
  const anchor = firstOpen < 0 ? tasks.length - 1 : firstOpen
  const start = Math.max(0, Math.min(anchor - Math.floor(maxNodes / 2), tasks.length - maxNodes))
  const shown = tasks.slice(start, start + maxNodes)
  const head = start > 0 ? 1 : 0
  const tail = start + maxNodes < tasks.length ? 1 : 0
  const fixed = shown.length + 1 + head * 2 + tail * 2 // 마디 + 도착점 + 줄임표
  const seg = Math.max(1, Math.floor((width - fixed) / shown.length))

  const out: Seg[] = []
  if (head) out.push({ text: '…━', tone: 'done' })
  shown.forEach(t => {
    const node = t.status === 'completed' ? '●' : t.status === 'in_progress' ? '◉' : '○'
    out.push({ text: node, tone: t.status === 'completed' ? 'done' : t.status === 'in_progress' ? 'now' : 'left' })
    // 끝낸 마디 뒤의 길은 지나온 길(━), 나머지는 남은 길(─)
    out.push({ text: (t.status === 'completed' ? '━' : '─').repeat(seg), tone: t.status === 'completed' ? 'done' : 'left' })
  })
  if (tail) out.push({ text: '─…', tone: 'left' })
  const allDone = tasks.every(t => t.status === 'completed')
  out.push({ text: '◎', tone: allDone ? 'done' : 'end' })
  return out
}

/**
 * 알약 막대 (T24 B안, plan-progress 의 막대를 글자로):  ████████ 테스트 실행 ···│···│···
 * 채움(█) 끝에 지금 단계 이름 알약이 붙고, 남은 구간은 · 와 단계 경계 눈금 │ 로 그린다.
 * 알약 글은 상태로 정한다: 작업 = 지금 단계, 결정 = ? 단계, 실패 = ✕ 단계, 끝남 = ✓ 걸린 시간(없으면 도착).
 * 폭 1 BMP 문자만 쓴다. width 는 채움 + 알약 + 남은 구간의 칸 수. 너무 좁으면 null (부르는 쪽이 경로선으로).
 */
export type PillTone = 'run' | 'ask' | 'err' | 'ok' | 'stop'
export type PillBar = { fill: string; pill: string; rest: string; pct: number; tone: PillTone }

export function pillBar(tasks: readonly Task[], width: number, tone: PillTone, took = ''): PillBar | null {
  const { done, total, current } = progress(tasks)
  if (total === 0 || width < 12) return null
  const allDone = done === total
  const tn: PillTone = allDone && tone === 'run' ? 'ok' : tone
  const step = current ?? tasks.find(t => t.status !== 'completed')
  // 다 끝난 계획의 결정 대기는 단계 이름 대신 '질문 대기': 초록 ✓ 로 그리면 일을 멈추고 묻는 세션과 구별되지 않는다
  const label = tn === 'ok' ? `✓ ${took || '도착'}` : `${tn === 'ask' ? '? ' : tn === 'err' ? '✕ ' : tn === 'stop' ? '멈춤: ' : ''}${step?.subject ?? (tn === 'ask' ? '질문 대기' : '')}`
  const pill = ` ${clip(label, Math.max(4, Math.floor(width / 2) - 2))} `
  const room = Math.max(0, width - cells(pill))
  const filled = tn === 'ok' ? room : Math.min(room, Math.round((done / total) * room))
  const ticks = new Set(Array.from({ length: total - 1 }, (_, k) => Math.round(((k + 1) * room) / total)))
  let rest = ''
  for (let i = filled; i < room; i++) rest += ticks.has(i) && i > filled ? '│' : '·'
  return { fill: '█'.repeat(filled), pill, rest, pct: Math.round((done / total) * 100), tone: tn }
}

/**
 * 세션 막대의 알약 색. 결정 대기 노랑 ?, 숨은 실패 빨강 ✕, 작업 중이 아닌데 진행 중 단계가 남았으면(중단·오류로 끝난 턴) 노랑 '멈춤',
 * 그 밖은 작업색 (다 끝났으면 pillBar 가 초록 ✓). 자세히의 할 일 띠 '멈춤' 과 같은 판정.
 * 끝난 계획이면 다음 턴이 일하는 동안에도 '멈춤' (T27: 새 턴에 옛 단계가 파랗게 진행 중으로 보였다).
 */
export function pillToneOf(b: Pick<Beat, 'state' | 'tasks' | 'fail' | 'planEnded'>, stale: boolean): PillTone {
  if (b.state === 'asking' && !stale) return 'ask'
  if (b.fail?.level === 'high' && !stale) return 'err'
  if ((b.state !== 'working' || b.planEnded) && b.tasks.some(t => t.status === 'in_progress')) return 'stop'
  return 'run'
}

/** 마지막 요청에서 턴 끝까지 걸린 시간 (흐름의 prompt → done). 끝나지 않았으면 '' */
export function turnTook(timeline: readonly Event[]): string {
  const doneAt = [...timeline].reverse().find(e => e.kind === 'done')?.at
  const promptAt = [...timeline].reverse().find(e => e.kind === 'prompt' && (doneAt === undefined || e.at <= doneAt))?.at
  if (doneAt === undefined || promptAt === undefined) return ''
  return took(doneAt - promptAt)
}

/** 걸린 시간: 12초, 3분 12초 */
export function took(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000))
  return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`
}

/**
 * 막대 아래 보조 에이전트 줄 (T24 B안): 도는 것 먼저, 그다음 최근에 끝난 것. max 줄을 넘으면 마지막 줄을 "+k" 요약으로.
 * 시간은 도는 동안 지금까지, 끝났으면 걸린 시간. 모델은 짧게 (claude-haiku-5-5 → haiku 5.5): 좁은 창에서 도구·시간이 잘리지 않게.
 */
export type Strip = { n: number; label: string; model: string; tool: string; time: string; status: SubAgent['status'] } | { more: number; done: number }

export function agentStrips(list: readonly SubAgent[], now: number, max = 3): Strip[] {
  const order = list.map((a, i) => ({ a, n: i + 1 }))
  order.sort((x, y) => (x.a.status === 'working' ? 0 : 1) - (y.a.status === 'working' ? 0 : 1) || (y.a.endedAt ?? 0) - (x.a.endedAt ?? 0))
  const fits = order.length <= max ? order : order.slice(0, max - 1)
  const rows: Strip[] = fits.map(({ a, n }) => ({
    n,
    label: a.desc || a.type || '에이전트',
    model: a.model.replace(/^claude-([a-z]+)-(\d+)-(\d+).*$/, '$1 $2.$3'),
    tool: a.status === 'working' ? a.tool : a.status === 'failed' ? '실패' : '',
    time: took((a.endedAt ?? now) - a.startedAt),
    status: a.status,
  }))
  const rest = order.slice(fits.length)
  return rest.length ? [...rows, { more: rest.length, done: rest.filter(r => r.a.status !== 'working').length }] : rows
}

/**
 * /board 자세히의 할 일 한 줄 (T25, plan-progress 의 보조 띠 모양). 끝남 초록, 막힘 빨강.
 * 지금 단계는 작업 중이면 '진행 중', 결정 대기면 '질문 대기', 그 밖(중단·오류로 끝난 턴)이면 '멈춤'.
 */
export type TodoStrip = { n: number; label: string; end: string; tone: PillTone | 'todo' }

export function todoStrips(tasks: readonly Task[], state: Beat['state'], planEnded = false): TodoStrip[] {
  return tasks.map((t, i): TodoStrip => {
    const n = i + 1
    if (t.status === 'completed') return { n, label: t.subject, end: '끝남', tone: 'ok' }
    if (t.status === 'in_progress') {
      return state === 'working' && !planEnded ? { n, label: t.subject, end: '진행 중', tone: 'run' }
        : state === 'asking' ? { n, label: t.subject, end: '질문 대기', tone: 'ask' }
        : { n, label: t.subject, end: '멈춤', tone: 'stop' }
    }
    return t.subject.startsWith('막힘: ') ? { n, label: t.subject.slice(4), end: '막힘', tone: 'err' } : { n, label: t.subject, end: '', tone: 'todo' }
  })
}

/** 같은 이름의 세션이 여럿이면 화면용 이름 뒤에 ·2, ·3 을 붙인다 (기록은 그대로). */
export function dedupeNames<T extends { id: string; name: string }>(list: readonly T[]): T[] {
  const groups = new Map<string, T[]>()
  for (const b of list) groups.set(b.name, [...(groups.get(b.name) ?? []), b])
  const label = new Map<string, string>()
  for (const [name, same] of groups) {
    if (same.length < 2) continue
    ;[...same].sort((a, b) => a.id.localeCompare(b.id)).forEach((b, i) => label.set(b.id, i === 0 ? name : `${name}·${i + 1}`))
  }
  return list.map(b => (label.has(b.id) ? { ...b, name: label.get(b.id)! } : b))
}

/** transcript 안의 마지막 customTitle (claude --name, /rename 이 남기는 이름). */
export function lastCustomTitle(grepOutput: string): string {
  const all = [...grepOutput.matchAll(/"customTitle":"((?:[^"\\]|\\.)*)"/g)]
  const last = all[all.length - 1]?.[1]
  if (!last) return ''
  try {
    return (JSON.parse(`"${last}"`) as string).trim().slice(0, 24)
  } catch {
    return last.trim().slice(0, 24)
  }
}

/** Claude Code 가 세션 기록을 두는 폴더 이름 (cwd 의 영숫자 외 문자를 - 로). */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-')
}

/**
 * 팀 창 배치. 세션 수와 화면 크기에 맞춰 고른다.
 * - solo: 세션 하나 → 한 줄짜리 창 (머리줄에 내 상태를 바로)
 * - full: 칸마다 두 줄 (이름·상태 / 질문·경로선), 2줄까지 줄바꿈
 * - compact: 세션이 많으면 칸마다 한 줄, 그래도 넘치면 중요한 세션부터 보이고 나머지는 "+k"
 */
export type BandLayout = { mode: 'solo' | 'full' | 'compact'; slotW: number; shown: number }

export function bandLayout(n: number, columns: number, maxRows: number): BandLayout {
  const inner = Math.max(30, columns - 4)
  if (n <= 1) return { mode: 'solo', slotW: inner, shown: n }
  const fit = (min: number, max: number) => Math.max(min, Math.min(max, Math.floor((inner - (n - 1)) / n)))
  const perRow = (w: number) => Math.max(1, Math.floor((inner + 1) / (w + 1)))
  // 테두리 2줄 + 머리줄 1줄을 뺀 높이
  const room = Math.max(1, maxRows - 3)

  const fullW = fit(22, 34)
  const fullRows = Math.ceil(n / perRow(fullW))
  if (fullRows <= 2 && fullRows * 2 <= room) return { mode: 'full', slotW: fullW, shown: n }

  // 배지 6칸 + 공백 + 이름 11칸 + 좌우 여백 2칸. 다 안 보이고 18칸이 더 많이 보일 때만 이름을 2칸 줄인다
  const capacityOf = (w: number) => perRow(w) * Math.min(3, room)
  const w20 = fit(20, 26)
  const w18 = fit(18, 26)
  const compactW = n <= capacityOf(w20) || capacityOf(w18) <= capacityOf(w20) ? w20 : w18
  const capacity = capacityOf(compactW)
  return { mode: 'compact', slotW: compactW, shown: n <= capacity ? n : Math.max(1, capacity - 1) }
}

/** 팀 창에 먼저 보일 순서: 결정 대기 > 숨은 실패 > 이 세션 > 작업중 > 보조 기다림 > 대기 > 소식 없음. */
export function bandOrder(beats: readonly Beat[], now: number, meId: string | undefined): Beat[] {
  const rank = (b: Beat) =>
    isStale(b, now) ? 6
      : b.state === 'asking' ? 0
        : b.fail?.level === 'high' ? 1
          : b.id === meId ? 2
            : b.state === 'working' ? 3
              : waitsOnAgents(b) ? 4 : 5
  return [...beats].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

// ---- 보조 에이전트 (G3) ----

/** 한 세션에 남겨 둘 보조 에이전트 수. 넘치면 끝난 것부터 버린다. */
export const MAX_AGENTS = 12

/** 새 보조 에이전트를 장부에 넣는다. 같은 id 가 있으면 (resume) 다시 작업 중으로 돌린다. */
export function agentStart(
  list: readonly SubAgent[],
  a: { id: string; desc: string; type: string; model: string; at: number },
): SubAgent[] {
  const rest = list.filter(x => x.id !== a.id)
  const next: SubAgent = { id: a.id, desc: a.desc, type: a.type, model: a.model, status: 'working', tool: '', startedAt: a.at, endedAt: null, tokens: list.find(x => x.id === a.id)?.tokens ?? 0 }
  const out = [...rest, next]
  while (out.length > MAX_AGENTS) {
    const i = out.findIndex(x => x.status !== 'working')
    out.splice(i < 0 ? 0 : i, 1)
  }
  return out
}

/** 장부의 한 에이전트를 고친다. 모르는 id 면 그대로 (mod 가 늦게 켜졌거나 다른 세션의 것). */
export function agentPatch(list: readonly SubAgent[], id: string, patch: (a: SubAgent) => SubAgent): SubAgent[] {
  return list.some(a => a.id === id) ? list.map(a => (a.id === id ? patch(a) : a)) : (list as SubAgent[])
}

/** 끝: 오류·중단이면 실패. 이미 끝난 것은 처음 끝난 시각을 지킨다. */
export function agentEnd(list: readonly SubAgent[], id: string, ok: boolean, at: number): SubAgent[] {
  return agentPatch(list, id, a => (a.status === 'working' ? { ...a, status: ok ? 'done' : 'failed', tool: '', endedAt: at } : a))
}

/**
 * 엔진 목록($.agent.list)의 상태로 보정한다: 끝난 신호를 놓쳤을 때를 위해.
 * 턴이 끝났어도 엔진이 아직 돈다고 하면(제 백그라운드 셸을 기다리는 waiting 등) 다시 작업 중으로 돌린다.
 */
export function agentSync(list: readonly SubAgent[], infos: readonly { id: string; status: string }[], at: number): SubAgent[] {
  let out = list as SubAgent[]
  for (const i of infos) {
    if (i.status === 'completed') out = agentEnd(out, i.id, true, at)
    else if (i.status === 'failed' || i.status === 'killed') out = agentEnd(out, i.id, false, at)
    else if (i.status === 'running' || i.status === 'waiting' || i.status === 'pending')
      out = agentPatch(out, i.id, a => (a.status === 'working' ? a : { ...a, status: 'working', endedAt: null }))
  }
  return out
}

/** 엔진 목록에 없는 작업 중 에이전트를 끝(실패)으로: 다시 시작(claude -r)하면 앞 프로세스의 에이전트는 이 프로세스 목록에 없다. */
export function agentGone(list: readonly SubAgent[], infos: readonly { id: string }[], at: number): SubAgent[] {
  let out = list as SubAgent[]
  for (const a of list) if (a.status === 'working' && !infos.some(i => i.id === a.id)) out = agentEnd(out, a.id, false, at)
  return out
}

/** 사람이 새 프롬프트를 보내면 끝난 에이전트를 지운다. */
export function agentClearEnded(list: readonly SubAgent[]): SubAgent[] {
  return list.filter(a => a.status === 'working')
}

export function agentCounts(list: readonly SubAgent[]): { working: number; done: number; failed: number } {
  return {
    working: list.filter(a => a.status === 'working').length,
    done: list.filter(a => a.status === 'done').length,
    failed: list.filter(a => a.status === 'failed').length,
  }
}

/** 카드 한 줄: `● 2 작업 · ✓ 1 끝 · ✗ 1 실패 · Explore: Grep`. 에이전트가 없으면 ''. */
export function agentSummary(list: readonly SubAgent[]): string {
  if (list.length === 0) return ''
  const c = agentCounts(list)
  const parts = [c.working ? `● ${c.working} 작업` : '', c.done ? `✓ ${c.done} 끝` : '', c.failed ? `✗ ${c.failed} 실패` : ''].filter(Boolean)
  const busy = [...list].reverse().find(a => a.status === 'working' && a.tool)
  if (busy) parts.push(`${busy.type || '에이전트'}: ${busy.tool}`)
  return parts.join(' · ')
}

/** 뒤에서 돈 보조 에이전트의 작업 알림에서 엔진이 센 토큰을 읽는다. 한 프롬프트에 알림이 여럿 올 수 있다 */
export function notificationTokens(text: string): { id: string; tokens: number }[] {
  return text.split('<task-notification>').slice(1).flatMap(block => {
    const id = /<task-id>([^<]+)<\/task-id>/.exec(block)?.[1]
    const n = /<subagent_tokens>(\d+)<\/subagent_tokens>/.exec(block)?.[1]
    return id && n ? [{ id, tokens: Number(n) }] : []
  })
}

/** 토큰을 짧게: 950, 41k, 1.2M */
export function tokensText(n: number): string {
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`
  return `${(n / 1_000_000).toFixed(1)}M`
}

/** 경과 시간을 m:ss 로 (1시간 넘으면 h:mm:ss) */
export function spanText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = String(Math.floor((s % 3600) / 60))
  const ss = String(s % 60).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm.padStart(2, '0')}:${ss}` : `${mm}:${ss}`
}

/** 상세 목록 한 줄의 뒷부분: `Explore · haiku-5-5 · Grep · 2:10 · 41k` */
export function agentMeta(a: SubAgent, now: number): string {
  const doing = a.status === 'working' ? a.tool || '시작' : a.status === 'done' ? '끝' : '실패'
  const span = spanText((a.endedAt ?? now) - a.startedAt)
  return [a.type, a.model.replace(/^claude-/, ''), doing, span, a.tokens ? tokensText(a.tokens) : ''].filter(Boolean).join(' · ')
}

/** 카드 머리 한 줄에 무엇을 그릴지. 배지는 줄지 않고 이름은 8칸까지 줄어든다. 넘치면 (이 세션) → *, 그 다음 오른쪽을
 * 막대 → 몇 초 전 → 캐시(경고가 아닐 때) → ctx 순으로 덜어 낸다. 경고인 캐시는 ctx 보다 오래 남긴다. width 는 고른 것의 칸 수 합. */
export function headParts(
  avail: number,
  p: { badge: string; name: string; me: boolean; pct: number | null; cache: string | null; cacheHot: boolean; ago: string },
): { me: string; bar: boolean; ctx: boolean; cache: boolean; ago: boolean; width: number } {
  const ctxW = (withBar: boolean) => cells(p.pct === null ? 'ctx --' : withBar ? `ctx ${bar(p.pct, 100, 5)} ${p.pct}%` : `ctx ${p.pct}%`)
  const cacheW = p.cache === null ? 0 : 1 + cells(`· ${p.cache}`)
  const agoW = 1 + cells(`· ${p.ago}`)
  const hasCache = p.cache !== null
  const rungs = [
    { bar: true, ctx: true, cache: hasCache, ago: true },
    { bar: false, ctx: true, cache: hasCache, ago: true },
    { bar: false, ctx: true, cache: hasCache, ago: false },
    p.cacheHot && hasCache ? { bar: false, ctx: false, cache: true, ago: false } : { bar: false, ctx: true, cache: false, ago: false },
    { bar: false, ctx: false, cache: false, ago: false },
  ]
  const marks = p.me ? ['(이 세션)', '*'] : ['']
  const leftOf = (me: string) => cells(` ${p.badge} `) + 1 + Math.min(cells(p.name), 8) + (me ? 1 + cells(me) : 0)
  const rightOf = (r: (typeof rungs)[number]) => {
    const parts = (r.ctx ? ctxW(r.bar) : 0) + (r.cache ? (r.ctx ? cacheW : cells(p.cache!)) : 0) + (r.ago ? agoW : 0)
    return parts ? 1 + parts : 0 // 왼쪽과 사이 한 칸
  }
  for (const me of marks) {
    for (const r of me === marks[0] && marks.length > 1 ? rungs.slice(0, 1) : rungs) {
      const width = leftOf(me) + rightOf(r)
      if (width <= avail) return { me, ...r, width }
    }
  }
  const me = marks[marks.length - 1]!
  return { me, ...rungs[rungs.length - 1]!, width: leftOf(me) }
}

/** STE 선택지 이름 칸(가장 긴 이름 + 7)이 상자 안쪽 폭의 40% 를 넘으면 이름을 위에, 글을 아래에 쓴다 */
export function steStacked(labelW: number, artW: number): boolean {
  return labelW + 7 > artW * 0.4
}

/**
 * 알림 chime 을 어디서 어떻게 울릴지 (T24, 모든 터미널). macOS 는 엔진 플레이어($.audio.play, afplay).
 * 엔진 플레이어는 Linux·Windows 터미널에서 소리 없이 끝나므로 그 둘은 시스템 명령으로 튼다.
 * Windows 는 plugin 폴더가 드라이브 문자로 시작하는 것으로, 나머지는 uname -s 로 가른다.
 */
export type SoundOs = 'mac' | 'windows' | 'linux'

export function soundOs(root: string, uname: string): SoundOs {
  if (/^[A-Za-z]:/.test(root)) return 'windows'
  return /darwin/i.test(uname) ? 'mac' : 'linux'
}

/** 시스템 명령 후보: 앞에서부터 하나가 exit 0 이면 끝. 경로는 환경 변수로 넘긴다 (경로 속 따옴표가 명령을 끊지 않게). */
export function soundCommands(os: SoundOs, file: string): { argv: string[]; env?: Record<string, string> }[] {
  if (os === 'windows') {
    return [{
      argv: ['powershell', '-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '(New-Object Media.SoundPlayer $env:TEAM_BOARD_WAV).PlaySync()'],
      env: { TEAM_BOARD_WAV: file.replace(/\//g, '\\') },
    }]
  }
  if (os === 'linux') return [{ argv: ['paplay', file] }, { argv: ['aplay', '-q', file] }]
  return []
}
