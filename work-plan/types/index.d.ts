/** 단계 하나의 상태. */
export type StepStatus = 'todo' | 'doing' | 'done' | 'blocked'

/** 모델이 보고한 작업 계획. team-board 가 같은 선언을 복사해 읽는다: 모양을 바꾸면 v 를 올린다. */
export type WorkPlan = {
  /** 모양 버전. 읽는 쪽은 모르는 v 를 무시한다. */
  v: 1
  steps: { title: string; status: StepStatus }[]
  updatedAt: number
  /** compaction 뒤 아직 새 보고가 없음 */
  stale: boolean
  /** 턴이 끝났고 그 뒤 보고가 없음 */
  ended: { reason: 'answer' | 'aborted' | 'refusal' | 'error'; at: number } | null
}

declare module 'claude-code' {
  interface PluginState {
    'work-plan': { plan: WorkPlan }
  }
}
