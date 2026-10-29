export type BeatState = 'working' | 'idle' | 'asking' | 'ended'

export type Task = {
  id: string
  subject: string
  status: 'pending' | 'in_progress' | 'completed'
  /** work-plan 보고에서 이 단계가 끝났다고 처음 본 보고 시각 (T25 B, 0.26.0 전 파일·할 일 도구 목록에는 없음) */
  doneAt?: number
}

/** 내려진 결정 하나: 무엇을 물었고 무엇으로 정했는지. */
export type Decision = { at: number; question: string; answer: string }

/** 세션 흐름의 한 칸. */
export type Event = { at: number; kind: 'prompt' | 'done' | 'ask' | 'decide' | 'abort' | 'fail' | 'clear'; text: string }

/** exit 0 인데 출력에 실패 흔적이 있던 Bash 실행. high = 실패, warn = 확인 필요(건너뛴 테스트 등). */
export type FailAlert = { at: number; command: string; key: string; level: 'high' | 'warn'; signs: string[]; masks: string[] }

/** 이 세션이 편집한 파일 하나: 저장소 안 상대 경로와 마지막 편집 시각 (T34 D1) */
export type Touch = { path: string; at: number }

/** 작업 폴더의 git 상태: 브랜치, upstream 보다 앞선·뒤진 커밋, 커밋 안 한 파일 수(새 파일 포함), 커밋 안 한 줄 수 (T34 B2) */
export type GitState = { branch: string; ahead: number; behind: number; files: number; add: number; del: number; at: number }

/** 직전 대화 한 줄: 누가 무엇을 말했는지 (텍스트만, 잘린 것). */
export type RecentLine = { role: 'user' | 'assistant'; text: string }

/** 이 세션이 띄운 보조 에이전트(서브에이전트·워크플로 에이전트) 하나. tokens 는 요청마다 더한 입력+출력 토큰. */
export type SubAgent = {
  id: string
  desc: string
  type: string
  model: string
  status: 'working' | 'done' | 'failed'
  /** 지금 쓰는 도구 (끝나면 '') */
  tool: string
  startedAt: number
  endedAt: number | null
  tokens: number
}

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
  /** 결정 요청 직전 대화 (설명의 맥락). 결정 대기일 때만 채운다 */
  recent: RecentLine[]
  contextPct: number | null
  tasks: Task[]
  /** tasks 가 이미 끝난(중단·오류) work-plan 계획인지. 새 보고 전까지 작업 중이어도 진행 중으로 그리지 않는다 (0.24.3 전 파일에는 없음) */
  planEnded?: boolean
  /** work-plan 계획의 첫 보고 시각. 첫 단계의 걸린 시간을 여기서부터 잰다 (T25 B) */
  planStartAt?: number
  decisions: Decision[]
  timeline: Event[]
  edits: number
  files: string[]
  /** 코드를 고친 뒤 검증 명령 없이 턴이 끝남: 마지막 코드 편집 시각과 그 뒤 검증 안 된 파일 수 (T34 B1, 0.28 전 파일에는 없음) */
  unverified?: { at: number; files: number } | null
  /** 수정 없이 같은 명령이 3번 연속 실패함: 명령 키, 연속 실패 수 (T34 A4, 0.28 전 파일에는 없음) */
  stuck?: { at: number; key: string; count: number } | null
  /** 턴이 끝날 때 읽은 작업 폴더의 git 상태 (T34 B2, 0.28 전 파일에는 없음). git 저장소가 아니면 null */
  git?: GitState | null
  /** 사람이 마지막으로 요청을 보낸 시각. 흐름(12개)에서 밀려나도 남는다 (T34 D2, 0.28.9 전 파일에는 없음) */
  promptAt?: number
  /** 이번 요청 뒤 메인 세션의 마지막 도구 작업 (describeTool). 질문 맥락의 직전 줄에 쓴다. 질문할 때만 채운다 (0.28.10 전 파일에는 없음) */
  lastTool?: string
  /** 이 기록을 처음 만든 시각 (세션 나이, 0.28 전 파일에는 없음) */
  startedAt?: number
  /** 최근 편집한 경로와 시각, 12개. 같은 파일 겹침을 찾는다 (0.28 전 파일에는 없음) */
  touched?: Touch[]
  /** 아직 풀리지 않은 숨은 실패 (같은 명령이 깨끗하게 다시 돌면 지워짐) */
  fail: FailAlert | null
  /** 이 세션의 보조 에이전트. 사람이 다음 프롬프트를 보내면 끝난 것을 지운다 (0.18 전 파일에는 없음) */
  agents: SubAgent[]
  /** 이 세션이 SendMessage 로 일을 맡긴 팀메이트 세션 id. 왕관 기준 (T43, 0.29 전 파일에는 없음) */
  leads?: string[]
  /** 엔진이 이 세션을 부르는 이름 (ListAgents·SendMessage 의 주소, `[ref]` 없이). 리더 판정에서 받는 이름과 비교 (T46, 0.29.3 전 파일에는 없음) */
  addr?: string
  /** 마지막 메인 스레드 모델 요청 시각. 프롬프트 캐시 남은 시간의 기준 (compact·/clear 뒤엔 null) */
  cacheAt: number | null
  /** 이 세션의 프롬프트 캐시 수명(ms): 구독 1시간, API 키 등 5분 (0.29.11 전 파일에는 없음 → 1시간) */
  cacheTtl?: number
  /** 5분 넘게 쉰 뒤 실제 적중으로 본 수명. 다음 관찰이 나오면 바뀐다 (0.29.13) */
  cacheObserved?: '1h' | '5m'
  /** 앞 메인 요청의 cache_read + cache_creation. 다음 요청이 얼마나 읽었는지 비교하는 기준 (0.29.13) */
  cachePrefix?: number
  /** 대화 첫 메인 요청이 읽은 캐시 = 다른 세션과 같이 쓰는 앞부분. 비율을 잴 때 뺀다 (0.29.14) */
  cacheShared?: number
  /** 5분 넘게 쉰 뒤 이어서 못 읽은 횟수. 2번이면 5분 캐시 (0.29.14) */
  cacheMisses?: number
  updatedAt: number
}

