/** 사람 요청 하나. 하루·세션마다 파일 하나에 모은다. */
export type Entry = {
  /** 요청을 보낸 시각 (ms) */
  at: number
  /** 요청 글, 200자, 비밀 값 가림 */
  text: string
  /** 저장소 루트 (저장소 밖이면 작업 폴더) */
  root: string
  /** 이 요청이 시작한 턴. 턴이 아직 시작하지 않았으면 '' */
  turnId: string
  /** 턴이 끝난 모양. 아직 안 끝났거나 모르면 null */
  end: 'answer' | 'aborted' | 'error' | 'refusal' | null
  /** 턴이 걸린 시간 */
  ms: number
  /** 메인 요청들의 토큰 합: 입력·출력·캐시 읽기·캐시 쓰기 */
  tokens: number
  /** Edit·Write·NotebookEdit 로 바꾼 파일 (경로, 겹침 없음) */
  files: string[]
}

export type DayFile = { v: 1; entries: Entry[] }

export type Period = 'today' | 'yesterday' | 'week' | 'month'

export type Commit = { at: number; hash: string; subject: string }

/** team-board 가 기록한 결정: 무엇을 물었고 무엇으로 정했는지. */
export type Decision = { at: number; question: string; answer: string }

export type ProjectReport = {
  root: string
  name: string
  entries: Entry[]
  commits: Commit[]
  /** git log 을 못 읽었으면 이유 */
  commitError: string
  /** team-board 상태 파일에서 읽은 결정 (0.2.0 전 화면 상태에는 없음) */
  decisions: Decision[]
  ms: number
  tokens: number
}

export type Report = {
  period: Period
  /** 기간의 첫 날과 마지막 날 (로컬 'YYYY-MM-DD', 둘 다 포함) */
  from: string
  to: string
  projects: ProjectReport[]
}

export type LookView = {
  status: 'idle' | 'loading' | 'done' | 'error'
  report: Report | null
  text: string
  /** 저장소 루트 → 요약 (만드는 중이면 '…') */
  summaries: Record<string, string>
  /** 보고서를 만든 시각. 요약이 끝났을 때 같은 보고서인지 본다 */
  loadedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    'look-back': { view: LookView }
  }
}
