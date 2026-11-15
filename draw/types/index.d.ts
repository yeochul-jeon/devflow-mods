export type DrawFlow = {
  label: string
  steps: string[]
}

export type DrawData = {
  title: string
  flows: DrawFlow[]
  /** 그림에 담지 못한 갈래·조건 */
  notes: string[]
}

export type SeqMessage = {
  from: string
  to: string
  label: string
  /** 앞 메시지에 대한 응답·결과: 점선으로 그린다 */
  reply: boolean
}

/** /draw-seq: 누가 누구에게 무엇을 보내는지 */
export type SeqData = {
  title: string
  participants: string[]
  messages: SeqMessage[]
  /** 그림에 담지 못한 조건·갈래, 뺀 참여자·메시지 개수 */
  notes: string[]
}

export type DrawView = {
  status: 'idle' | 'loading' | 'done' | 'error'
  /** 없으면 'flow' (0.3 에서 저장된 값) */
  kind?: 'flow' | 'seq'
  data: DrawData | null
  /** kind 'seq' 의 그림 */
  seq?: SeqData | null
  /** error: 이유 */
  text: string
  /** /draw 뒤에 적은 초점 단어 */
  focus: string
}

declare module 'claude-code' {
  interface PluginState {
    draw: { view: DrawView; elapsed: number }
  }
}
