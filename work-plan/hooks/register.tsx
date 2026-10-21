// work-plan: 모델이 여러 단계 작업의 계획을 plan_update 로 보고하면 $.state 에 둔다.
// 화면 표시는 하지 않는다. team-board 가 이 atom 을 관찰해 진행 줄을 그린다 (dependencies 없음).
import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { WorkPlan } from '../types'
import { contextFor, emptyPlan, FIRST_NUDGE, FIRST_NUDGE_AFTER, GATE_DENY, GATE_OPEN_AFTER, GATED_TOOLS, isOpen, normalizeSteps, NUDGE, NUDGE_AFTER, NUDGE_TOOLS, TOOL_DESCRIPTION, withEnded, withStale, withSteps } from './plan'

const TOOL = 'mcp__work-plan__plan_update'
const plan = atom({ plugin: 'work-plan', key: 'plan' } as const, emptyPlan(0) as WorkPlan)

// 다음 프롬프트에 붙일 문맥. 대화 첫 프롬프트, compaction 뒤, /clear·/resume 뒤에 한 번씩.
let pending: 'start' | 'compact' | null = 'start'

// planGate: 이번 메인 턴에 계획 보고가 있었나, 몇 번 거부했나. 메인 turn.start 마다 새로.
// 보고 여부는 plan_update 호출로 정한다. 엔진은 응답이 다 오기 전에 도구를 차례로 돌리므로 turn.step 결과는 늦다 (2026-10-18 실측).
let gateTurn = { planned: false, denied: 0 }

// 갱신 알림: 메인 루프가 마지막 plan_update 뒤 작업 도구를 몇 번 썼나
let sinceReport = 0
// 첫 보고 알림: 이번 메인 턴에 열린 계획 없이 작업 도구를 몇 번 썼나. 메인 turn.complete 와 plan_update 에서 0
let unplanned = 0

export const register: Register = (on, options) => {
  const gate = options.planGate === true
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'plan_update',
      description: TOOL_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'Short step title, under 60 characters' },
                status: { type: 'string', enum: ['todo', 'doing', 'done', 'blocked'] },
              },
              required: ['title', 'status'],
            },
          },
        },
        required: ['steps'],
      },
      isDeferred: false,
    })
    return next(e)
  })

  // 규칙은 system prompt 가 아니라 첫 프롬프트 문맥으로 붙인다. 조직 관리 환경에서는 prompt.compose 가 돌지 않는다.
  // 슬래시 명령은 모델에 닿지 않을 수 있어 건너뛰고 다음 프롬프트에 붙인다.
  on('prompt.submit', async ($, e, next) => {
    if (!pending || e.text.trim().startsWith('/')) return next(e)
    const why = pending
    pending = null
    return next({ ...e, context: [...(e.context ?? []), contextFor(await read($, plan), why, gate)] })
  })

  // 서브에이전트의 계획은 메인 진행 줄이 아니므로 받기만 하고 저장하지 않는다.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    const steps = normalizeSteps((e as unknown as { steps?: unknown }).steps)
    if (!steps) return { deny: 'plan_update: steps must be an array of { title, status }' }
    if (!e.agentId) {
      if (steps.length > 0) gateTurn.planned = true
      sinceReport = 0
      unplanned = 0
      const now = await $.clock.now()
      await update($, plan, p => withSteps(p, steps, now))
    }
    return { result: `ok: ${steps.length} steps` }
  }).catch(($, e, next) => ({ deny: `plan_update failed: ${next.error.message}` }))

  // 턴이 끝났다는 표시만 남긴다. 남은 단계를 완료로 볼지는 읽는 쪽(team-board)이 결정 대기 여부와 함께 정한다.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId) {
      unplanned = 0
      const p = await read($, plan)
      if (p.steps.length > 0) {
        const now = await $.clock.now()
        await update($, plan, cur => withEnded(cur, e.reason, now))
      }
    }
    return r
  })

  // precompute 와 거부된 compaction 은 대화를 바꾸지 않는다.
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && r.messages) {
      await update($, plan, withStale)
      pending = 'compact'
    }
    return r
  })

  // /clear 와 같은 탭의 /resume 은 대화만 바뀐다 (session.start 가 다시 오지 않음). team-board 가 할 일을 비우는 때와 같다.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') {
      const now = await $.clock.now()
      await update($, plan, () => emptyPlan(now))
      pending = 'start'
      unplanned = 0
    }
    return next(e)
  })

  // 갱신 알림: 계획이 열린 동안 보고 없이 작업 도구가 NUDGE_AFTER 번 지나면 그 결과에 한 줄. 거부된 호출은 세지 않는다.
  // 계획이 없으면 이번 턴 FIRST_NUDGE_AFTER 번째에 한 번만 첫 보고를 권한다.
  // matcher 없는 tool.call 은 한 번만 달 수 있어(게이트가 쓴다) 도구 목록 matcher 로 단다.
  on('tool.call', { tool: NUDGE_TOOLS }, async ($, e, next) => {
    if (e.agentId) return next(e)
    const r = await next(e)
    if (r.deny !== undefined) return r
    const p = await read($, plan)
    if (!isOpen(p)) {
      sinceReport = 0
      // 이번 턴에 보고한 계획이 모두 끝난 뒤의 호출은 세지 않는다
      if (p.steps.length > 0 && p.ended === null) return r
      unplanned += 1
      return unplanned === FIRST_NUDGE_AFTER ? { ...r, context: [...(r.context ?? []), FIRST_NUDGE] } : r
    }
    sinceReport += 1
    if (sinceReport < NUDGE_AFTER) return r
    sinceReport = 0
    return { ...r, context: [...(r.context ?? []), NUDGE] }
  })

  // 게이트는 켰을 때만 hook 을 단다. 끄면 0.1.1 과 같은 체인이다.
  if (!gate) return

  on('turn.start', async ($, e, next) => {
    if (!e.agentId) gateTurn = { planned: false, denied: 0 }
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    if (e.agentId || !GATED_TOOLS.includes(e.tool) || gateTurn.planned || gateTurn.denied >= GATE_OPEN_AFTER) return next(e)
    gateTurn.denied += 1
    return { deny: GATE_DENY }
  }).catch(($, e, next) => next(e)) // 게이트가 고장 나면 막지 않고 통과시킨다
}
