export type BeatState = 'working' | 'idle' | 'asking' | 'ended'

export type Task = { id: string; subject: string; status: 'pending' | 'in_progress' | 'completed' }

/** 내려진 결정 하나: 무엇을 물었고 무엇으로 정했는지. */
export type Decision = { at: number; question: string; answer: string }

/** 세션 흐름의 한 칸. */
export type Event = { at: number; kind: 'prompt' | 'done' | 'ask' | 'decide' | 'abort'; text: string }

/** 세션 하나가 공유 폴더에 쓰는 상태 한 장. */
export type Beat = {
  id: string
  name: string
  cwd: string
  state: BeatState
  step: string
  prompt: string
  last: string
  /** 지금 기다리는 결정 요청 원문 */
  question: string
  contextPct: number | null
  tasks: Task[]
  decisions: Decision[]
  timeline: Event[]
  edits: number
  files: string[]
  updatedAt: number
}

export type ExplainOption = { label: string; flow: string[]; result: string }
export type ExplainItem = { title: string; analogy: string; options: ExplainOption[]; link: string; suggest: string }
/** 모델이 준 12살 설명의 내용. 그림은 mod 가 그린다. */
export type ExplainData = { items: ExplainItem[]; first: string }

/** 12살 설명. question 은 설명을 만든 그 질문: 질문이 바뀌면 보이지 않는다. data 가 없으면 text 를 글로 보여준다. */
export type Explain = { id: string; question: string; status: 'loading' | 'done' | 'error'; text: string; data: ExplainData | null }

declare module 'claude-code' {
  interface PluginState {
    'team-board': {
      beats: Beat[]
      explain: Explain | null
      pending: string | null
      /** 자세히 보는 세션 id, null 이면 전체 보기 */
      focus: string | null
      /** 이 세션 자신의 기록. 모듈이 다시 로드돼도 같은 세션으로 이어진다. */
      me: Beat | null
      /** 접어 둔 설명 (세션 id) */
      collapsed: string[]
      /** 입력창 위 띠를 끔 */
      bandOff: boolean
    }
  }
}
