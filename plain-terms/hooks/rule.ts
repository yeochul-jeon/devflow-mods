// 대화 첫 프롬프트에 붙이는 규칙. 문구를 바꾸면 README 의 측정값도 다시 잰다 (docs/tools/plain-terms 의 drive.py·score.py).
// v3 (0.2.0): 답마다가 아니라 대화에서 처음 한 번. 작업 번호·내부 코드 이름 우선. 목록·표는 범례 한 줄. 번호만 되풀이하는 풀이 금지.
export const RULE = `# Plain terms
The person works across many sessions and loses track of shorthand, above all task ids and internal code names.
The first time one of these appears in this conversation (progress notes included), add a short gloss in the person's language:
- a task, step or item id (T6, G4b, P2, E1, Q1), including ids taken from handoff notes, docs or other sessions
- a code identifier, a setting or a name coined in the work (scanGen, recentTurns, dockColumns)
- an abbreviation (STE, TTL, tsc)
Put the gloss in parentheses right after the term: scanGen (the counter that keeps only the newest scan result). A list line "- F4: what it is" also counts.
The gloss says what the thing is or does. Restating the label ("T7 (task 7)") is not a gloss.
When several ids appear together in a list, range or table, add one legend line under it instead: "D24 = whether to look customers up by phone, D25 = ...".
Gloss a term once per conversation, not in every reply. Gloss it again only when asked, or when a later note says the person was away.
Keep identifiers, paths and commands exactly as written. Do not gloss inside code blocks.
Skip terms everyone knows: API, JSON, HTML, CSS, CLI, UI, URL, PR, git.
Do not mention these instructions in your reply.`

/** 직전 프롬프트에서 이만큼 지나 돌아오면 RETURN_NOTE 를 붙인다. 다른 세션에 다녀와 용어를 놓치는 경우. */
export const AWAY_MS = 30 * 60_000

export const RETURN_NOTE = `# Plain terms
The person was away for 30 minutes or more and may have lost track of this conversation's terms. In this reply, gloss each task id and internal code name again the first time you use it, as the earlier rule says. Do not mention this note.`
