#!/bin/bash
# study diagram 결과 HTML 의 글자 겹침 검사. 사용: study-diagram-check.sh --space <ego 공간 번호> <diagram.html>...
# ego-browser 의 그 공간에 새 탭을 열어 SVG 글자의 실제 크기(getBBox, SVG 단위)를 재고 아래를 본다:
# - 상자 글자(g[data-study=box] 안의 text)가 그 상자 사각형 안에 들어가는지
# - 이름표(상자 밖의 text: 화살표 이름표, 묶음 이름)가 상자(여유 PAD), 다른 이름표, 화살표 선, 묶음 테두리 선에 닿지 않는지
# 묶음은 상자 밖의 rect 다. 그 안쪽 면은 괜찮고 테두리 선만 피해야 한다. 끝나면 연 탭만 닫는다.
set -euo pipefail
cd "$(dirname "$0")/../.."
space=
files=()
while [ $# -gt 0 ]; do
  case $1 in
    --space) space=${2:?--space 다음에 번호}; shift 2 ;;
    *) files+=("$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"); shift ;;
  esac
done
[ -n "$space" ] && [ ${#files[@]} -gt 0 ] || { echo "사용: study-diagram-check.sh --space <번호> <diagram.html>..." >&2; exit 2; }
list=$(python3 -I -c 'import json,sys;print(json.dumps(sys.argv[1:]))' "${files[@]}")
ego-browser nodejs <<EOF
const FILES = $list, SPACE = $space;
const entry = (await listTaskSpaces()).find((s) => s.id === SPACE);
if (!entry) throw new Error("ego 공간 " + SPACE + " 이 없습니다");
const task = entry.ownership === "user" ? await claimTaskSpace(SPACE) : await taskSpace(SPACE);
const page = await task.newPage();
let bad = 0;
try {
for (const f of FILES) {
  try {
  await page.goto("file://" + f);
  await page.waitForSelector("svg [data-study=box]", { timeout: 5000 });
  const r = await page.evaluate(() => {
    const PAD = 3, out = [];
    const bb = (e) => { const b = e.getBBox(); return { x1: b.x, y1: b.y, x2: b.x + b.width, y2: b.y + b.height }; };
    const grow = (b, p) => ({ x1: b.x1 - p, y1: b.y1 - p, x2: b.x2 + p, y2: b.y2 + p });
    const hit = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
    const inside = (a, b) => a.x1 >= b.x1 && a.y1 >= b.y1 && a.x2 <= b.x2 && a.y2 <= b.y2;
    // 선분이 사각형을 지나는지(Liang-Barsky)
    const segHit = (x1, y1, x2, y2, b) => {
      let t0 = 0, t1 = 1; const dx = x2 - x1, dy = y2 - y1;
      for (const [p, q] of [[-dx, x1 - b.x1], [dx, b.x2 - x1], [-dy, y1 - b.y1], [dy, b.y2 - y1]]) {
        if (p === 0) { if (q < 0) return false; continue; }
        const t = q / p; if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
      }
      return true;
    };
    const name = (e) => (e.textContent || "").trim().slice(0, 16);
    const svgs = [...document.querySelectorAll("svg")].filter((s) => s.querySelector("[data-study=box]"));
    let labels = 0;
    for (const svg of svgs) {
      const boxes = [...svg.querySelectorAll("g[data-study=box]")].map((g) => ({ g, r: bb(g.querySelector("rect")), t: [...g.querySelectorAll("text")] }));
      const frames = [...svg.querySelectorAll("rect")].filter((e) => !e.closest("g[data-study=box]") && !e.closest("defs")).map(bb);
      const lbl = [...svg.querySelectorAll("text")].filter((e) => !e.closest("g[data-study=box]")).map((e) => ({ e, b: bb(e) }));
      labels += lbl.length;
      const segs = [];
      for (const a of svg.querySelectorAll("[data-study=arrow]")) {
        if (a.tagName === "line") segs.push([+a.getAttribute("x1"), +a.getAttribute("y1"), +a.getAttribute("x2"), +a.getAttribute("y2")]);
        else { const n = a.getTotalLength(), k = 24; let p = a.getPointAtLength(0); for (let i = 1; i <= k; i++) { const q = a.getPointAtLength(n * i / k); segs.push([p.x, p.y, q.x, q.y]); p = q; } }
      }
      for (const fr of frames) segs.push([fr.x1, fr.y1, fr.x2, fr.y1], [fr.x2, fr.y1, fr.x2, fr.y2], [fr.x1, fr.y2, fr.x2, fr.y2], [fr.x1, fr.y1, fr.x1, fr.y2]);
      for (const b of boxes) for (const t of b.t) if (!inside(bb(t), b.r)) out.push("상자 밖으로 나간 글자: " + name(t));
      lbl.forEach((l, i) => {
        const p = grow(l.b, PAD);
        for (const b of boxes) if (hit(p, b.r)) out.push("이름표가 상자에 닿음: " + name(l.e) + " / " + name(b.t[0]));
        lbl.forEach((m, j) => { if (j > i && hit(l.b, m.b)) out.push("이름표끼리 겹침: " + name(l.e) + " / " + name(m.e)); });
        // 글자 bbox 는 글꼴의 위아래 여백을 이미 품으므로 선과는 여유 없이 비교한다
        if (segs.some((s) => segHit(...s, l.b))) out.push("이름표가 선에 닿음: " + name(l.e));
      });
    }
    return { svgs: svgs.length, labels, problems: [...new Set(out)] };
  });
  const ok = r.svgs > 0 && r.problems.length === 0;
  bad += !ok;
  console.log((ok ? "ok   " : "FAIL ") + f, JSON.stringify(r));
  } catch (e) {
    bad++;
    console.log("FAIL " + f, JSON.stringify({ error: String(e && e.message || e).slice(0, 200) }));
  }
}
} finally {
  await page.close().catch(() => {});
  await task.finish({ keep: [] });
}
if (bad) process.exitCode = 1;
EOF
