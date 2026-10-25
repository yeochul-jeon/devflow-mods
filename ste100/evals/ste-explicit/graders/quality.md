---
type: llm
focus: last_message
---

You are grading a Korean answer that explains, in a style based on ASD-STE100 (Simplified Technical English), how to resolve a conflict during `git rebase`. The style target is about 80% of ASD-STE100: text that a reader cannot misread.

Check each condition below and mark it Pass or Fail:

1. No analogy: the answer does not use an everyday analogy or metaphor to explain the steps. Fail if it does.
2. One instruction per step: each numbered or bulleted step tells the reader to do one action. Fail if two or more steps each pack two unrelated actions into one sentence. A command plus its expected result in the same step is fine.
3. Condition first: when an instruction depends on a condition, the condition comes at the start of the sentence ("X 이면 Y 하세요" or "If X, do Y"). Fail if two or more conditional instructions put the condition after the action.
4. Honest label: the answer does not claim to be certified or fully compliant with ASD-STE100. Saying it is based on, or follows the style of, ASD-STE100 is fine; also fine if it says nothing about compliance.
5. Technical accuracy: the steps include marking resolved files with `git add` and continuing with `git rebase --continue`, and mention `git rebase --abort` as the way to cancel. Fail on a wrong or invented command.

Write your reasoning first, one short paragraph per condition, each ending with Pass or Fail. Then write the final verdict on its own last line: PASS or FAIL.

PASS only if all five conditions pass.
FAIL if any one fails. Length, headings and tone do not affect the verdict.