export type ExplainOption = { label: string; flow: string[]; result: string }
export type ExplainItem = { title: string; analogy: string; options: ExplainOption[]; link: string; suggest: string }
/** 모델이 준 12살 설명의 내용. 그림은 mod 가 그린다. why 는 지금 이 결정이 필요한 이유 (옛 답은 ""). */
export type ExplainData = { items: ExplainItem[]; first: string; why: string }

/** 12살 설명. question 은 설명을 만든 그 질문: 질문이 바뀌면 보이지 않는다. data 가 없으면 text 를 글로 보여준다. */
export type Explain = { id: string; question: string; status: 'loading' | 'done' | 'error'; text: string; data: ExplainData | null }

/** ASD-STE100 선택지: 이름과 그 선택지를 고르면 일어나는 일의 문장들. */
export type SteOption = { label: string; ste: string[] }
/** ASD-STE100 항목: 정할 것, 선택지, 세션 제안. ste 는 0.14 까지의 평평한 문장 목록 (새 답에서는 []). */
export type SteItem = { title: string; decide: string; options: SteOption[]; suggest: string; ste: string[] }
/** ASD-STE100 기준 설명: 결정 항목마다 하나. */
export type SteData = { items: SteItem[]; why: string }
/** ASD-STE100 설명. 규칙은 Explain 과 같다. */
export type SteExplain = { id: string; question: string; status: 'loading' | 'done' | 'error'; text: string; data: SteData | null }

/** 설명 탭: 12살 또는 ASD-STE100 */
export type ExplainKind = 'kid' | 'ste'

/**
 * work-plan mod 가 $.state 에 두는 작업 계획. work-plan/types/index.d.ts 의 선언을 그대로 복사했다
 * (dependencies 를 두지 않으려고). 모르는 v 는 무시한다.
 */
export type WorkPlan = {
  v: 1
  steps: { title: string; status: 'todo' | 'doing' | 'done' | 'blocked' }[]
  updatedAt: number
  /** compaction 뒤 아직 새 보고가 없음 */
  stale: boolean
  /** 턴이 끝났고 그 뒤 보고가 없음 */
  ended: { reason: 'answer' | 'aborted' | 'refusal' | 'error'; at: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    'team-board': {
      beats: Beat[]
      explain: Explain | null
      steExplain: SteExplain | null
      /** 고른 설명 탭 */
      tab: ExplainKind
      /** 만들 설명 요청 줄: `kid:<세션 id>` / `ste:<세션 id>` */
      queue: string[]
      /** HTML 설명을 요청한 질문 (질문 하나에 한 번) */
      html: { id: string; question: string } | null
      /** 자세히 보는 세션 id, null 이면 전체 보기 */
      focus: string | null
      /** 전체 보기 도움말 상자에서 명령 목록을 펼침 (T52) */
      helpOpen: boolean
      /** 이 세션 자신의 기록. 모듈이 다시 로드돼도 같은 세션으로 이어진다. */
      me: Beat | null
      /** 접어 둔 설명 (세션 id) */
      collapsed: string[]
      /** 입력창 위 띠를 끔 */
      bandOff: boolean
      /** 띠 모양: hud (창) 또는 line (한 줄) */
      bandMode: 'hud' | 'line'
      /** 세션이 하나일 때 팀 창을 숨김 */
      bandSoloOff: boolean
      /** 카드 타일 캐릭터: blob(말랑이) · bot(삐삐) · ghost(둥실) · mix(세션 이름으로 섞기) */
      look: 'blob' | 'bot' | 'ghost' | 'mix'
    }
    /** 읽기만 한다. work-plan 이 없으면 값이 없다 */
    'work-plan': { plan: WorkPlan | null }
    /** 읽기만 한다. prompt-coach 가 답을 기다리는 질문("prompt-coach: …") 또는 null. prompt-coach/types/index.d.ts 의 pending 과 같다 */
    'prompt-coach': { pending: string | null }
  }
}
