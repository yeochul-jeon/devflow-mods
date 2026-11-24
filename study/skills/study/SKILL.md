---
name: study
description: 주제 하나를 공부용 HTML 파일 한 장으로 만든다 — mindmap(접고 펴는 마인드맵), diagram(상자와 화살표 구조도), guide(A4 한 장 학습지), quiz(실무형 객관식 5문항). 사용법 /study:study <mindmap|diagram|guide|quiz> <주제> [--out <디렉터리>]
argument-hint: <mindmap|diagram|guide|quiz> <주제> [--out <디렉터리>]
disable-model-invocation: true
---

# 공부용 HTML 한 장

사용자가 준 인자: `$ARGUMENTS`

이 스킬은 주제 하나를 HTML 파일 하나로 만든다. 모드마다 형식 조건이 정해져 있다. 조건은 "요청문에 적은 동작만 결과에 들어간다"는 경험에서 왔다. 그래서 아래 조건을 하나도 빼지 않는다. 조건에 없는 기능(테마 전환, 다크 모드, 애니메이션, 검색창 등)도 더하지 않는다.

## 1. 인자 나누기

1. `--out <디렉터리>` 가 있으면 뽑아 낸다. 인자 어디에 와도 된다.
2. 남은 것의 첫 낱말이 모드다. 나머지 낱말 전체가 주제다(여러 낱말 가능).
3. 모드가 비었거나 `mindmap`·`diagram`·`guide`·`quiz` 중 하나가 아니면 파일을 만들지 않는다. 아래 안내만 보이고 끝낸다.

   ```
   모드를 첫 낱말로 주세요: mindmap(마인드맵) · diagram(구조도) · guide(A4 한 장 학습지) · quiz(객관식 5문항)
   예: /study:study mindmap 엑셀 피벗 테이블 --out notes
   ```

4. 모드는 있는데 주제가 비었으면 파일을 만들지 않고 주제를 묻는다.

## 2. 저장 위치와 파일 이름

- `--out` 이 없으면 현재 작업 폴더에 저장한다.
- `--out` 이 있으면 `ls -d -- '<디렉터리>'` 로 있는지 본다. 없으면 만들지 않는다. "`<디렉터리>` 가 없어서 만들지 않았습니다. 디렉터리를 만든 뒤 다시 실행하세요." 라고 알리고 끝낸다. 사용자가 정한 위치를 멋대로 만들면 엉뚱한 곳에 파일이 쌓인다.
- 확인하거나 저장할 때 `cd` 하지 않는다. 디렉터리 경로를 명령과 파일 경로에 붙여 쓴다. `cd` 하면 셸의 현재 폴더가 바뀌어, 다음 실행의 기본 저장 위치가 그 폴더로 밀린다.
- 파일 이름은 `<모드>.html` 이다. 같은 이름이 이미 있으면 덮어쓰지 않는다. 있는지는 Glob 으로만 본다(Bash 로 `ls` 하지 않는다. 권한 확인 창이 뜨지 않게). 그리고 `<모드>-2.html`, `<모드>-3.html` … 중 비어 있는 첫 이름을 쓴다. 전에 만든 공부 자료를 지우지 않기 위해서다.

## 3. 내용의 근거

- 기본은 일반 지식으로 쓴다. 읽는 사람은 이 주제를 처음 접하는 회사원이다.
- 주제가 현재 저장소 안의 파일·모듈·클래스 이름으로 보이면 먼저 Glob·Grep 으로 찾고 그 코드를 읽는다. 내용은 읽은 코드를 근거로 쓴다. 그리고 본문 맨 아래에 `<p class="source" data-study="source">근거: 경로1, 경로2</p>` 를 넣는다.
- 저장소 코드를 읽지 않았으면 근거 줄을 넣지 않는다.
- 사용자가 한국어로 썼으면 한국어로 쓴다. 식별자·명령·함수 이름은 원문 그대로 둔다.

## 4. HTML 공통 규칙

- 파일 하나에 모두 넣는다. 외부 자원(CDN 스크립트, 웹폰트, 외부 이미지, 외부 CSS, `@import`)을 쓰지 않는다. 인터넷이 없어도 열리고, 파일 하나만 보내도 그대로 보이게 하기 위해서다. 본문 안의 일반 링크(`<a href>`)는 써도 된다.
- 아래 **공통 뼈대**를 그대로 쓴다. `/* 모드 CSS */` 자리에 그 모드의 CSS 를 그대로 넣고, `<!-- 본문 -->` 자리에 내용을 채운다. 뼈대의 CSS 와 스크립트는 고치지 않는다. 접기·펼치기와 인쇄 동작이 매번 같아야 하기 때문이다.
- 개수 표지 `data-study="…"` 는 정해진 요소에만 붙인다. 다른 곳(CSS, 스크립트, 주석)에 `data-study` 라는 글자를 쓰지 않는다. 표지로 개수를 세어 조건을 검사한다.
- 인쇄할 때는 접힌 것이 모두 펼쳐진다. 이것은 뼈대 CSS 가 한다.

