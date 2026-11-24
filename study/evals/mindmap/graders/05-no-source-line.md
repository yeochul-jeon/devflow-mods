---
type: regex
target: {source: file, path: mindmap.html}
match: not_contains
---

<\w+[^>]*\sdata-study=["\']source["\']
