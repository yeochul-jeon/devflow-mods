// 순수 함수만 둔다. $ 에 의존하지 않아 테스트하기 쉽다.
import type { StepStatus, WorkPlan } from '../types'

export const MAX_TITLE = 60
export const MAX_STEPS = 30
const STATUSES: readonly StepStatus[] = ['todo', 'doing', 'done', 'blocked']

/** 대화 첫 프롬프트에 한 번 붙이는 규칙 (9.6.2 v2: 보고 전용 요청을 만들지 않는 문구 + 5단계 실세션 뒤: 사용자 언어, 첫 보고는 첫 작업과 함께). */
export const RULE = `# Plan reporting
When a task needs more than one step, report the plan with plan_update: every step as a short title, in the language the user writes in.
Send the first plan_update together with your first work tool call, and later updates together with later work tool calls (Write, Edit, Bash, ...). Never send a response whose only tool call is plan_update.
Do not split work you would otherwise batch just to update a status.
You do not need to report the final "done": the plan closes itself when your turn ends.
Do not call plan_update for a single question or a one-step change.`

/** 규칙이 닿지 않는 환경에서도 남는 유일한 안내라 규칙의 핵심을 담는다. */
export const TOOL_DESCRIPTION =
  'Report the current work plan: every step with its status, the whole list each time, titles in the language the user writes in. The person sees it as a progress line. Send the first one with your first work tool call, and each one only alongside a work tool call in the same response, never alone; the final "done" is not needed, the plan closes when the turn ends.'

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

/** 첫 프롬프트에 붙일 문맥. compact 뒤에는 모델이 계획을 다시 알도록 지금 목록을 덧붙인다. */
export function contextFor(plan: WorkPlan, why: 'start' | 'compact'): string {
  if (why === 'start' || plan.steps.length === 0) return RULE
  const lines = plan.steps.map(s => `- [${s.status}] ${s.title}`)
  return `${RULE}\n\nYour plan before the conversation was compacted (report it again with plan_update when you continue):\n${lines.join('\n')}`
}
