/** 입력창 위에 보일 제안. 어느 턴의 답에서 나왔는지와 함께. */
export type NextSteps = { turnId: string; items: string[] }

/** 이번 세션에서 제안에 쓴 모델 사용량. */
export type Spent = { calls: number; input: number; output: number }

declare module 'claude-code' {
  interface PluginState {
    'next-steps': { steps: NextSteps | null; spent: Spent }
    /** 읽기만 한다. pending: prompt-coach 가 답을 기다리는 질문("prompt-coach: …") 또는 null. band: 입력창에 초안이 있는지. flow: 다듬기 단계('idle' 이 쉬는 중). prompt-coach/types/index.d.ts 의 것과 같다 */
    'prompt-coach': { pending: string | null; band: { hasDraft: boolean }; flow: { stage: string } }
    /** 읽기만 한다. image-preview 가 입력창에 붙은 이미지 번호. image-preview 가 없으면 오지 않는다 */
    'image-preview': { draft: number[] }
  }
}
