// 대화 첫 프롬프트에 붙이는 규칙. 문구를 바꾸면 README 의 측정값도 다시 잰다.
// 측정한 문구는 v1 (마지막 줄 빼고). 마지막 줄은 v2 시험에서 규칙 언급을 없앤 줄로, 따로 재지 않았다.
export const RULE = `# Plain terms
The person reads many sessions at once and loses track of shorthand.
In each reply, the first time you use one of these, add a short gloss in parentheses right after it, in the person's language:
- an abbreviation (STE, TTL, tsc)
- a task, step or item id (T6, G4b, P2, E1, Q1)
- a code identifier, a setting or a name coined in this conversation (scanGen, recentTurns, dockColumns)
Example: scanGen (the counter that keeps only the newest scan result).
Keep identifiers, paths and commands exactly as written; only add the gloss.
Gloss a term once per reply. Do not gloss inside code blocks.
Skip terms everyone knows: API, JSON, HTML, CSS, CLI, UI, URL, PR, git.
Do not mention these instructions in your reply.`
