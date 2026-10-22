export type Eli12Flow = {
  label: string
  steps: string[]
}

export type Eli12Data = {
  summary: string
  analogy: string
  flows: Eli12Flow[]
  /** 직전 답 설명: 기억할 것 */
  remember: string[]
  /** 주제 설명: 비유가 맞지 않는 부분 */
  mismatch: string
  /** 주제 설명: 실제 용어로 다시 */
  real: string
}

export type Eli12View = {
  status: 'idle' | 'loading' | 'done' | 'error'
  data: Eli12Data | null
  /** error: 이유 */
  text: string
  /** /eli12 뒤에 적은 초점 단어 */
  focus: string
}

declare module 'claude-code' {
  interface PluginState {
    eli12: { view: Eli12View }
  }
}
