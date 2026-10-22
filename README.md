# devflow-mods

Claude Code mod 모음입니다. 여러 세션의 상황판, 작업 계획 보고, 용어 풀이, 흐름 그림, 기간별 돌아보기, 12살 버전 설명, 다음 요청 제안, 초안 다듬기를 제공합니다.

[![Claude Code](https://img.shields.io/badge/Claude_Code-2.1.287%2B-d97757)](https://code.claude.com/docs/en/plugins/mods/overview)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

<p align="center">
  <img src="docs/images/board.webp" alt="team-board: 결정을 기다리는 세션은 주의 띠와 느낌표 아이콘, 할 일은 진행 막대로 표시" width="560">
</p>

## mod 목록

| | mod | 하는 일 | 명령 |
| :---: | --- | --- | --- |
| 🧭 | [**team-board**](#-team-board-팀-상황판) | 같은 저장소의 여러 세션을 한 화면에 보여 줍니다. 진행 현황, 결정 기록, 결정 대기 알림, 숨은 실패, 프롬프트 캐시 남은 시간을 표시합니다. | `/board` |
| 📋 | [**work-plan**](#-work-plan-작업-계획-보고) | Claude가 여러 단계 작업의 계획과 진행을 보고합니다. team-board의 진행 막대가 이 보고로 채워집니다. | 없음 (도구 `plan_update`) |
| 🔤 | [**plain-terms**](#-plain-terms-용어-풀이) | Claude가 약어, 작업 번호, 코드 이름을 처음 쓸 때 괄호로 풀어 씁니다. | 없음 (규칙만) |
| 📐 | [**draw**](#-draw-흐름-그림) | 직전 답변의 흐름을 원문 낱말 그대로 옆 패널에 그림으로 보여 줍니다. | `/draw [낱말]` |
| 📅 | [**look-back**](#-look-back-돌아보기) | 오늘·어제·7일·30일·올해 동안 한 일을 보여 줍니다. 한눈에 숫자·차트(아낀 시간 추정, 종류·모델별)와 프로젝트별 요청, 결정, 커밋. | `/lookback [기간]` |
| 🧒 | [**eli12**](#-eli12-12살-버전-설명) | 어려운 설명을 12살 버전으로 풉니다. | `/eli12 [주제]` |
| 💡 | [**next-steps**](#-next-steps-다음-요청-제안) | 답변이 끝나면 다음 요청 2~3개를 제안합니다. | `/next [on\|off]` |
| 📝 | [**prompt-coach**](#-prompt-coach-초안-다듬기) | 보내기 전에 초안의 빈 곳을 묻고 다듬습니다. | `/coach <초안>\|view\|auto on\|off`, `[다듬기]`·`[되돌리기]` 버튼 |

| 설정 | mod | 바꾸는 곳 | 기본값 |
| --- | --- | --- | --- |
| 색 `palette` | team-board | `claude plugin configure team-board@devflow-mods` | `night` |
| 팀 창 켜기·끄기, 모양 | team-board | `/board band on\|off\|hud\|line`, `/board band solo off` | 켜짐, `hud` |
| 결정 대기 음성 알림 | team-board | `/board sound on\|off\|test` | 켜짐, macOS만 |
| 숨은 실패 감지 | team-board | `/board fail on\|off\|clear` | 켜짐 |
| 세션 표시 이름 | team-board | `/board name <이름>` | 세션 이름 → 브랜치 → 폴더 |
| 다른 mod보다 앞에 두기 | team-board | `~/.claude/settings.json` 의 `prependPlugins` | 없음 |
| 작업 계획 보고 | work-plan | `claude plugin disable work-plan@devflow-mods` | 켜짐 |
| 계획 전 수정 막기 `planGate` | work-plan | `claude plugin configure work-plan@devflow-mods` | 꺼짐 |
| 용어 풀이 | plain-terms | `claude plugin disable plain-terms@devflow-mods` | 켜짐 |
| 다음 요청 제안 | next-steps | `/next on\|off` | 켜짐 |
| 보낼 때마다 다듬기 | prompt-coach | `/coach auto on\|off` (모든 세션) | 꺼짐 |

Claude Code v2.1.287 이상이 필요합니다. `claude --version` 으로 확인하세요.

## 설치

```bash
claude plugin marketplace add yeochul-jeon/devflow-mods
claude plugin install team-board@devflow-mods
claude plugin install work-plan@devflow-mods      # 요청마다 약 560 토큰 (team-board와 함께 쓰세요)
claude plugin install plain-terms@devflow-mods    # 대화 첫 요청에 규칙 약 280 토큰, 답변이 조금 길어집니다
claude plugin install draw@devflow-mods           # /draw 할 때만 Haiku를 호출합니다
claude plugin install look-back@devflow-mods      # 기록은 토큰 0, [요약] 누를 때만 Haiku를 호출합니다
claude plugin install eli12@devflow-mods
claude plugin install next-steps@devflow-mods     # 답변마다 Haiku를 호출합니다
claude plugin install prompt-coach@devflow-mods   # 다듬을 때 Haiku 2회. 자동 모드(기본 꺼짐)면 보낼 때마다
```

- 필요한 mod만 설치하세요.
- team-board는 사용자 범위(기본)로 설치하세요. 모든 세션과 워크트리에서 보여야 하기 때문입니다.
- 한 프로젝트에만 쓰려면 그 프로젝트 폴더에서 `--scope local` 을 붙이세요.
- 설치 중 `1 userConfig option not yet set` 이 보이면 `palette` 를 고르지 않은 상태입니다. 그대로 두면 `night` 로 동작합니다.
- 설치한 뒤 열려 있는 Claude Code를 `/exit` 하고 다시 시작하세요. `claude --continue` 로 대화를 이어서 엽니다.

<details>
<summary>업데이트·삭제</summary>

```bash
claude plugin marketplace update devflow-mods
claude plugin update team-board@devflow-mods      # mod마다 실행합니다
claude plugin uninstall team-board@devflow-mods   # 삭제
```

업데이트한 뒤 세션을 다시 열어야 새 버전이 적용됩니다.

</details>

> [!WARNING]
> mod는 Claude Code와 같은 권한으로 내 컴퓨터에서 실행됩니다. 설치 전에 코드를 읽으세요. `claude plugin validate ./team-board` 는 mod를 실행하지 않고 받는 이벤트와 호출을 보여 줍니다.

---

## 🧭 team-board: 팀 상황판

<img src="docs/images/hud.webp" alt="팀 창: 결정 대기 sub-2 는 노란 칸, 작업 중 api-fix 는 파란 배지, 끝난 sub-3 은 초록 진행 막대, sub-4 는 캐시 8분 남음" width="760">

같은 저장소에서 실행 중인 Claude Code 세션을 모두 보여 줍니다. 워크트리도 포함합니다.

- **팀 창**: 입력창 위에 세션마다 칸을 그립니다. 칸은 상태, 진행 막대, 결정 대기 질문, 숨은 실패를 보여 줍니다. 진행 막대는 채움 선 끝에 지금 단계 이름 칩을 붙이고(`▏━━━━ 테스트 실행 ╌╌│╌╌│╌╌  40%`), 멈춘 세션은 노란 `멈춤: <단계>`, 끝나면 걸린 시간(`✓ 3분 12초`)을 보입니다. 칸이 좁으면 예전 경로선 `●━◉─○─◎` 으로 그립니다.
- **지금 단계 줄**: 턴이 도는 동안 입력창 바로 위 줄(`✻ Sauteing… (12s)`)을 지금 단계 `2/5 테스트 실행… (12s)` 로 바꿉니다. 엔진이 권한 대기 같은 자기 문구를 띄우면 그대로 둡니다.
- **보드**: `/board` 는 세션별 요청, 진행, 결정 기록을 보여 줍니다. 결정 대기 항목을 12살 버전·ASD-STE100 기준 탭으로 설명하고, HTML 페이지(Artifact)를 요청할 수 있습니다.
- **숨은 실패**: exit 0으로 끝났지만 출력에 실패 흔적이 있는 빌드·테스트를 찾습니다. Claude와 모든 탭에 알립니다.
- **결정 대기 알림**: 세션이 결정을 20초 넘게 기다리면 소리로 알립니다. chime 은 macOS, Windows(PowerShell), Linux(`paplay` 또는 `aplay`)에서 울리고, 음성 안내는 macOS에서만 나옵니다. Windows·Linux 는 실기에서 확인하지 않았습니다.
- **캐시 남은 시간**: 프롬프트 캐시가 10분 이하로 남으면 칸에 표시합니다.
- **보조 에이전트**: 세션이 띄운 서브에이전트가 몇 개 돌고 몇 개 끝났는지 팀 창 머리줄(`보조 n`)과 카드에 보여 줍니다. 카드에는 진행 막대 아래 보조마다 한 줄(`↳ 1 결제 테이블 조사 (haiku 5.5)  Grep  12초`)이 붙고, 넘치면 `↳ +2 보조 2개 · 2개 끝남` 으로 줄입니다. `/board <세션>` 목록에는 종류·모델·지금 도구·경과·토큰이 나오고, 토큰은 보조가 끝난 뒤 엔진이 센 수입니다. 백그라운드로 맡겨 둔 세션과 멈춘 세션을 구별할 수 있습니다. 턴은 끝났지만 보조가 아직 도는 세션은 `대기` 가 아니라 `보조` 배지와 `보조 n개 기다리는 중` 으로 보입니다. 모델 호출이 없어 토큰이 들지 않습니다.

| 명령 | 동작 |
| --- | --- |
| `/board` | 모든 세션을 보여 줍니다. |
| `/board <세션>` | 한 세션의 할 일, 결정 기록, 흐름, 최근 편집 파일을 보여 줍니다. |
| `/board fail` | 숨은 실패 보고서를 보여 줍니다. |
| `/board help` | 모든 명령과 예시를 보여 줍니다. |

### 용도별 사용 예

**1. 여러 세션 중 결정을 기다리는 세션 찾기**

세션을 여러 개 돌리면 어느 세션이 내 답을 기다리는지 놓치기 쉽습니다. 입력창 위 팀 창에서 노란 ` 결정 ` 칸을 찾으세요. 질문 앞부분이 칸에 보입니다(절 맨 위 그림의 sub-2). `/board` 를 열면 결정 대기 세션이 맨 위에 옵니다.

**2. 결정이 어려울 때 설명 받기**

결정 대기 카드의 탭을 누르면 Haiku가 그 질문을 풀어 설명합니다. `12살` 은 비유와 선택지별 흐름 그림, `ASD-STE100` 은 "X를 고르면 Y가 일어납니다" 꼴의 짧은 문장입니다. 설명을 다시 받으려면 탭 옆 `↻` 를, 페이지로 보려면 `[ HTML ]` 을 누르세요.

<img src="docs/images/explain.webp" alt="12살 탭: 왜 지금, 비유, 선택지 세 개의 흐름 상자, 맥락과 제안, 먼저 정할 것" width="560">

<img src="docs/images/ste.webp" alt="ASD-STE100 탭: 정할 것, 선택지마다 고르면 일어나는 일, 세션 제안" width="560">

**3. 보조 에이전트에 맡겨 둔 세션 구별하기**

턴은 끝났지만 서브에이전트가 아직 도는 세션은 ` 대기 ` 가 아니라 ` 보조 ` 배지와 `보조 n개 기다리는 중` 으로 보입니다. `/board <세션>` 에서 에이전트마다 하는 일, 지금 도구, 경과 시간, 끝난 뒤 토큰을 봅니다.

<img src="docs/images/agents-band.webp" alt="팀 창: api-fix 칸에 보조 배지와 보조 1개 기다리는 중" width="760">

<img src="docs/images/agents.webp" alt="/board api-fix: 보조 에이전트 두 개, 하나는 Grep 실행 중, 하나는 끝나고 21k 토큰" width="560">

**4. 성공처럼 끝난 실패 찾기**

`./gradlew test 2>&1 | tail -20` 처럼 파이프 때문에 exit 0 으로 끝났지만 출력에 실패가 있으면 카드가 빨갛게 바뀝니다. Claude에게도 알려서 성공이라고 보고하지 않게 합니다.

<img src="docs/images/silent-failure.webp" alt="숨은 실패: 빨간 주의 띠와 함께 명령과 실패 흔적을 보여 주는 카드" width="460">

**5. 한 세션의 흐름을 되짚고 원문 복사하기**

`/board sub-3` 은 할 일, 결정 기록(질문 → 답), 흐름(요청 → 질문 → 결정 → 완료)을 시간 순으로 보여 줍니다. 흐름 줄을 누르면 그 원문 전체가 클립보드에 복사됩니다. 다른 세션에 같은 요청을 다시 보낼 때 씁니다.

<img src="docs/images/flow.webp" alt="/board sub-3: 할 일 4개, 결정 기록 1건, 흐름 여섯 줄" width="560">

**6. 좁은 패널에서 보기**

Orca 도크처럼 좁은 패널에서는 카드 머리줄이 덜 중요한 것(ctx 막대, 몇 초 전, 캐시)부터 덜어 내 한 줄을 지킵니다. 탭 줄은 탭 단위로 줄을 바꿉니다.

<img src="docs/images/narrow.webp" alt="40칸 패널: 머리줄 한 줄, 탭 줄이 세 줄로 나뉨" width="300">

팀 창 모양, 세션 이름, 카드 기호, 숨은 실패 판정 규칙, 기록하는 내용은 [docs/team-board.md](docs/team-board.md)를 보세요.

---

## 📋 work-plan: 작업 계획 보고

- Claude가 여러 단계 작업의 계획과 진행을 `plan_update` 도구로 보고합니다. team-board가 이 보고로 진행 막대와 지금 단계 줄을 그립니다.

<img src="docs/images/work-plan-turn.webp" alt="plan_update 로 3단계 계획 보고, Spinner 줄 2/3 파일 3개 읽기, 팀 창 막대 33%" width="760">

- Opus 5.5 같은 새 모델에는 할 일 도구(TodoWrite, TaskCreate)가 없어 진행 막대가 비어 있습니다. 이 mod가 그 자리를 채웁니다.
- 혼자 설치하면 화면에 보이는 것이 없습니다. team-board와 함께 설치하세요.
- 보고는 모델이 하므로 짧은 작업에서는 빠질 수 있습니다.

- 비용: 요청마다 도구 설명 약 560 토큰이 들어갑니다. 보고는 작업 도구와 같은 응답에 실려 요청 수는 늘지 않았습니다(3단계 작업 2회 측정, API 환산 +22%).
- 선택: `planGate` 를 켜면 한 턴에서 계획을 보고하기 전의 파일 수정(Edit, Write, NotebookEdit)을 거부합니다. 기본은 꺼짐입니다.

동작, 조직 관리 환경(Team, Enterprise)에서의 제약, 알아둘 것은 [work-plan/README.md](work-plan/README.md)를 보세요.

---

## 🔤 plain-terms: 용어 풀이

- Claude가 답변에서 약어(`tsc`), 작업 번호(`T6`), 코드 이름(`scanGen`)을 처음 쓸 때 괄호로 짧게 풀어 씁니다. 예: `tsc(TypeScript 타입 검사기)`

<img src="docs/images/plain-terms-answer.webp" alt="답변의 TTL, LRU, getOrder(id) 뒤에 괄호 풀이" width="760">

- 화면에 그리는 것은 없습니다. 혼자 설치해도 동작합니다.
- 효과: 처음 나온 용어 중 풀이가 붙은 비율이 시험 프롬프트 5개에서 44.9% → 81.1% 로 올랐습니다. 평소 답변 20개의 기준값은 20.8% 였습니다.
- 비용: 대화 첫 요청에 규칙 약 280 토큰. 요청 수는 늘지 않았고 답변은 평균 11.5% 길어졌습니다.

측정 방법과 알아둘 것은 [plain-terms/README.md](plain-terms/README.md)를 보세요.

---

## 📐 draw: 흐름 그림

- `/draw` 는 직전 답변에 든 흐름(작업 순서, 호출 경로, 갈래)을 옆 패널에 그림으로 보여 줍니다. `/draw <낱말>` 은 그 낱말에 관한 흐름만 그립니다.
- 상자 이름은 원문 낱말과 식별자를 그대로 씁니다. 설명을 쉽게 바꾸는 것은 `/eli12` 입니다.
- 효과: 실제 긴 답변 10개에서 상자 이름 99.3% 가 원문 낱말이었고, 9/10 이 원문 단계를 빠뜨리지 않았습니다(2회 측정).
- 비용: 실행마다 Haiku 1회. 메인 대화 요청은 늘지 않습니다. Esc로 패널을 닫습니다.

<img src="docs/images/draw-panel.webp" alt="왼쪽 답변, 오른쪽 패널에 place_order 네 갈래 흐름 그림" width="760">

측정 방법과 알아둘 것은 [draw/README.md](draw/README.md)를 보세요.

---

## 📅 look-back: 돌아보기

- `/lookback [오늘|어제|7일|30일|올해]` 은 그 기간 동안 프로젝트별로 Claude에게 보낸 요청(결과, 걸린 시간), 내린 결정(team-board 기록), 그 저장소의 커밋 제목을 옆 패널에 보여 줍니다.
- 대화형 세션의 사람 요청만 기록합니다. 설치한 뒤부터 쌓입니다.
- 비용: 기록과 보기는 토큰 0입니다. 프로젝트의 `[요약]` 을 누를 때만 Haiku 1회.
- 패널 맨 위 "한눈에" 칸(Work Report): 아낀 시간(추정)·끝낸 요청·Claude 작업 시간 타일, 어디에 썼나(코드 수정·실행·조사·대화), 누가 했나(모델), 3줄 차트, 연속 일수. `/lookback report off` 로 숨깁니다.

<img src="docs/images/work-report.webp" alt="한눈에 칸: 아낀 시간 0.6시간, 끝낸 요청 111건, Claude 작업 2.5시간, 종류별·모델별 막대, 최근 7일 차트" width="560">

저장 위치와 알아둘 것은 [look-back/README.md](look-back/README.md)를 보세요.

---

## 🧒 eli12: 12살 버전 설명

- 자동 스킬 `explain-simply` 는 어려운 설명에만 비유와 그림을 넣습니다.
- `/eli12` 는 직전 답변을 옆 패널에 12살 버전으로 풉니다.
- `/eli12 바운디드 컨텍스트` 는 그 부분만 풉니다. 직전 답변이 없으면 주제 자체를 설명합니다.
- Esc로 패널을 닫습니다.
- 실행마다 Haiku를 1회 호출합니다.

---

## 💡 next-steps: 다음 요청 제안

- 답변이 끝나면 입력창 위에 `다음: 1 … 2 … 3 …` 을 보여 줍니다. 목록 위의 흐린 가로줄 `── next-steps ──`이 위 대화와 목록을 나눕니다.
- 빈 입력창에서 숫자를 누르면 그 요청이 초안으로 들어갑니다. 고치거나 Enter로 보내세요. 자동으로 보내지 않습니다.
- 제안 줄을 클릭하면 그 요청이 입력창의 커서 자리에 들어갑니다. 쓰던 글은 남습니다. 마우스를 올린 줄에는 음영이 생깁니다. 클릭은 fullscreen 터미널에서만 동작합니다.
- `0` 은 목록을 닫습니다.
- 제안은 대화 언어를 따릅니다. 파일 이름, 명령, 식별자는 그대로 둡니다.
- `/next` 는 이번 세션 사용량을 보여 줍니다. `/next off` 와 `/next on` 은 다음 세션에도 유지됩니다.

<img src="docs/images/next-steps-list.webp" alt="답변 아래 ── next-steps ── 가로줄과 제안 목록" width="760">

그림과 사용 예는 [next-steps/README.md](next-steps/README.md)를 보세요.

<details>
<summary>비용과 주의</summary>

- 메인 스레드의 답변이 끝날 때마다 Haiku를 1회 호출합니다.
- 보내는 내용: 최근 대화 6개를 800자씩, 최신 답변 2000자. 출력은 200토큰 이하입니다.
- 20자 미만의 답변, 서브에이전트의 턴, 백그라운드 에이전트가 실행 중일 때는 호출하지 않습니다.
- 목록이 보이는 동안 빈 입력창에 `1` 로 시작하는 글을 치면 첫 글자가 제안을 고릅니다. 이때는 `0` 으로 목록을 먼저 닫으세요.
- prompt-coach 가 질문을 띄우면 목록을 닫습니다. 숫자는 prompt-coach 질문의 답이 됩니다.
- 아이디어는 [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods)의 next-steps(MIT)에서 얻었습니다. 코드는 새로 썼습니다.

</details>

---

## 📝 prompt-coach: 초안 다듬기

<img src="docs/images/prompt-coach-question.webp" alt="초안 place_order 재고 해제 고쳐줘 에 대해 prompt-coach 가 객관식 질문 1/2 를 띄운 띠" width="760">

옵션별 그림과 사용 예는 [prompt-coach/README.md](prompt-coach/README.md)를 보세요.

- 입력창에 초안을 쓰면 위에 띠가 보입니다. 굵은 회색 가로줄 `━━ prompt-coach ━━` 아래에 (위 대화와는 빈 줄 하나로 띄움) `[다듬기]` 버튼이 있습니다. 입력창을 비우면 띠가 사라집니다.
- 다듬기는 두 단계입니다.
  1. 질문: Haiku가 초안만 보고, 사람만 아는 빈 곳(목표, 범위, 결과 모양, 완료 확인)을 객관식으로 3개까지 묻습니다. 초안이 이미 분명하면 묻지 않고 바로 다음 단계로 갑니다.
  2. 다시 쓰기: 답을 넣어 목표 → 맥락 → 조건 → 완료 기준 순으로 다시 쓰고 입력창을 바꿉니다. 보내기는 직접 하세요.
- 질문하는 동안 입력창은 비워 둡니다. 초안은 띠의 `초안` 줄에 보입니다. 입력창이 비어 있어서 숫자 키로 답할 수 있습니다.

| 질문 중 입력 | 동작 |
| --- | --- |
| `1`~`4` | 그 번호의 선택지를 고릅니다. |
| `0` | 이 질문을 건너뜁니다. |
| `9` | 남은 질문을 건너뛰고 지금까지의 답으로 바로 다시 씁니다. |
| 입력창에 글을 쓰고 Enter | 그 글을 이 질문의 답으로 받습니다. 보내지 않습니다. |
| `>` 로 시작하는 글을 쓰고 Enter | 다듬기를 그만두고 `>` 를 뺀 글을 새 요청으로 보냅니다. 초안은 입력창에 돌려놓습니다. |
| `[취소]` | 다듬기를 그만두고 초안을 입력창에 돌려놓습니다. |

- 다시 쓴 뒤 띠에 `답 n · 제안 n` 과 보탠 것이 보입니다. 초록은 답에서 온 것, 노랑은 Haiku가 스스로 보탠 결과 모양이나 완료 확인입니다. 고치거나 그대로 보내세요.
- 버튼 누르기: **ctrl+x tab** 으로 띠에 들어가 **Tab** 으로 옮기고 **Enter** 로 누릅니다. **Esc** 로 입력창에 돌아옵니다. 마우스로도 누를 수 있습니다.

| 명령·버튼 | 동작 |
| --- | --- |
| `[다듬기]` | 입력창의 초안으로 다듬기를 시작합니다. |
| `[되돌리기]` | 다듬은 뒤에만 보입니다. 다듬기 전 원문으로 되돌립니다. 다듬은 뒤 입력창을 고쳤으면 덮지 않습니다. |
| `/coach <초안>` | `[다듬기]` 와 같은 일을 키보드로 합니다. |
| `/coach view` | 옆 패널에 상세를 띄웁니다: 지금 단계, 질문 전체(고른 답 바꾸기), 다듬기 전후 낱말 수·보탠 것·원문과 다듬은 글, 최근 20개 기록(`입력창에 넣기`), 자동 모드 켜기·끄기. |
| `/coach auto on\|off` | 자동 모드. 켜면 입력창에서 보낼 때마다 먼저 묻고 다듬습니다. 그대로 보내려면 맨 앞에 `>` 를 붙이세요. 기본은 꺼짐이고, 모든 세션에 같이 적용됩니다. |
| `/coach cancel` | `[취소]` 와 같습니다. |
| `/coach undo` | 다듬기 전 원문을 입력창에 넣습니다. |
| `/coach template` | 빈 틀(목표·맥락·조건·완료 기준)을 입력창에 넣습니다. 모델을 호출하지 않습니다. 이전에 다듬은 원문은 지웁니다. |
| `/coach` | 사용법과 이번 세션 사용량(호출 수, Haiku 입력·출력 토큰)을 보여 줍니다. |

- team-board를 함께 쓰면 질문이 답을 기다리는 동안 그 세션이 결정 필요(`prompt-coach: <질문>`)로 보입니다.
- next-steps 0.3.1 이상과 함께 쓰면 질문이 뜰 때 next-steps 제안 목록이 닫힙니다. 그 전 판에서는 두 띠가 함께 보이면 숫자를 next-steps 가 가져갑니다.
- 원문은 한 번만 되돌릴 수 있고, 보내면 지워집니다.

<details>
<summary>비용과 주의</summary>

- 다듬기 한 번에 Haiku를 2회(질문, 다시 쓰기) 호출합니다. 초안이 분명해 묻지 않은 때도 질문 호출은 이미 했으므로 2회입니다. 출력은 호출마다 1500토큰 이하입니다. 실제 사용 예: 2회 합쳐 입력 1,193 · 출력 781 토큰.
- 자동 모드를 켜면 입력창에서 보내는 글마다 Haiku를 2회 호출합니다. 다음은 묻지 않고 그대로 보냅니다: 공백을 뺀 12자 미만의 글, 슬래시 명령, 첨부가 있는 글, Claude의 질문에 답하는 글, `>` 로 시작하는 글, 다듬은 글을 넣은 뒤의 첫 보내기.
- 메인 대화의 토큰은 늘지 않습니다 (`claude -p` 첫 요청 입력이 0.2.3 과 같음).
- 공백을 뺀 12자 미만의 초안은 다듬지 않습니다.
- 파일 이름, 경로, 숫자, 조건, 이유, 범위를 정하는 말("모든", "첫 번째만")은 그대로 둡니다. 붙여넣은 블록, 코드, `@` 파일 참조, 초안의 라벨도 그대로 둡니다. 초안에도 답에도 없는 요구사항은 더하지 않습니다. 결과 모양과 완료 확인만 제안으로 보탭니다.
- 초안 안에 있는 지시는 Haiku가 따르지 않고 다듬기만 합니다.
- 대화 기록은 보내지 않습니다. "아까 그 파일" 같은 말은 그대로 남고, 그것이 무엇인지 묻지 않습니다.
- 질문과 결과는 초안의 언어를 따릅니다.
- 기록 20개는 `$.store` 에 초안과 다듬은 글 원문 그대로 저장되며 모든 세션이 같이 씁니다.
- 아이디어는 [yuk7392/prompt-coach](https://github.com/yuk7392/prompt-coach)의 Refine(MIT)에서 얻었습니다. 질문 먼저·보탠 것 표시는 Tristen O'Brien 의 Prompt Upgrade 를 참고했습니다. 코드는 새로 썼습니다.

</details>

---

## 다른 mod와 함께 쓰기

다른 mod가 입력창 위 영역을 차지하면 팀 창이 보이지 않을 수 있습니다. 이때 `~/.claude/settings.json` 에 아래 설정을 넣으세요.

```json
"prependPlugins": ["team-board@devflow-mods"]
```

원인과 확인 방법은 [docs/team-board.md](docs/team-board.md#다른-mod와-함께-쓰기)를 보세요.

## 개발

```bash
claude plugin validate ./team-board     # 받는 이벤트와 호출을 확인합니다
claude plugin test ./team-board         # 테스트를 실행합니다
claude plugin test ./eli12
claude plugin test ./work-plan
claude plugin test ./plain-terms
claude plugin test ./draw
claude plugin test ./look-back
```

- 각 mod의 화면과 문구는 `hooks/` 의 순수 함수에 있습니다. 예: `board.ts`, `diagram.ts`, `failure.ts`, `prompt.ts`
- 문서와 테스트의 `order-svc`, `sub-2`, `PR38` 은 예시 이름입니다.

## 변경 기록

[CHANGELOG.md](CHANGELOG.md)

## 라이선스

[MIT](LICENSE)

`team-board/hooks/failure.ts` 의 숨은 실패 규칙 일부는 [reasonofmoon-mods](https://github.com/Reasonofmoon/reasonofmoon-mods)(MIT, © Reason of Moon)를 바탕으로 고쳐 썼습니다.
