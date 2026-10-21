// plain-terms: 약어·작업 번호·코드 이름을 처음 쓸 때 풀어 쓰게 하는 규칙을 붙인다. 화면 표시는 없다.
import type { Register } from 'claude-code'

import { RULE } from './rule'

// 다음 프롬프트에 규칙을 붙일지. 대화 첫 프롬프트, compaction 뒤, /clear·/resume 뒤에 한 번씩.
let pending = true

export const register: Register = on => {
  // 규칙은 system prompt 가 아니라 프롬프트 문맥으로 붙인다. 조직 관리 환경에서는 prompt.compose 가 돌지 않는다.
  // 슬래시 명령은 모델에 닿지 않을 수 있어 건너뛰고 다음 프롬프트에 붙인다.
  on('prompt.submit', async ($, e, next) => {
    if (!pending || e.text.trim().startsWith('/')) return next(e)
    pending = false
    const r = await next({ ...e, context: [...(e.context ?? []), RULE] })
    // 다른 mod 가 막은(drop) 프롬프트는 들어가지 않았다. 다음 프롬프트에 붙인다
    if (r.drop !== undefined) pending = true
    return r
  })

  // precompute 와 거부된 compaction 은 대화를 바꾸지 않는다.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && r.messages) pending = true
    return r
  })

  // /clear 와 같은 탭의 /resume 은 대화만 바뀐다 (session.start 가 다시 오지 않음).
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') pending = true
    return next(e)
  })
}
