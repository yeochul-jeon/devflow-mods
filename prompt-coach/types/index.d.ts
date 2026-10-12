/** 입력창 위 띠의 상태: 초안이 있는지, 다듬는 중인지. */
export type CoachBand = { hasDraft: boolean; busy: boolean }

/** 이번 세션에서 다듬기에 쓴 모델 사용량. */
export type Spent = { calls: number; input: number; output: number }

declare module 'claude-code' {
  interface PluginState {
    'prompt-coach': { band: CoachBand; spent: Spent; original: string }
  }
}
