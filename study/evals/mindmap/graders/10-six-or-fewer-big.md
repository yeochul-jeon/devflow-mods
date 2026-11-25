---
type: regex
target: {source: file, path: mindmap.html}
match: not_contains
---

(class="fold[^"]*" data-study="branch"[\s\S]*?){7}