공통 뼈대:

```html
<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>주제 — 모드 이름</title>
<style>
body{font-family:system-ui,-apple-system,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.55;max-width:880px;margin:24px auto;padding:0 16px;color:#222;background:#fff}
h1{font-size:1.5em;margin:0 0 .4em}
.lead{color:#555;margin:0 0 1em}
.fold>.head{cursor:pointer;user-select:none}
.fold>.head::before{content:"▾ ";color:#888}
.fold.closed>.head::before{content:"▸ "}
.fold.closed>.body{display:none}
.source{margin-top:24px;color:#666;font-size:.9em}
@media print{
  body{margin:0;max-width:none}
  .fold>.head::before,.fold.closed>.head::before{content:""}
  .fold.closed>.body{display:block}
}
/* 모드 CSS */
</style>
</head>
<body>
<!-- 본문 -->
<script>
document.addEventListener('click',function(e){var h=e.target.closest('.fold>.head');if(h)h.parentElement.classList.toggle('closed')});
</script>
</body>
</html>
```

접고 펴는 묶음은 언제나 이 모양이다. 처음에 접혀 있어야 하면 `closed` 를 붙인다.

```html
<div class="fold closed"><div class="head">머리 줄</div><div class="body">펼치면 보이는 내용</div></div>
```

## 5. 모드별 조건

### mindmap — 마인드맵 (`mindmap.html`)

조건: 이 주제가 처음인 사람이 읽는다. 가지 머리를 클릭하면 그 아래가 숨겨지고 다시 보인다. 가지 하나에 붙는 설명은 한 문장이다.

- `<h1>` 은 주제, 그 아래 `.lead` 한 줄로 이 지도가 무엇을 다루는지 쓴다.
- 큰 가지 5~8개, 큰 가지마다 작은 가지 2~5개. 깊이는 2단계까지만 쓴다(3단계는 꼭 필요할 때만). 처음 접하는 사람이 한눈에 볼 수 있는 크기다.
- 가지 하나 = `fold` 묶음 하나. `head` 에 `<b>가지 이름</b> — 설명 한 줄`. 설명은 40자 안팎의 한 문장이다. 두 문장이 되면 가지를 나눈다.
- 큰 가지는 처음에 펼쳐 두고, 작은 가지가 더 있는 가지만 `closed` 로 둔다. 작은 가지가 끝 가지면 `fold` 대신 `<div class="leaf" data-study="branch"><b>이름</b> — 설명 한 줄</div>` 로 쓴다.
- 모든 가지(큰 가지·작은 가지·끝 가지)에 `data-study="branch"` 를 붙인다.

```html
<div class="map">
  <div class="fold" data-study="branch"><div class="head"><b>큰 가지</b> — 설명 한 줄</div>
    <div class="body">
      <div class="leaf" data-study="branch"><b>작은 가지</b> — 설명 한 줄</div>
    </div>
  </div>
</div>
```

모드 CSS:

```css
.map{border-left:3px solid #4a7bd0;padding-left:14px}
.map .fold,.map .leaf{margin:6px 0}
.map .body{border-left:2px solid #c9d6ee;margin-left:8px;padding-left:14px}
.map>.fold>.head{font-size:1.08em}
```

### diagram — 구조도 (`diagram.html`)

조건: 주제를 이루는 부분들과 그 사이의 흐름을 그림으로 보인다. 부분 하나는 사각형, 흐름은 화살촉 달린 선이다. 사각형마다 짧은 설명이 한 문장 붙는다.

- 그림은 파일 안의 `<svg>` 하나로 그린다(외부 이미지 금지).
- 상자는 4~9개. 상자 하나 = `<g data-study="box">` 안에 `<rect>` 와 `<text>` 두 줄(이름, 설명 한 줄).
- 화살표 하나 = `<line data-study="arrow" … marker-end="url(#arrow)">` 또는 `<path data-study="arrow" …>`. 화살표 옆에 무엇이 오가는지 짧은 라벨(10자 이내)을 붙여도 된다.
- 배치: 흐름 방향으로 위에서 아래, 한 줄에 상자 최대 3개. 상자 크기는 폭 240, 높이 64, 상자 사이 가로 40·세로 56 으로 고정한다. 좌표는 이 크기로 계산한다.
- SVG 글자는 줄이 바뀌지 않는다. 그래서 상자 이름은 12자 이내(16px), 설명은 16자 이내(13px)로 쓴다. 더 길면 낱말을 줄이거나 상자를 나눈다. 넘치면 글자가 상자 밖으로 나간다.
- `viewBox` 를 그린 범위에 맞추고, `width="100%"` 로 둔다.
- 그림 밖에 따로 목록이나 표를 덧붙이지 않는다. 조건에 없는 것이다.

