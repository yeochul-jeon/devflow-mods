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

export type DrawView = {
  status: 'idle' | 'loading' | 'done' | 'error'
  data: DrawData | null
  /** error: 이유 */
  text: string
  /** /draw 뒤에 적은 초점 단어 */
  focus: string
}

declare module 'claude-code' {
  interface PluginState {
    draw: { view: DrawView }
  }
}
