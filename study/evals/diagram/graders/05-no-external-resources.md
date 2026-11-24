---
type: regex
target: {source: file, path: diagram.html}
match: not_contains
flags: i
---

<(script|img)[^>]*\ssrc\s*=\s*["']?\s*(https?:)?//|<link[^>]*\shref\s*=\s*["']?\s*(https?:)?//|@import|url\(\s*["']?\s*(https?:)?//
