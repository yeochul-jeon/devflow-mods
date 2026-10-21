// 순수 함수만 둔다: $ 에 의존하지 않아 테스트하기 쉽다.

import type { Bar, Commit, Decision, Entry, Kind, Minutes, Period, ProjectReport, Report, Work } from '../types'

export const MAX_TEXT = 200
const DAY_MS = 86_400_000

/** `date +%z` 의 '+0900' → 540 (분, UTC 보다 앞이면 +). 못 읽으면 0. */
export function parseOffset(z: string): number {
  const m = /^([+-])(\d{2})(\d{2})$/.exec(z.trim())
  if (!m) return 0
  return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]))
}

/** 로컬 날짜 'YYYY-MM-DD'. 모드 런타임의 시간대를 믿지 않고 offset 으로 계산한다. */
export function dayOf(ms: number, offsetMin: number): string {
  return new Date(ms + offsetMin * 60_000).toISOString().slice(0, 10)
}

/** 기간에 드는 로컬 날짜들, 오래된 것부터. */
export function periodDays(period: Period, now: number, offsetMin: number): string[] {
  if (period === 'year') {
    const today = dayOf(now, offsetMin)
    const n = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${today.slice(0, 4)}-01-01T00:00:00Z`)) / DAY_MS) + 1
    return Array.from({ length: n }, (_, i) => dayOf(now - (n - 1 - i) * DAY_MS, offsetMin))
  }
  const n = period === 'week' ? 7 : period === 'month' ? 30 : 1
  const last = period === 'yesterday' ? now - DAY_MS : now
  return Array.from({ length: n }, (_, i) => dayOf(last - (n - 1 - i) * DAY_MS, offsetMin))
}

/** git log --since/--until 에 쓰는 그 날짜 0시 (로컬 시간대 표기). */
export function dayStartIso(day: string, offsetMin: number): string {
  const sign = offsetMin < 0 ? '-' : '+'
  const a = Math.abs(offsetMin)
  return `${day}T00:00:00${sign}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`
}

/** 다음 날짜 'YYYY-MM-DD'. */
export function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)
}

// team-board/hooks/failure.ts 에서 복사 (plugin 끼리 의존하지 않는다).
// 비밀 값: 이름에 token·secret·password 등이 든 변수·옵션의 값, 인증 헤더, URL 의 비밀번호, 알려진 토큰 꼴
const SECRET_NAME = String.raw`[\w-]*(?:token|secret|passw(?:or)?d|pwd|api[_-]?key|auth(?!or)|credential)[\w-]*`
const SECRET_VALUE = String.raw`(?:"[^"]*"|'[^']*'|[^\s'"]+)`
const SECRETS: [RegExp, string][] = [
  [/\b(?:sk-[\w-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|github_pat_\w{20,}|xox[abpr]-[\w-]{10,}|AKIA[0-9A-Z]{16}|eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+)/g, '***'],
  [new RegExp(String.raw`(${SECRET_NAME}=)${SECRET_VALUE}`, 'gi'), '$1***'],
  [new RegExp(String.raw`(--?${SECRET_NAME}\s+)(?!-)${SECRET_VALUE}`, 'gi'), '$1***'],
  [/(Authorization:\s*(?:Bearer|Basic|Token)\s+)[^\s'"]+/gi, '$1***'],
  [/(\/\/[^\s:/@]+:)[^\s@/]+(@)/g, '$1***$2'],
]

export function redact(text: string): string {
  return SECRETS.reduce((t, [re, to]) => t.replace(re, to), text)
}

/** 붙여 넣은 글을 감싼 엔진 태그(`<pasted_content id="…">`, `</pasted_content id="…">`)를 빼고 글만 남긴다. 태그에 붙은 줄바꿈 하나도 함께 뺀다 */
export function unwrapPaste(text: string): string {
  return text.replace(/<pasted_content(?: id="[^"]*")?>\n?/g, '').replace(/\n?<\/pasted_content(?: id="[^"]*")?>/g, '')
}

/** 기록할 요청 글: 붙여 넣기 태그를 빼고 줄바꿈을 펴고 비밀 값을 가린 뒤 200자(코드 포인트). */
export function requestText(text: string): string {
  const flat = redact(unwrapPaste(text).replace(/\s+/g, ' ').trim())
  const chars = [...flat]
  return chars.length > MAX_TEXT ? chars.slice(0, MAX_TEXT - 1).join('') + '…' : flat
}

/** 줄바꿈을 펴고 n 자(코드 포인트)로 자른다. */
export function clipText(text: string, n: number): string {
  const chars = [...text.replace(/\s+/g, ' ').trim()]
  return chars.length > n ? chars.slice(0, n - 1).join('') + '…' : chars.join('')
}

/** 결정 질문 앞의 목록 기호('- ', '2. ', '1) ')를 뗀다: team-board 는 답변의 한 줄을 그대로 질문으로 남긴다. */
export function questionText(text: string): string {
  return text.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)+/, '')
}

/** 같은 요청(같은 at)이면 바꾸고, 없으면 더한다. 시각 순. */
export function upsert(entries: readonly Entry[], entry: Entry): Entry[] {
  const rest = entries.filter(e => e.at !== entry.at)
  return [...rest, entry].sort((a, b) => a.at - b.at)
}

// team-board/hooks/board.ts 에서 복사: team-board 상태 폴더 이름.
/** 저장소 루트를 폴더 이름으로 쓸 수 있게 바꾼다. */
export function repoKey(root: string): string {
  return root.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'no-repo'
}

/** team-board 상태 파일(세션 하나)에서 [from, to) 안의 결정. 모양이 다르면 빈 목록. */
export function decisionsIn(beat: unknown, from: number, to: number): Decision[] {
  const list = (beat as { decisions?: unknown } | null)?.decisions
  if (!Array.isArray(list)) return []
  return list.filter(
    (d): d is Decision =>
      typeof d?.at === 'number' && d.at >= from && d.at < to && typeof d.question === 'string' && typeof d.answer === 'string',
  )
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

/** git log --format=%ct%x09%h%x09%s 출력. */
export function parseGitLog(stdout: string): Commit[] {
  return stdout
    .split('\n')
    .map(line => line.split('\t'))
    .filter(p => p.length >= 3 && /^\d+$/.test(p[0]!))
    .map(([ct, hash, ...subject]) => ({ at: Number(ct) * 1000, hash: hash!, subject: subject.join('\t') }))
}

/** 기록과 커밋을 프로젝트(저장소 루트)별로 묶는다. 최근에 일한 프로젝트가 먼저. */
export function buildReport(
  period: Period,
  days: readonly string[],
  entries: readonly Entry[],
  commits: Readonly<Record<string, { commits: Commit[]; error: string }>>,
  decisions: Readonly<Record<string, Decision[]>> = {},
): Report {
  const roots = new Map<string, Entry[]>()
  for (const e of entries) roots.set(e.root, [...(roots.get(e.root) ?? []), e])
  // 요청 기록이 없어도(look-back 설치 전 세션) 결정이 있으면 프로젝트로 보인다
  for (const root of Object.keys(decisions)) if (!roots.has(root)) roots.set(root, [])
  const projects: ProjectReport[] = [...roots].map(([root, list]) => {
    const sorted = [...list].sort((a, b) => a.at - b.at)
    const c = commits[root] ?? { commits: [], error: '' }
    return {
      root,
      name: basename(root),
      entries: sorted,
      commits: [...c.commits].sort((a, b) => a.at - b.at),
      commitError: c.error,
      decisions: [...(decisions[root] ?? [])].sort((a, b) => a.at - b.at),
      ms: sorted.reduce((n, e) => n + e.ms, 0),
      tokens: sorted.reduce((n, e) => n + e.tokens, 0),
    }
  })
  const latest = (p: ProjectReport) => Math.max(p.entries.at(-1)?.at ?? 0, p.commits.at(-1)?.at ?? 0, p.decisions.at(-1)?.at ?? 0)
  projects.sort((a, b) => latest(b) - latest(a))
  return { period, from: days[0] ?? '', to: days[days.length - 1] ?? '', projects }
}

/** '1시간 5분', '12분', '40초'. */
export function durationText(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}초`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}분`
  return m % 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m / 60}시간`
}

