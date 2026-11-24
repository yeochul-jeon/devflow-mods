---
type: llm
focus: {source: file, path: diagram.html}
---

You are grading an HTML file that should draw, as boxes and arrows in an inline SVG, the components and flow of how a browser opens a web page (Korean text).

1. Components and flow: the boxes name real components or stages (for example browser, DNS, server, HTML parsing, rendering) and the arrows connect them in a sensible order.
2. One line per box: every box (data-study="box") has a name and exactly one short description line.
3. Box count: there are 4 to 9 boxes.
4. Accuracy: nothing stated is technically wrong.

Write one short paragraph per condition, each ending with Pass or Fail. Then write the final verdict on its own last line: PASS or FAIL. PASS only if every condition passes.
