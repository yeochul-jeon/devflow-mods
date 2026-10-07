export type Eli12View = {
  status: 'idle' | 'loading' | 'done' | 'error'
  /** 패널에 보여줄 본문 (done: 쉬운 설명, error: 이유) */
  text: string
  /** /eli12 뒤에 적은 초점 단어 */
  focus: string
}

declare module 'claude-code' {
  interface PluginState {
    eli12: { view: Eli12View }
  }
}