/** '12.3천', '1.2만'. */
export function tokensText(n: number): string {
  if (n < 1000) return String(n)
  if (n < 10_000) return `${(n / 1000).toFixed(1)}천`
  return `${(n / 10_000).toFixed(1)}만`
}

/** 'MM/DD HH:MM' (로컬). */
export function clockText(ms: number, offsetMin: number): string {
  const iso = new Date(ms + offsetMin * 60_000).toISOString()
  return `${iso.slice(5, 7)}/${iso.slice(8, 10)} ${iso.slice(11, 16)}`
}

export const END_MARK: Record<string, string> = { answer: '✓', aborted: '■', error: '✗', refusal: '✗' }
const END_WORD: Record<string, string> = { answer: '답함', aborted: '중단', error: '오류', refusal: '거절' }

/** 프로젝트 하나의 요약 요청. 원문 낱말을 유지하게 한다 (draw 와 같은 원칙). */
export function summaryPrompt(p: ProjectReport, periodLabel: string): string {
  const reqs = p.entries.map(e => `- [${e.end ? END_WORD[e.end] : '결과 모름'}] ${e.text}`).join('\n')
  const commits = p.commits.map(c => `- ${c.subject}`).join('\n')
  const decisions = (p.decisions ?? []).map(d => `- ${d.question} → ${d.answer}`).join('\n')
  return [
    `아래는 "${p.name}" 프로젝트에서 ${periodLabel} 동안 사용자가 Claude 에게 보낸 요청, 사용자가 내린 결정(질문 → 답), 그 기간의 git 커밋 제목이다.`,
    '이 기간에 무엇을 했는지 한국어 문장 3개 이하로 적는다. 각 문장은 한 줄.',
    '요청·커밋에 있는 낱말과 식별자를 그대로 쓴다. 없는 일을 지어내지 않는다. 요청 앞 [ ] 는 그 요청의 결과다: 중단·오류면 그렇게 쓰고, 결과 모름이면 "요청했다" 로 쓴다.',
    '결정은 요청이 아니다: "질문 → 답" 은 사용자가 답대로 정한 것이다. 답이 "…해 주세요" 같은 부탁 꼴이어도 "…하기로 정했다" 로 쓰고, 결정에는 "요청했다" 를 쓰지 않는다.',
    '문장만 답한다. 머리말·목록 기호·코드 블록은 쓰지 않는다.',
    '',
    '요청:',
    reqs || '(없음)',
    '',
    '결정:',
    decisions || '(없음)',
    '',
    '커밋:',
    commits || '(없음)',
  ].join('\n')
}

