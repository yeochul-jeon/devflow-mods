---
type: llm
focus: last_message
---

You are grading a Korean answer that explains Kafka partitions and consumer groups in simple terms.

Check each condition below and mark it Pass or Fail:

1. Analogy: the answer uses exactly one everyday analogy (school, game, delivery, restaurant, or similar) as its main analogy. Fail if there is no analogy, or if several unrelated analogies compete.
2. Limit of the analogy: the answer states, in about one line, where the analogy breaks down or stops matching real Kafka. Fail if no such statement exists.
3. Technical accuracy: no technical factual errors about Kafka. In particular: a partition is consumed by at most one consumer within the same consumer group at a time; consumers beyond the number of partitions in one group sit idle; different consumer groups each read all partitions independently; ordering is guaranteed only within a partition. Fail on any statement that contradicts these.

Write your reasoning first, one short paragraph per condition, each ending with Pass or Fail. Then write the final verdict on its own last line: PASS or FAIL.

PASS only if all three conditions pass: one everyday analogy, one line stating where it breaks down, and no Kafka factual errors.
FAIL if any one of the three fails. Formatting, length, diagrams, and tone do not affect the verdict.
