// 순수 함수만 둔다. $ 에 의존하지 않아 테스트하기 쉽다.
import type { StepStatus, WorkPlan } from '../types'

export const MAX_TITLE = 60
export const MAX_STEPS = 30
const STATUSES: readonly StepStatus[] = ['todo', 'doing', 'done', 'blocked']

/** 대화 첫 프롬프트에 한 번 붙이는 규칙 (9.6.2 v2: 보고 전용 요청을 만들지 않는 문구 + 5단계 실세션 뒤: 사용자 언어, 첫 보고는 첫 작업과 함께 + v1.1: 작업 도구 2회 이상이면 한 응답에 몰아도 보고). */
export const RULE = `# Plan reporting
Whenever your turn will make two or more work tool calls (Write, Edit, Bash, ...), report the plan with plan_update: every step as a short title, in the language the user writes in. This holds even when all of them go in one response.
Send the first plan_update in the same response as your first work tool call, and later updates together with later work tool calls. Never send a response whose only tool call is plan_update.
Do not split work you would otherwise batch just to update a status.
You do not need to report the final "done": the plan closes itself when your turn ends.
Skip plan_update only for a question or a single tool call.`

/** 규칙이 닿지 않는 환경에서도 남는 유일한 안내라 규칙의 핵심을 담는다. */
export const TOOL_DESCRIPTION =
  'Report the current work plan: every step with its status, the whole list each time, titles in the language the user writes in. The person sees it as a progress line. Call it whenever the turn makes two or more work tool calls, even all in one response: send the first one with your first work tool call, and each one only alongside a work tool call in the same response, never alone; the final "done" is not needed, the plan closes when the turn ends.'

/**
 * 모델 입력을 단계 목록으로. 배열이 아니면 null.
 * 제목은 앞뒤 공백을 지우고 60자(코드 포인트)로 자르며, 빈 제목은 버린다. 모르는 status 는 todo. 30개까지.
 */
export function normalizeSteps(input: unknown): WorkPlan['steps'] | null {
  if (!Array.isArray(input)) return null
  const steps: WorkPlan['steps'] = []
  for (const item of input) {
    const title = [...String(item?.title ?? '').trim()].slice(0, MAX_TITLE).join('')
    if (title === '') continue
    const status = STATUSES.includes(item?.status) ? (item.status as StepStatus) : 'todo'
    steps.push({ title, status })
  }
  return steps.slice(0, MAX_STEPS)
}

export function emptyPlan(now: number): WorkPlan {
  return { v: 1, steps: [], updatedAt: now, stale: false, ended: null }
}

/** 새 보고: 목록을 통째로 바꾸고 낡음·턴 끝 표시를 지운다. */
export function withSteps(plan: WorkPlan, steps: WorkPlan['steps'], now: number): WorkPlan {
  return { ...plan, steps, updatedAt: now, stale: false, ended: null }
}

/** 턴 끝: 단계 상태는 그대로 둔다. 남은 단계를 어떻게 그릴지는 읽는 쪽이 정한다. */
export function withEnded(plan: WorkPlan, reason: NonNullable<WorkPlan['ended']>['reason'], now: number): WorkPlan {
  return { ...plan, ended: { reason, at: now } }
}

/** compaction 뒤: 다음 보고가 올 때까지 낡은 계획으로 표시한다. */
export function withStale(plan: WorkPlan): WorkPlan {
  return { ...plan, stale: true }
}

/** 첫 프롬프트에 붙일 문맥. compact 뒤에는 모델이 계획을 다시 알도록 지금 목록을 덧붙인다. 게이트를 켰으면 그 사실을 한 줄 더한다. */
export function contextFor(plan: WorkPlan, why: 'start' | 'compact', gate = false): string {
  const rule = gate ? `${RULE}\n${GATE_RULE}` : RULE
  if (why === 'start' || plan.steps.length === 0) return rule
  const lines = plan.steps.map(s => `- [${s.status}] ${s.title}`)
  return `${rule}\n\nYour plan before the conversation was compacted (report it again with plan_update when you continue):\n${lines.join('\n')}`
}

// planGate 옵션 (G6). 파일을 바꾸는 도구만 막는다: Bash 는 조사·테스트에 쓰여 막으면 잡음이 크다.
export const GATED_TOOLS: readonly string[] = ['Edit', 'Write', 'NotebookEdit']
/** 한 턴에 이만큼 거부하면 그 턴은 풀어 준다. 도구를 못 부르는 환경에서 작업이 멈추지 않게. */
export const GATE_OPEN_AFTER = 3

export const GATE_RULE =
  'Plan gate is on: in every turn, Edit, Write and NotebookEdit are refused until you send plan_update in that turn, even for a single edit. Put plan_update before your first edit in the same response: tools run in order as the response arrives.'

export const GATE_DENY =
  'Refused by the work-plan plan gate: no plan_update in this turn yet. Send plan_update with every step of this task, placed before this call in the same response (tools run in order as the response arrives), then make this call again.'

// 갱신 알림 (T24). 실측: 보고가 있는 턴 38개 중 30개가 턴 시작에 한 번만 보고해 진행 줄이 첫 단계에 머물렀다.
// 계획이 열린 동안 메인 루프의 작업 도구를 세어, 보고 없이 이만큼 지나면 그 도구 결과에 한 줄을 붙인다. 요청은 늘지 않는다.
// 규칙 문구에 "단계마다 다시 보고"를 넣는 안은 -p 긴 작업에서 비용이 약 15% 늘어 쓰지 않았다 (보고가 잘 오는 턴은 알림 비용 0).
export const NUDGE_TOOLS = ['Edit', 'Write', 'NotebookEdit', 'Bash'] as const
export const NUDGE_AFTER = 5

export const NUDGE = `work-plan: ${NUDGE_AFTER} work calls since your last plan_update. If a step finished, send plan_update (that step done, the next doing) with your next work tool call.`

// 첫 보고 알림: 계획 없이 작업 도구가 이만큼 지나면 그 턴에 한 번. 실측(T24 재시험): 조사 Bash 6번(47초) 뒤에야 첫 보고가 와 그동안 진행 줄이 비었다.
export const FIRST_NUDGE_AFTER = 3

export const FIRST_NUDGE = `work-plan: ${FIRST_NUDGE_AFTER} work calls in this turn and no plan_update yet. If this task has two or more steps, send plan_update with your next work tool call.`

/** 알림을 셀 계획인가: 보고된 단계가 있고, 턴이 아직 안 끝났고, 남은 단계가 있다. */
export function isOpen(plan: WorkPlan): boolean {
  return plan.steps.length > 0 && plan.ended === null && plan.steps.some(s => s.status !== 'done')
}