// ── Work Report ──────────────────────────────────────────────

/** 종류별로 아꼈다고 칠 분 (기본값). 설정으로 바꾼다 */
export const MINUTES: Minutes = { edit: 20, run: 10, research: 15, chat: 5 }
const KIND_RANK: Record<Kind, number> = { chat: 0, research: 1, run: 2, edit: 3 }
const KIND_OF_TOOL: Record<string, Kind> = {
  Edit: 'edit', Write: 'edit', NotebookEdit: 'edit',
  Bash: 'run',
  Read: 'research', Grep: 'research', Glob: 'research', WebSearch: 'research', WebFetch: 'research', Agent: 'research', Task: 'research',
}

/** 도구 하나를 쓴 뒤의 종류. 앞 것(수정 > 실행 > 조사)이 이긴다. 실패·거부한 도구와 모르는 도구는 바꾸지 않는다 */
export function kindAfter(prev: Kind | undefined, tool: string, ok: boolean): Kind | undefined {
  const k = KIND_OF_TOOL[tool]
  if (!ok || !k) return prev
  return prev && KIND_RANK[prev] >= KIND_RANK[k] ? prev : k
}

const KIND_ORDER: (Kind | 'unknown')[] = ['edit', 'run', 'research', 'chat', 'unknown']

/** 기간의 숫자: 끝낸(답한) 요청만 센다. 옛 기록(종류 없음)은 기록 전, 아낀 시간 0 */
export function workOf(entries: readonly Entry[], minutes: Minutes): Work {
  const done = entries.filter(e => e.end === 'answer')
  const kinds = new Map<Kind | 'unknown', number>()
  const models = new Map<string, number>()
  for (const e of done) {
    const k = e.kind ?? 'unknown'
    kinds.set(k, (kinds.get(k) ?? 0) + 1)
    models.set(e.model ?? '', (models.get(e.model ?? '') ?? 0) + 1)
  }
  const minOf = (k: Kind | 'unknown', n: number) => (k === 'unknown' ? 0 : minutes[k] * n)
  const byKind = [...kinds]
    .map(([kind, count]) => ({ kind, count, min: minOf(kind, count) }))
    // 건수 순, 기록 전은 맨 뒤 (0.3.0 전 기록이 많아도 새 종류가 위에 오게)
    .sort((a, b) => (a.kind === 'unknown' ? 1 : 0) - (b.kind === 'unknown' ? 1 : 0) || b.count - a.count || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
  // 모델은 건수 순, 기록 전('')은 맨 뒤
  const byModel = [...models].map(([model, count]) => ({ model, count })).sort((a, b) => (a.model ? 0 : 1) - (b.model ? 0 : 1) || b.count - a.count)
  return {
    done: done.length,
    ms: done.reduce((n, e) => n + e.ms, 0),
    savedMin: byKind.reduce((n, k) => n + k.min, 0),
    byKind,
    byModel,
  }
}

/** 오늘부터(오늘이 비면 어제부터) 거꾸로 끊기지 않은 날 수 */
export function streakOf(activeDays: readonly string[], today: string): number {
  const set = new Set(activeDays)
  const prev = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10)
  let d = set.has(today) ? today : prev(today)
  let n = 0
  while (set.has(d)) {
    n++
    d = prev(d)
  }
  return n
}

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']

