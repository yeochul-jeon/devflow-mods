---
type: regex
target: {source: file, path: quiz.html}
match: count:5
---

<\w+[^>]*\sdata-study=["\']answer["\']
