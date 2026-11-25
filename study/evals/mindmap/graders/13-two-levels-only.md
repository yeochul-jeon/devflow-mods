---
type: regex
target: {source: file, path: mindmap.html}
match: not_contains
---

<div class="body">\s*(?:<div class="leaf"[^>]*>(?:(?!</div>)[\s\S])*</div>\s*)*<div class="fold
