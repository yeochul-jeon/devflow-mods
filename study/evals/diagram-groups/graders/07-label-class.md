---
type: regex
target: {source: file, path: diagram.html}
match: not_contains
---

<text[^>]*\sstyle=["'][^"']*text-anchor
