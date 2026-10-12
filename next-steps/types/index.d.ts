/** 입력창 위에 보일 제안. 어느 턴의 답에서 나왔는지와 함께. */
export type NextSteps = { turnId: string; items: string[] }

/** 이번 세션에서 제안에 쓴 모델 사용량. */
export type Spent = { calls: number; input: number; output: number }

declare module 'claude-code' {
  interface PluginState {
    'next-steps': { steps: NextSteps | null; spent: Spent }
  }
}
