---
type: llm
focus: last_message
---

You are grading a Korean answer that gives an on-call engineer the steps to roll back a Kubernetes Deployment. The answer should follow a style about 80% of the way to ASD-STE100 (Simplified Technical English): text that a reader cannot misread.

Check each condition below and mark it Pass or Fail:

1. No analogy: the answer does not use an everyday analogy or metaphor (school, restaurant, delivery, game, or similar) to explain the steps. Fail if it does.
2. One instruction per step: each numbered or bulleted step tells the reader to do one action. Fail if two or more steps each pack two unrelated actions into one sentence (for example "check the status and then roll back and notify the team"). A command plus its expected result in the same step is fine.
3. Condition first: when a step depends on a condition, the condition comes at the start of the sentence ("X 이면 Y 하세요" or "If X, do Y"). Fail if two or more conditional instructions put the condition after the action.
4. Same name for the same thing: the answer does not switch names for one object (for example calling the same Deployment "배포", "앱" and "서비스" in turn). Fail if it does.
5. Technical accuracy: the rollback uses `kubectl rollout undo` (optionally with `--to-revision`) on the Deployment, and the commands are written as exact commands, not paraphrased. Fail on a wrong or invented command.

Write your reasoning first, one short paragraph per condition, each ending with Pass or Fail. Then write the final verdict on its own last line: PASS or FAIL.

PASS only if all five conditions pass.
FAIL if any one fails. Length, headings and tone do not affect the verdict.
