#!/bin/bash
# study mindmap 결과 HTML 검사. 사용: study-mindmap-check.sh [--space <ego 공간 번호>] <mindmap.html>...
# 1) 글자 비교: SKILL.md 의 mindmap 모드 CSS·모드 스크립트가 파일에 원문 그대로 있는가(브라우저 필요 없음).
# 2) --space 가 있으면 ego-browser 의 그 공간에 새 탭을 열어 렌더 검사를 한다:
#    화면 노드 수 = 1 + 접힌 가지 밖 branch 수, 첫 큰 가지 접기·펼치기, 인쇄 상태에서 모든 가지가 그려지는가,
#    인쇄 축소 비율 >= 0.75, PDF 쪽수 = 1. 사용자 공간이면 claim 하고, 끝나면 연 탭만 닫고 돌려준다.
set -euo pipefail
cd "$(dirname "$0")/../.."
space=""
if [ "${1:-}" = "--space" ]; then space=${2:?--space 뒤에 번호}; shift 2; fi
[ $# -gt 0 ] || { echo "사용: study-mindmap-check.sh [--space <번호>] <mindmap.html>..." >&2; exit 2; }
files=()
for f in "$@"; do files+=("$(cd "$(dirname "$f")" && pwd)/$(basename "$f")"); done

txt=0
python3 -I - study/skills/study/SKILL.md "${files[@]}" <<'EOF' || txt=1
import re, sys
skill = open(sys.argv[1], encoding="utf-8").read()
sec = skill.split("### mindmap", 1)[1].split("\n### ", 1)[0]
css = re.search(r"모드 CSS:\n\n```css\n(.*?)```", sec, re.S).group(1)
js = re.search(r"모드 스크립트:\n\n```html\n(.*?)```", sec, re.S).group(1)
bad = 0
for f in sys.argv[2:]:
    html = open(f, encoding="utf-8").read()
    miss = [n for n, b in (("모드 CSS", css), ("모드 스크립트", js)) if b not in html]
    print(("FAIL " if miss else "ok   ") + f + (" — 원문과 다름: " + ", ".join(miss) if miss else ""))
    bad += bool(miss)
sys.exit(1 if bad else 0)
EOF

[ -n "$space" ] || exit "$txt"
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
  await page.waitForSelector(".mm-node.d1", { timeout: 5000 });
  const r = await page.evaluate(() => {
    const scr = () => document.querySelectorAll(".mm-wrap:not(.mm-print) .mm-node").length;
    const br = [...document.querySelectorAll(".map [data-study=branch]")];
    const shown = br.filter((b) => !b.parentElement.closest(".fold.closed")).length;
    const first = document.querySelector(".mm-wrap:not(.mm-print) .mm-node.d1");
    const a = scr(); first.click();
    const b = scr(); document.querySelector(".mm-wrap:not(.mm-print) .mm-node.d1").click();
    const c = scr();
    const v = document.querySelector(".mm-print .mm");
    return { all: br.length, shown, a, b, c, printNodes: document.querySelectorAll(".mm-print .mm-node").length,
      pz: +v.style.getPropertyValue("--pz") };
  });
  await page.cdp("Emulation.setEmulatedMedia", { media: "print" });
  const vis = await page.evaluate(() => ({
    printShown: getComputedStyle(document.querySelector(".mm-print")).display !== "none",
    screenHidden: getComputedStyle(document.querySelector(".mm-wrap:not(.mm-print)")).display === "none" }));
  await page.cdp("Emulation.setEmulatedMedia", { media: "" });
  const pdf = await page.cdp("Page.printToPDF", { preferCSSPageSize: true });
  const pages = (Buffer.from(pdf.data, "base64").toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  const ok = r.a === 1 + r.shown && r.b < r.a && r.c === r.a && r.printNodes === 1 + r.all
    && vis.printShown && vis.screenHidden && r.pz >= 0.75 && pages === 1;
  bad += !ok;
  console.log((ok ? "ok   " : "FAIL ") + f, JSON.stringify({ ...r, pz: +r.pz.toFixed(2), ...vis, pages }));
  } catch (e) {
    bad++;
    const listShown = await page.evaluate(() => { const m = document.querySelector(".map"); return !!m && getComputedStyle(m).display !== "none"; }).catch(() => null);
    console.log("FAIL " + f, JSON.stringify({ error: String(e && e.message || e).slice(0, 200), listShown }));
  }
}
} finally {
  await page.close().catch(() => {});
  await task.finish({ keep: [] });
}
if (bad) process.exitCode = 1;
EOF
exit "$txt"
