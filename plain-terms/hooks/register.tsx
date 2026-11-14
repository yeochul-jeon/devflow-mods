// plain-terms: 약어·작업 번호·코드 이름을 처음 쓸 때 풀어 쓰게 하는 규칙을 붙인다. 화면 표시는 없다.
import type { Register } from 'claude-code'

import { AWAY_MS, RETURN_NOTE, RULE } from './rule'

// 다음 프롬프트에 규칙을 붙일지. 대화 첫 프롬프트, compaction 뒤, /clear·/resume 뒤에 한 번씩.
let pending = true
// 직전 프롬프트(슬래시 명령 포함) 시각. 자리를 비웠는지 본다
let lastSubmitAt: number | null = null
// 돌아온 것을 봤지만 알림(또는 규칙)이 아직 모델에 닿지 않았다. 슬래시 명령·막힌 보내기 뒤에도 남는다
let awaySeen = false
// 사람이 보낸 프롬프트: 터미널 입력, Remote Control, claude -p·SDK
const PERSON_ORIGINS: readonly (string | undefined)[] = ['composer', 'bridge', 'sdk']

export const register: Register = on => {
  // 규칙은 system prompt 가 아니라 프롬프트 문맥으로 붙인다. 조직 관리 환경에서는 prompt.compose 가 돌지 않는다.
  // 슬래시 명령은 모델에 닿지 않을 수 있어 건너뛰고 다음 프롬프트에 붙인다.
  on('prompt.submit', async ($, e, next) => {
    // 자리 비움은 사람이 보낸 프롬프트로만 잰다. 작업 알림·예약 실행·다른 세션 메시지는 시각을 옮기지 않고 알림도 쓰지 않는다
    const byPerson = PERSON_ORIGINS.includes(e.origin?.kind)
    if (byPerson) {
      const now = await $.clock.now()
      if (lastSubmitAt !== null && now - lastSubmitAt >= AWAY_MS) awaySeen = true
      lastSubmitAt = now
    }
    if (e.text.trim().startsWith('/')) return next(e)
    // 규칙이 붙으면 처음부터 다시 풀게 하므로 돌아옴 알림은 따로 붙이지 않는다
    const note = pending ? RULE : awaySeen && byPerson ? RETURN_NOTE : null
    if (!note) return next(e)
    const was = { pending, awaySeen }
    pending = false
    awaySeen = false
    const r = await next({ ...e, context: [...(e.context ?? []), note] })
    // 다른 mod 가 막은(drop) 프롬프트는 들어가지 않았다. 다음 프롬프트에 붙인다
    if (r.drop !== undefined) ({ pending, awaySeen } = was)
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
