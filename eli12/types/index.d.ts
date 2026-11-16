export type Eli12Flow = {
  label: string
  steps: string[]
}

export type SeqMessage = {
  from: string
  to: string
  label: string
  /** 앞 메시지에 대한 응답·결과: 점선으로 그린다 */
  reply: boolean
}

/** 누가 누구에게 무엇을 보내는지 (draw 의 SeqData 와 같은 모양) */
export type SeqData = {
  title: string
  participants: string[]
  messages: SeqMessage[]
  /** 뺀 메시지 개수 등 그림에 담지 못한 것 */
  notes: string[]
}

export type Eli12Data = {
  summary: string
  analogy: string
  flows: Eli12Flow[]
  /** 주고받음 설명이면 흐름 대신 그리는 시퀀스 (0.4.0). 있으면 flows 는 비어 있다 */
  sequence?: SeqData | null
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
    eli12: { view: Eli12View; elapsed: number }
  }
}
