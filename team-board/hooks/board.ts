// 순수 함수만 둔다. $ 에 의존하지 않아 테스트와 이식이 쉽다.
import type { Beat, Decision, Event, Task } from '../types'
import { EXPLAIN_JSON_SPEC } from './diagram'

// 살아 있는 세션은 1분마다 기록하므로, 3분 넘게 소식이 없으면 흐리게 표시한다.
export const STALE_MS = 3 * 60_000
export const HIDE_MS = 12 * 60 * 60_000 // 12시간 지나면 숨김
export const MAX_TIMELINE = 12
export const MAX_DECISIONS = 20

export function emptyBeat(id: string, name: string, cwd: string): Beat {
  return {
    id, name, cwd, state: 'idle', step: '', prompt: '', last: '', question: '',
    contextPct: null, tasks: [], decisions: [], timeline: [], edits: 0, files: [], updatedAt: 0,
  }
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
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
}

export function oneLine(text: string, max: number): string {
  const flat = stripMarkdown(text).replace(/\s+/g, ' ').trim()
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat
}

const ASKING = /정해\s*주|결정해\s*주|결정\s*사항|골라\s*주|선택해\s*주|어느\s*쪽|할까요\s*\?|하시겠습니까|확인해\s*주|알려\s*주세요|\?\s*$/m

/** 답변 끝부분이 사용자에게 결정을 요청하는지. */
export function looksLikeQuestion(answer: string): boolean {
  return ASKING.test(answer.slice(-1500))
}

/** 결정 요청 부분만 잘라 보관한다: 끝에서부터 최대 maxChars. */
export function questionText(answer: string, maxChars = 3000): string {
  const text = stripMarkdown(answer).trim()
  return text.length > maxChars ? '…' + text.slice(-maxChars) : text
}

/** 긴 결정 요청에서 기록용 한 줄을 뽑는다: 묻는 문장 중 마지막 것. */
export function questionSummary(question: string): string {
  const lines = question.split('\n').map(l => l.trim()).filter(Boolean)
  const asking = lines.filter(l => ASKING.test(l))
  return oneLine(asking[asking.length - 1] ?? lines[lines.length - 1] ?? '', 90)
}

export function describeTool(tool: string, input: Record<string, unknown>): string {
  const pick = (k: string) => (typeof input[k] === 'string' ? (input[k] as string) : '')
  switch (tool) {
    case 'Bash':
      return `Bash ${oneLine(pick('command'), 40)}`
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

/** 보여줄 세션만, 보여줄 순서로: 결정 필요 > 작업 중 > 대기 > 오래됨. */
export function visible(beats: readonly Beat[], now: number): Beat[] {
  const rank = (b: Beat) =>
    now - b.updatedAt > STALE_MS ? 3 : b.state === 'asking' ? 0 : b.state === 'working' ? 1 : 2
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
  return b.state === 'asking' ? '결정 필요' : b.state === 'working' ? '작업중' : '대기'
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
}

export function explainPrompt(b: Beat): string {
  const { done, total, current } = progress(b.tasks)
  const history = b.decisions.slice(-6).map(d => `- ${d.question} → ${d.answer}`).join('\n')
  return [
    `"${b.name}" 작업 세션이 사용자에게 아래 결정을 요청하고 있어.`,
    `이 세션이 받은 요청: ${b.prompt || '(알 수 없음)'}`,
    total ? `작업 진행: ${done}/${total}${current ? `, 지금 "${current.subject}"` : ''}` : '',
    history ? `지금까지 이 세션에서 내려진 결정:\n${history}` : '',
    '',
    '결정 항목마다 12살도 직관적으로 이해하게 정리해줘. 읽는 사람은 현업 개발자라 정확한 용어도 살려 줘.',
    EXPLAIN_JSON_SPEC,
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