/** 차트 막대: 오늘·어제·7일은 최근 7일(요일), 30일은 날짜, 올해는 1~12월. 값은 아낀 시간(분) */
export function chartOf(period: Period, entries: readonly Entry[], now: number, offsetMin: number, minutes: Minutes): Bar[] {
  const minOfEntry = (e: Entry) => (e.end === 'answer' && e.kind ? minutes[e.kind] : 0)
  const today = dayOf(now, offsetMin)
  if (period === 'year') {
    const month = Number(today.slice(5, 7))
    const sums = Array.from({ length: 12 }, () => 0)
    for (const e of entries) {
      const d = dayOf(e.at, offsetMin)
      if (d.slice(0, 4) === today.slice(0, 4)) sums[Number(d.slice(5, 7)) - 1]! += minOfEntry(e)
    }
    return sums.map((min, i) => ({ label: String(i + 1), min, now: i + 1 === month, future: i + 1 > month }))
  }
  const last = period === 'yesterday' ? now - DAY_MS : now
  const days = periodDays(period === 'month' ? 'month' : 'week', last, offsetMin)
  const sums = new Map(days.map(d => [d, 0]))
  for (const e of entries) {
    const d = dayOf(e.at, offsetMin)
    if (sums.has(d)) sums.set(d, sums.get(d)! + minOfEntry(e))
  }
  return days.map(d => ({
    label: period === 'month' ? String(Number(d.slice(8, 10))) : WEEKDAY[new Date(`${d}T00:00:00Z`).getUTCDay()]!,
    min: sums.get(d)!,
    now: d === today,
    future: false,
  }))
}

// 3줄 높이 숫자. 점·쉼표는 1칸, 숫자는 3칸 (1 은 받침을 붙여 세로줄과 구별)
const DIGITS: Record<string, [string, string, string]> = {
  '0': ['┌─┐', '│ │', '└─┘'],
  '1': ['╶┐ ', ' │ ', '╶┴╴'],
  '2': ['╶─┐', '┌─┘', '└─╴'],
  '3': ['╶─┐', ' ─┤', '╶─┘'],
  '4': ['╷ ╷', '└─┤', '  ╵'],
  '5': ['┌─╴', '└─┐', '╶─┘'],
  '6': ['┌─╴', '├─┐', '└─┘'],
  '7': ['╶─┐', '  │', '  ╵'],
  '8': ['┌─┐', '├─┤', '└─┘'],
  '9': ['┌─┐', '└─┤', '╶─┘'],
  '.': [' ', ' ', '.'],
  ',': [' ', ' ', ','],
}

/** 숫자 글을 3줄 큰 글씨로. 모르는 글자는 빈칸 */
export function bigDigits(text: string): [string, string, string] {
  const glyphs = [...text].map(c => DIGITS[c] ?? [' ', ' ', ' '])
  return [0, 1, 2].map(r => glyphs.map(g => g[r]).join(' ')) as [string, string, string]
}

/** 'claude-opus-5-5' → 'Opus 5.5'. 기록 없음('') → '기록 전' */
export function modelName(id: string): string {
  if (!id) return '기록 전'
  const m = /^claude-([a-z]+)-(\d+)-(\d+)/.exec(id)
  return m ? `${m[1]![0]!.toUpperCase()}${m[1]!.slice(1)} ${m[2]}.${m[3]}` : id
}

/** 시간(분)을 '50분', '1.5시간', '12시간' 으로 */
export function hoursText(min: number): string {
  if (min < 60) return `${Math.round(min)}분`
  const h = min / 60
  return h < 10 ? `${Math.round(h * 10) / 10}시간` : `${Math.round(h)}시간`
}

// team-board/hooks/diagram.ts 에서 복사 (plugin 끼리 의존하지 않는다).
/** 터미널에서 차지하는 칸 수: 한글·한자·전각은 2칸. */
export function cells(text: string): number {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (c === 0x200d || (c >= 0x300 && c <= 0x36f) || (c >= 0xfe00 && c <= 0xfe0f)) continue
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0x303e) ||
      (c >= 0x3041 && c <= 0x33ff) ||
      (c >= 0x3400 && c <= 0x4dbf) ||
      (c >= 0x4e00 && c <= 0x9fff) ||
      (c >= 0xa960 && c <= 0xa97f) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff)
    n += wide ? 2 : 1
  }
  return n
}

/** 칸 수에 맞춰 오른쪽(end) 또는 왼쪽(start)에 빈칸을 채운다. 넘치면 그대로 */
export function pad(text: string, width: number, side: 'end' | 'start' = 'end'): string {
  const fill = ' '.repeat(Math.max(0, width - cells(text)))
  return side === 'end' ? text + fill : fill + text
}

const BLOCKS = ' ▁▂▃▄▅▆▇█'

/** 3줄 막대의 한 줄(row 0 = 맨 아래). 값은 0~24 (줄마다 8단계) */
export function blockRow(level: number, row: number): string {
  return BLOCKS[Math.max(0, Math.min(8, level - row * 8))]!
}