```html
<svg viewBox="0 0 840 400" width="100%" role="img" aria-label="주제 구조도">
  <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#555"/></marker></defs>
  <g data-study="box"><rect x="20" y="20" width="240" height="64" rx="8"/><text x="140" y="46" class="name">이름</text><text x="140" y="68" class="desc">설명 한 줄</text></g>
  <line data-study="arrow" x1="140" y1="84" x2="140" y2="138" marker-end="url(#arrow)"/>
</svg>
```

모드 CSS:

```css
svg rect{fill:#eef3fb;stroke:#4a7bd0;stroke-width:1.5}
svg text{text-anchor:middle;fill:#222}
svg .name{font-size:16px;font-weight:bold}
svg .desc{font-size:13px;fill:#444}
svg line,svg path.link{stroke:#555;stroke-width:1.5;fill:none}
svg .label{font-size:12px;fill:#555}
```

### guide — 한 장 학습지 (`guide.html`)

조건: 인쇄하면 A4 용지 한 쪽이다. 꼭 알 개념 다섯, 흔히 틀리는 점 셋, 직접 풀어 볼 문제 하나로 이뤄진다.

- 개수는 정확히 5·3·1 이다. 더 넣고 싶은 것이 있어도 고른다. 한 장에 들어가야 다시 볼 때 부담이 없다.
- 절 세 개: `<h2>꼭 알 개념</h2>`, `<h2>흔히 틀리는 점</h2>`, `<h2>직접 풀어 보기</h2>`.
- 개념: `<li data-study="concept"><b>개념 이름</b> — 설명</li>`. 설명은 80자 이내.
- 틀리는 점: `<li data-study="mistake"><b>실수</b> → 바르게 하는 법</li>`. 70자 이내. 실제로 흔한 실수를 쓴다.
- 문제: `<div class="exercise" data-study="exercise">` 안에 문제 하나(3줄 이내). 풀이는 넣지 않는다(조건에 없다). 읽고 나서 곧장 손으로 해 볼 수 있는 크기로 낸다.
- 전체가 A4 한 장에 들어가야 한다. 길어지면 설명을 줄인다.

모드 CSS:

```css
@page{size:A4;margin:14mm}
h2{font-size:1.1em;margin:1em 0 .4em;border-bottom:1px solid #ddd}
ol,ul{margin:0;padding-left:1.4em}
li{margin:.25em 0}
.exercise{border:1px solid #ccc;border-radius:6px;padding:8px 12px}
@media print{body{font-size:10.5pt}}
```

### quiz — 퀴즈 (`quiz.html`)

조건: 일하다 겪을 법한 상황을 묻는 4지선다 5문항이다. 정답과 풀이는 읽는 사람이 문제를 다 풀고 나서 보게 한다.

- 정확히 5문항, 문항마다 선택지 4개(A~D). 용어 뜻을 묻는 문제보다 "이런 상황에서 무엇을 하나" 를 묻는 상황형으로 낸다.
- 답·해설은 문항 바로 뒤에 접힌 `fold closed` 로 둔다. 머리 줄은 `N번 답·해설` 이다. 화면에서는 눌러야 보인다. 다 풀기 전에 답이 눈에 들어오지 않게 하려는 것이다.
- 인쇄할 때는 모드 CSS 가 답·해설을 모두 맨 끝 «정답» 절로 옮긴다. 그래서 `<h2 class="key-title">정답</h2>` 를 5문항 다음, `.quiz` 안 마지막에 한 번 넣는다. 답을 두 번 쓰지 않는다.
- 해설은 정답인 이유와 가장 헷갈리는 오답이 틀린 이유를 함께 2~3문장으로 쓴다.

```html
<div class="quiz">
  <div class="q" data-study="question"><b>1.</b> 상황과 질문
    <ol type="A"><li>…</li><li>…</li><li>…</li><li>…</li></ol></div>
  <div class="a fold closed" data-study="answer"><div class="head">1번 답·해설</div><div class="body"><b>정답 B.</b> 해설</div></div>
  <!-- 2~5번 같은 모양 -->
  <h2 class="key-title">정답</h2>
</div>
```

모드 CSS:

```css
.quiz{display:flex;flex-direction:column;gap:12px}
.q{border:1px solid #ccc;border-radius:6px;padding:10px 14px}
.q ol{margin:.4em 0 0;padding-left:1.6em}
.a{margin:-6px 0 4px 14px}
.a>.head{color:#555;font-size:.95em}
.key-title{display:none}
@media print{
  .q{order:1;break-inside:avoid}
  .key-title{display:block;order:2;margin:16px 0 0;font-size:1.2em}
  .a{order:3;margin:0;break-inside:avoid}
  .a>.head{font-weight:bold;color:#222}
}
```

## 6. 끝맺음

Write 로 파일을 쓴 뒤 답은 두 줄이다.

```
<저장한 파일 경로>
<무엇을 만들었는지 한 줄. 예: 가지 7개짜리 마인드맵입니다. 가지를 누르면 접고 펼 수 있습니다.>
```
