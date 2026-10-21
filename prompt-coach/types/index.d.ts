/** 입력창 위 띠의 상태: 입력창에 초안이 있는지. */
export type CoachBand = { hasDraft: boolean }

/** 이번 세션에서 다듬기에 쓴 모델 사용량. */
export type Spent = { calls: number; input: number; output: number }

/** 다듬기 전에 묻는 질문. 선택지는 2~4개, 건너뛰기·직접 쓰기는 화면이 붙인다. */
export type Question = { q: string; options: string[] }

/** 다듬은 글에 보탠 것. answer 는 질문 답에서, suggest 는 모델이 스스로 보탠 결과 모양·완료 확인. */
export type Added = { kind: 'answer' | 'suggest'; text: string }

/**
 * 질문 → 다시 쓰기 흐름. 질문하는 동안 초안은 입력창이 아니라 여기에 있다(숫자 키로 답하려고 입력창을 비운다).
 * answers 는 질문 순서대로, 건너뛴 질문은 null. 길이가 지금 질문의 번호다.
 */
export type CoachFlow =
  | { stage: 'idle' }
  | { stage: 'asking' | 'rewriting'; draft: string }
  | { stage: 'questions'; draft: string; questions: Question[]; answers: (string | null)[] }
  | { stage: 'done'; added: Added[] }

declare module 'claude-code' {
  interface PluginState {
    'prompt-coach': {
      band: CoachBand
      spent: Spent
      original: string
      refined: string
      flow: CoachFlow
      /** 자동 모드(보낼 때 먼저 질문). 설정은 $.store 에 두고 이것은 띠 표시용 사본이다. */
      auto: boolean
      /** 다음 한 번의 보내기는 가로채지 않는다. 다듬은 글을 넣었거나 취소·실패로 초안을 돌려놓았을 때 켠다. */
      bypass: boolean
      /** 답을 기다리는 질문("prompt-coach: …"), 없으면 null. team-board 가 읽어 결정 필요로 보인다. */
      pending: string | null
      /** Claude 의 질문을 기다리는 중인지(team-board 가 본 것). 자동 모드는 그 답을 가로채지 않는다. 다음 턴이 시작되면 끈다. */
      claudeAsking: boolean
    }
    /** 읽기만 한다. team-board 가 없으면 오지 않는다. team-board/types/index.d.ts 의 Beat 에서 쓰는 필드만 */
    'team-board': { me: { state: string; question: string } | null }
  }
}
