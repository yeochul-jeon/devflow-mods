#!/usr/bin/env python3
"""study mindmap 의 eval 글자 일치 판정 두 개와 렌더 검사 시험 파일 세 개를 SKILL.md 에서 만든다(원본은 SKILL.md 하나).
사용: study-mindmap-graders.py          → study/evals/mindmap/graders/07·08, docs/tools/study-mindmap-fixtures/*.html 을 다시 쓴다
      study-mindmap-graders.py --check  → 파일이 SKILL.md 와 맞지 않으면 1 로 끝난다"""
import os, re, sys
root = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
skill = open(os.path.join(root, "study/skills/study/SKILL.md"), encoding="utf-8").read()
skel = re.search(r"공통 뼈대:\n\n```html\n(.*?)```", skill, re.S).group(1)
sec = skill.split("### mindmap", 1)[1].split("\n### ", 1)[0]
css = re.search(r"모드 CSS:\n\n```css\n(.*?)```", sec, re.S).group(1)
js = re.search(r"모드 스크립트:\n\n```html\n(.*?)```", sec, re.S).group(1)

def js_escape(s):  # JavaScript 정규식으로 글자 그대로 찾기. 줄바꿈은 \n 으로 써서 판정 파일을 한 줄로 둔다
    return re.sub(r"[\\^$.|?*+()\[\]{}/]", lambda m: "\\" + m.group(0), s.rstrip("\n")).replace("\n", "\\n")

def grader(block):
    return "---\ntype: regex\ntarget: {source: file, path: mindmap.html}\n---\n\n" + js_escape(block) + "\n"

def page(title, body):  # 모델이 지키는 규칙대로 뼈대에 모드 CSS·본문·모드 스크립트를 넣는다
    h = skel.replace("<title>주제 — 모드 이름</title>", f"<title>{title} — 마인드맵</title>").replace("/* 모드 CSS */\n", "/* 모드 CSS */\n" + css)
    h = h.replace("<!-- 본문 -->\n", f"<h1>{title}</h1>\n<p class=\"lead\">렌더 검사용 시험 파일입니다.</p>\n{body}")
    return h.replace("</script>\n</body>", "</script>\n" + js + "</body>")

def leaf(n, d):
    return f'<div class="leaf" data-study="branch"><b>{n}</b> — {d}</div>'

def fold(head, inner, closed=False):
    return f'<div class="fold{" closed" if closed else ""}" data-study="branch"><div class="head">{head}</div><div class="body">{inner}</div></div>'

desc = "처음 보는 사람도 이해하도록 이 가지가 무엇을 뜻하는지 한 문장으로 적은 설명이다."
# max: 긴 제목 + 규칙의 최대 분량(큰 가지 6 × 작은 가지 3, 긴 설명) → 인쇄 축소 비율이 가장 낮은 경우
max_body = "".join(fold(f"<b>큰 가지 이름 {i+1}번</b> — {desc}", "".join(leaf(f"작은 가지 이름 {i+1}-{j+1}", desc) for j in range(3))) + "\n" for i in range(6))
# closed: 둘째 큰 가지 아래 접힌 가지 → 화면에서는 숨고 인쇄에서는 펼쳐져야 한다
grand = fold("<b>접힌 가지</b> — 처음에 접혀 있다.", leaf("손자 1", "인쇄 때만 보인다.") + leaf("손자 2", "인쇄 때만 보인다."), closed=True)
closed_body = "".join(fold(f"<b>큰 가지 {i+1}</b> — 큰 가지 설명 한 문장이다.", "".join(leaf(f"작은 {i+1}-{j+1}", "짧은 설명 한 문장이다.") for j in range(2)) + (grand if i == 1 else "")) + "\n" for i in range(5))
# broken: body 가 없는 가지 → 그리기가 실패한다. 검사는 FAIL 이 정상이고 목록이 보여야 한다
broken_body = '<div class="fold" data-study="branch"><div class="head"><b>몸통 없는 가지</b> — body 가 빠져 그리기가 실패한다.</div></div>\n'

files = {
    "study/evals/mindmap/graders/07-mode-css-verbatim.md": grader(css),
    "study/evals/mindmap/graders/08-mode-script-verbatim.md": grader(js),
    "docs/tools/study-mindmap-fixtures/max.html": page("클라우드 네이티브 애플리케이션 관측 가능성 설계", '<div class="map">\n' + max_body + "</div>\n"),
    "docs/tools/study-mindmap-fixtures/closed.html": page("접힌 가지 사례", '<div class="map">\n' + closed_body + "</div>\n"),
    "docs/tools/study-mindmap-fixtures/broken.html": page("깨진 목록 사례", '<div class="map">\n' + broken_body + "</div>\n"),
}
bad = 0
for rel, text in files.items():
    path = os.path.join(root, rel)
    if "--check" in sys.argv:
        same = os.path.exists(path) and open(path, encoding="utf-8").read() == text
        print(("ok    " if same else "STALE ") + rel); bad += not same
    else:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        open(path, "w", encoding="utf-8").write(text); print("wrote " + rel)
sys.exit(1 if bad else 0)
