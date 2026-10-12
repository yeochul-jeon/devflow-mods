# devflow-mods

Claude Code **mods** 모음: 어려운 설명을 12살 버전으로 풀어 주는 `eli12`, 여러 세션을 한눈에 보는 팀 상황판 `team-board`.

<p align="center">
  <img src="docs/images/board.webp" alt="team-board: 결정을 기다리는 세션은 주의 띠와 느낌표 아이콘, 할 일은 경로선으로 표시" width="560">
</p>

| 플러그인 | 하는 일 | 명령 |
|---|---|---|
| `team-board` | 같은 저장소(워크트리 포함)에서 돌고 있는 여러 Claude Code 세션의 상황판. 진행 현황(할 일 경로선), 결정 기록(질문 → 답), 결정 대기 알림(주의 띠·음성), **숨은 실패 감지**(exit 0 인데 실패한 빌드·테스트), 결정 대기 항목의 12살 버전 설명 | `/board` |
| `eli12` | 어려운 설명만 골라 12살 버전으로. 자동 스킬(`explain-simply`) + 직전 답변이나 주제를 옆 패널에 풀어 주는 명령 | `/eli12 [주제]` |
| `next-steps` | 답변이 끝나면 다음에 보낼 만한 요청 2~3개를 입력창 위에. 빈 입력창에서 숫자를 누르면 초안으로 들어감 (턴마다 Haiku 1회) | `/next [on\|off]` |

Claude Code **v2.1.287 이상**이 필요합니다 (`claude --version`).

## 설치

```bash
claude plugin marketplace add yeochul-jeon/devflow-mods
claude plugin install team-board@devflow-mods      # 모든 세션·워크트리에서 보여야 하므로 사용자 범위(기본)
claude plugin install eli12@devflow-mods
claude plugin install next-steps@devflow-mods     # 필요할 때만 (턴마다 Haiku 호출)
```
설치 중 `1 userConfig option not yet set` 안내가 나오면 색 설정(palette)을 아직 안 골랐다는 뜻이고, 그대로 두면 기본값 `night` 로 동작합니다.
특정 프로젝트에만 쓰려면 그 프로젝트 폴더에서 `--scope local` 을 붙이세요. 설치 후 열려 있는 Claude Code 는 `/exit` 하고 다시 시작합니다 (`claude --continue` 로 대화를 이어서 열 수 있어요).

설치하지 않고 한 세션만 써보기:
```bash
git clone https://github.com/yeochul-jeon/devflow-mods
claude --plugin-dir devflow-mods/team-board --plugin-dir devflow-mods/eli12
```

> [!WARNING]
> mod 는 Claude Code 와 같은 권한으로 내 컴퓨터에서 돌아가는 코드입니다. 설치 전에 코드를 읽어 보세요. `claude plugin validate ./team-board` 로 어떤 이벤트를 받고 무엇을 호출하는지 실행 없이 볼 수 있습니다.

## 예전 이름(yeocheol-mods)으로 설치했다면

마켓플레이스 이름이 `devflow-mods` 로 바뀌었습니다. 한 번만 옮겨 주세요.
```bash
claude plugin uninstall team-board@yeocheol-mods
claude plugin uninstall eli12@yeocheol-mods          # 프로젝트에만 설치했다면 그 폴더에서 --scope local 을 붙여서
claude plugin marketplace remove yeocheol-mods
claude plugin marketplace add yeochul-jeon/devflow-mods
claude plugin install team-board@devflow-mods
claude plugin install eli12@devflow-mods             # 프로젝트에만 쓰려면 그 폴더에서 --scope local
```
상황판 기록(`~/.claude/team-board/`)은 그대로 이어집니다. `/board band off`, `sound off`, `name` 같은 설정은 다시 해야 할 수 있어요.

## 업데이트

```bash
claude plugin marketplace update devflow-mods
claude plugin update team-board@devflow-mods
claude plugin update eli12@devflow-mods
```
업데이트한 뒤에는 세션을 다시 열어야 새 버전이 적용됩니다.

## team-board 사용

입력창 위 팀 창 (같은 레포의 세션 수만큼 칸이 생김, 다른 mod 의 띠 아래에 붙음):

<img src="docs/images/hud.webp" alt="입력창 위 팀 창: 결정 대기 세션은 노란 칸, 할 일은 경로선" width="760">

- 머리줄: 세션 수 · 결정 대기(노란 배지) · 작업중 · 대기 · 전체 할 일 진행률 · `[ 보드 /board ]` 버튼
- 세션 칸: 결정 대기 칸은 노랗게 칠해지고 질문을 보여 줍니다. 할 일이 있으면 경로선, 없으면 지금 하는 일. `*` 이 세션 · `zz` 3분 넘게 소식 없음
- 한 줄로 작게 보고 싶으면 `/board band line` (예전 모양), 다시 창으로 `/board band hud`

세션 수가 바뀌면 창이 알아서 맞춥니다 (메인만 쓰든, 서브가 몇 개든)

<img src="docs/images/band-sizes.webp" alt="세션 1개: 한 줄 창 / 8개: 두 줄 칸이 두 줄로 / 좁은 화면: 한 줄 칸" width="760">

| 세션 | 모양 |
|---|---|
| 1개 (메인만) | 한 줄 창: 이름 · 상태 · 질문/실패/경로선/지금 하는 일. 숨기려면 `/board band solo off` |
| 여러 개 | 칸마다 두 줄 (이름·상태 / 질문·실패·경로선), 넘치면 두 줄까지 줄바꿈 |
| 많거나 화면이 좁을 때 | 칸마다 한 줄 (이름·상태) |
| 그래도 넘칠 때 | 중요한 세션부터 보이고 나머지는 `+k 더 · /board` |

보이는 순서: 결정 대기 > 숨은 실패 > 이 세션 > 작업중 > 대기 > 소식 없음.

세션 이름 (같은 폴더에서 여러 세션을 열어도 구분되게. `claude --name` 이름은 찾을 때까지 15초마다 확인해 반영)
1. `/board name 이름` 으로 정한 이름
2. Claude Code 세션 이름: `claude --name 이름` 으로 시작하거나 `/rename 이름` (보드가 바로 따라감)
3. 워크트리면 브랜치 이름
4. 폴더 이름. 그래도 같으면 `order-svc·2`, `order-svc·3` 처럼 번호가 붙습니다.

패널 조작: `/board` 를 열면 키보드가 패널로 갑니다. **Tab** 버튼 이동 · **Enter** 누름 · **PgUp/PgDn** 스크롤 (마우스 휠도 됨) · **Home** 맨 위 · **Esc** 닫기.

| 명령 | 화면 |
|---|---|
| `/board help` | 명령 목록과 예시 (입력창에서 `/board ` 를 치면 `[세션 \| name \| band \| sound \| fail \| help]` 힌트도 보임) |
| `/board` | 전체: 세션마다 요청, 지금 하는 일, 진행률과 진행 중인 할 일, 최근 결정, 결정 대기 질문 |
| `/board sub-2` | 자세히: 할 일 목록, 결정 기록 전체(질문 → 답), 흐름(요청 → 질문 → 결정 → 완료), 최근 편집 파일 |
| `/board name sub-1` | 이 세션의 표시 이름 바꾸기 (다음에 다시 열어도 유지) |
| `/board band off` / `on` | 입력창 위 팀 창 끄기 / 켜기 (다음 세션에도 기억) |
| `/board band hud` / `line` | 팀 창 모양: 창(기본) / 한 줄 |
| `/board band solo off` / `on` | 세션이 하나일 때 팀 창 숨기기 / 보이기 (기본 보임) |
| `/board fail` | 숨은 실패 보고서 (명령, 실패 흔적, 실패 코드를 가린 구문). `on` / `off` 감지 켜기·끄기, `clear` 이 세션 표시 지우기 |
| `/board sound off` / `on` / `test` | 결정 대기 음성 알림 끄기 / 켜기 (기본 켜짐) / 미리 듣기 |

- `[ 12살 버전으로 설명 ]` 버튼: 결정 항목마다 비유, 선택지별 **ASCII 흐름 그림**, 앞선 결정과의 맥락(◆), 세션 제안(★), 먼저 정할 것을 정리합니다. 그 세션의 **앞선 결정과 진행 상황도 맥락으로** 함께 넘깁니다 (Haiku 1회).
  ```
  1. PR38 착수 시점 결정
     비유  숙제 1을 하다가 숙제 2도 시작할지, 1을 끝낸 뒤 시작할지
     ▸ 리뷰 후 시작
       [ 자료 10장 수정 ] → [ 수정 완료 확인 ]
       → [ PR38 착수 ]
       └ 겹침 없이 안전하지만 조금 늦어요
     ◆ 맥락  앞서 release 만 push 하기로 함
     ★ 제안  리뷰 후 시작 (10장과 코드가 겹침)
  ```
  <img src="docs/images/explain.webp" alt="12살 버전 설명: 비유, 선택지별 흐름 상자, 맥락과 제안, 먼저 정할 것" width="560">

  그림은 모델이 아니라 mod 가 한글 폭을 계산해 그려서 상자가 어긋나지 않습니다. 패널이 넓으면 `┌──┐ → ┌──┐` 상자로, 좁으면 `[ ] → [ ]` 칩으로 그립니다.
- 설명이 생기면 `[ 12살 설명 접기 ▴ ]` / `[ 펼치기 ▾ ]` 로 접어 둘 수 있고, `[ 다시 만들기 ]` 로 새로 받을 수 있습니다.
- `[ 자세히 → ]` / `[ ← 전체 보기 ]` 버튼으로 오갈 수 있습니다.

카드 모양 (터미널, 패널 폭 56칸 이상):
```
╭──────────────────────────────────────────────────────────────╮
│ ▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚ 결정을 기다려요 ▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚▚           │  ← 결정 대기 카드에만
│ ▐ ▐▌ ▌ 결정 필요 sub-2                    ctx ▰▱▱▱▱ 4%     │
│ ▐ ▐▌ ▌ 결정   PR38 착수 시점을 정해 주세요                       │  ← 왼쪽: 상태 픽셀 아이콘
│ ▐ ▗▖ ▌ 진행   ●━━━━━◉─────○─────◎ 1/3  PR38 래퍼 수정            │  ← 할 일 경로선
╰──────────────────────────────────────────────────────────────╯
```
- 아이콘: `!` 결정 필요 · `→` 작업중 · `✓` 대기 · 물결 소식없음
- 경로선: `●` 끝낸 할 일 · `◉` 지금 · `○` 남은 할 일 · `◎` 도착. 할 일이 많으면 지금 근처만 보이고 양 끝은 `…`
- 데스크톱 앱, `theme` 팔레트, 좁은 패널에서는 아이콘 없이 글자 카드로 그립니다.

숨은 실패 (exit 0 인데 실패)

<img src="docs/images/silent-failure.webp" alt="숨은 실패: 빨간 주의 띠와 함께 명령과 실패 흔적을 보여 주는 카드" width="460">

- `./gradlew test 2>&1 | tail -30` 처럼 파이프로 출력을 자르면 테스트가 실패해도 exit 0 이 됩니다. Claude 가 이 결과를 "통과"로 보고하기 쉬워요.
- Bash 가 exit 0 으로 끝났는데 출력에 실패 흔적이 있으면:
  - Claude 에게: "exit 0 이지만 실패 흔적이 있으니 성공으로 보고하기 전에 확인하라"는 메모를 결과에 붙입니다. 파이프·`|| true` 로 실패 코드를 가렸으면 `set -o pipefail` 도 권합니다.
  - 사람에게: 팀 창의 그 세션 칸에 `⚠실패` 와 실패 줄(`12 tests completed, 1 failed`), 머리줄에 `⚠ 실패 n`, 보드 카드에 빨간 주의 띠. **다른 탭에서도** 보입니다.
- 잡는 것: Gradle(`BUILD FAILED`, `> Task … FAILED`, `n tests completed, m failed`), Maven(`Tests run: …, Failures: n`, `BUILD FAILURE`), JUnit(`… > 테스트() FAILED`), Kotlin·Java 컴파일 오류, Spring `APPLICATION FAILED TO START`, `Caused by: …Exception`, npm·Python 오류, bun 요약(`2 fail`), `command not found` 등. 건너뛴 테스트·실행된 테스트 없음(`No tests found for given includes`)·Maven `Tests are skipped.`(명령에 `skipTests`·`skipITs` 가 있으면 제외)는 "확인 필요"로 보드에만 표시하고, 다른 명령의 실패 표시를 덮지 않습니다.
- 오탐 줄이기: `grep`, `cat`, `tail`, `sort`, `uniq`, `cut`, `xargs grep`, `git log/diff`, `docker logs`, `kubectl logs` 처럼 로그를 **읽기만 하는** 단계로만 된 명령은 판정하지 않고 (`echo x && ./gradlew test` 는 판정), `0 failed` 같은 통과 요약은 무시합니다.
- 같은 명령이 실패 흔적 없이 다시 돌면 (출력이 없어도. 단 `|| true` 처럼 실패 코드를 가리는 명령은 출력이 있어야) 표시가 저절로 지워집니다. 같은 명령인지는 앞의 `cd`·`echo` 같은 단계를 건너뛰고 앞 두 낱말(`./gradlew test --tests X` → `./gradlew test`)로 보고, 둘째 낱말이 `run`·`-m`·`exec` 이면 세 낱말(`npm run lint`, `python -m pytest`)까지 봅니다.
- 영어 출력 기준이고 Bash 만 봅니다. 원 아이디어는 [Reasonofmoon/reasonofmoon-mods](https://github.com/Reasonofmoon/reasonofmoon-mods) 의 silent-failure (MIT).

음성 알림 (기본 켜짐, macOS)
- 어떤 세션이 결정을 **20초 넘게** 기다리면 그 세션이 "띵동" 소리와 함께 "sub-2 세션이 결정을 기다립니다"라고 한 번 말합니다.
- 질문이 나오자마자 그 탭에서 답하면 조용합니다. 탭이 여러 개여도 기다리는 세션만 말하니 한 번만 들립니다.
- 한국어 목소리(Yuna)를 씁니다. 없으면 기본 목소리로 읽는데 한국어가 어색할 수 있으니, macOS 시스템 설정 → 손쉬운 사용 → 읽기 및 말하기 → 시스템 목소리에서 한국어(Yuna)를 내려받아 두세요. `/board sound test` 로 확인.
- 카드 테두리 색 = 상태 (노랑 결정 필요 · 빨강 숨은 실패 · 파랑 작업중 · 회색 대기), `ctx` 막대 색 = 컨텍스트 여유 (초록 · 노랑 50%+ · 빨강 80%+).

프롬프트 캐시 남은 시간
- 보드의 세션 줄 `ctx` 옆에 `캐시 42분` 처럼 보입니다. 쉬는 세션이 10분 이하로 남으면 입력창 위 칸 태그가 노란 `캐시 n분` 으로 바뀝니다. 이 안에 다시 말을 걸면 대화 앞부분을 캐시에서 싸게 읽습니다.
- 마지막 메인 스레드 모델 요청부터 1시간으로 셉니다 (Claude Code 구독 세션의 캐시 수명). 서브에이전트 요청은 세지 않고, compact·`/clear` 뒤에는 다음 요청까지 비웁니다.
- 알 수 없는 경우: CLAUDE.md·도구 목록·effort 가 바뀌어 캐시가 깨진 경우, 5분 캐시를 쓰는 환경(API 키 등). 아이디어는 [cache-watch](https://github.com/ishuagrawal/cache-watch)·[cache-tax](https://github.com/karanb192/cache-tax) 에서 얻었고 코드는 새로 썼습니다.

색 바꾸기 (`palette`: `night` 기본 · `aurora` · `theme`). `theme` 은 Claude Code 테마 색을 따르니 밝은 배경이면 이것:
```bash
claude plugin configure team-board@devflow-mods      # 또는 /plugin → Installed → team-board → Configure
```

무엇이 기록되나
- 진행 현황: Claude가 쓰는 할 일 도구(TaskCreate/TaskUpdate, TodoWrite)를 그대로 따라갑니다.
- 결정: ① AskUserQuestion 질문과 고른 답, ② 답변 끝에서 결정을 요청한 뒤("정해 주세요", "할까요?" 등. "문제가 있으면 (바로) 알려 주세요" 같은 문제·필요·궁금함 조건문, "확인해 주세요", `?` 로 끝나는 제목은 제외. "진행해도 되면 알려 주세요" 는 포함) 사용자가 보낸 다음 요청을 그 결정의 답으로 기록합니다.
- 흐름: 요청, 질문, 결정, 완료, 중단, 숨은 실패를 최근 12개까지.
- 요청과 결정의 답으로 기록하는 입력: 터미널 입력창, Remote Control, `claude -p`·Agent SDK. 작업 알림, 다른 세션이 보낸 메시지, IDE 등 같은 사용자 소켓으로 들어온 입력, Slack 호출, 플러그인이 보낸 프롬프트는 기록하지 않습니다.

알아둘 것
- 상태는 `~/.claude/team-board/<레포>/` 에 세션마다 JSON 파일로 저장됩니다. 요청·질문·답 원문이 평문으로 들어가니 동기화되는 폴더가 아닌지 확인하세요. 오래된 파일은 지워도 됩니다.
- ②의 결정 기록은 "결정 요청 다음의 첫 요청"을 답으로 봅니다. 그 사이 다른 이야기를 하면 그것이 답으로 기록될 수 있습니다.
- 권한 확인 창(Allow?)에서 멈춘 상태는 mod가 알 수 없어 "작업중"으로 보입니다.
- Linux·Windows 터미널에서는 소리가 나지 않습니다 (Claude Code 가 그 환경의 재생기를 쓰지 않음).
- `/clear` 해도 보드에서 사라지지 않고 "대기"로 남습니다. 결정 기록은 유지, 결정 대기 질문과 할 일 진행률은 비우고, 흐름에 `⟲ 대화 지움`을 남깁니다. `/board name`·`/rename` 이름도 유지됩니다.
- 3초마다 갱신. 탭을 `/exit` 없이 닫으면 3분 뒤 흐리게 표시되고, 그 폴더에 같은 이름의 새 세션이 열려 있으면 그때 숨겨집니다. 12시간 뒤엔 모두 숨김.
- 플러그인이 갱신되거나 다시 로드돼도 같은 세션의 이름·할 일·결정 기록은 이어집니다.
- 할 일 진행률은 그 세션에서 만든 할 일만 셉니다 (다른 세션에서 넘어온 할 일 목록은 세지 않음).
- 숨은 실패는 출력 글자로 판단합니다. 실패를 일부러 출력하는 테스트(예: 실패 메시지를 검증하는 테스트)에서는 잘못 걸릴 수 있으니 `/board fail clear` 로 지우거나 `/board fail off` 로 끄세요.
- 숨은 실패 표시는 그 세션의 상태 파일에 함께 저장되어 탭을 다시 열어도 남습니다. 같은 명령(위의 기준)이 실패 흔적 없이 다시 돌면 지워집니다.

## eli12 사용

- 평소: 어려운 설명에서만 스킬이 비유와 그림을 넣습니다.
- `/eli12` (직전 답변) 또는 `/eli12 바운디드 컨텍스트` (그 부분, 답변이 없으면 주제 자체) → 옆 패널, Esc로 닫기.
- 실행마다 Haiku 호출 1회분 사용량.

## 다른 mod와 함께 쓰기

- 입력창 위 띠(`AbovePrompt`)를 `next(e)` 없이 그리는 mod가 체인에서 team-board보다 앞에 오면 팀 창이 보이지 않습니다. team-board 자체는 계속 기록합니다. 예: Anthropic 샘플 `token-weather`, `replay-theater`.
- 해결: `~/.claude/settings.json`에 아래를 넣어 team-board를 맨 앞에 둡니다. managed settings가 없는 기기에서, Team·Enterprise 로그인이 아닐 때만 적용됩니다.

  ```json
  "prependPlugins": ["team-board@devflow-mods"]
  ```

  적용 여부는 `claude --debug-file <파일>` 로그의 `hooks module team-board@devflow-mods loaded (… tier prepend)` 줄로 확인합니다.
- 이 설정으로 함께 시험한 mod (2026-10-12, Claude Code 2.1.296): `replay-theater`(claude-code-playground), `agent-flow`(davila7/claude-code-templates), `mermaid-draw`(galElmalah/claude-mods). 팀 창, 결정 기록, 숨은 실패 표시가 그대로 동작했습니다.
- 비밀 값을 가리는 mod(예: `secret-redactor`)는 도구 결과만 가립니다. team-board가 저장하는 실패 명령 원문은 가려지지 않습니다.

## next-steps 사용

- 답변이 끝나면 입력창 위에 `다음: 1 … 2 … 3 …` 이 뜹니다. **빈 입력창**에서 숫자를 누르면 그 요청이 초안으로 들어가고, 고치거나 Enter 로 보냅니다. 저절로 보내지 않습니다. `0` 은 닫기.
- 제안은 대화 언어를 따릅니다 (파일 이름·명령·식별자는 그대로).
- 비용: 메인 스레드의 답이 끝날 때마다 Haiku 1회 (최근 대화 6개를 800자씩 + 최신 답 2000자, 출력 200토큰 이하). 20자 미만의 답, 서브에이전트의 턴, 백그라운드 에이전트가 도는 중에는 부르지 않습니다.
- `/next` 이번 세션 사용량 · `/next off` 끄기 · `/next on` 켜기 (설정은 유지됩니다).
- 목록이 떠 있는 동안 빈 입력창에서 `1` 로 시작하는 글을 치면 첫 글자가 제안 고르기로 쓰입니다. 그럴 땐 `0` 으로 먼저 닫으세요.
- 아이디어는 [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods) 의 next-steps (MIT) 에서 얻었고 코드는 새로 썼습니다.

## 변경 기록

[CHANGELOG.md](CHANGELOG.md)

## 개발

```bash
claude plugin validate ./team-board     # 무엇을 훅하고 호출하는지
claude plugin test ./team-board         # 테스트
claude plugin test ./eli12
```
각 mod 의 화면·문구는 `hooks/` 의 순수 함수(`board.ts`, `diagram.ts`, `failure.ts`, `prompt.ts`)에 모여 있어 고치기 쉽습니다. README 와 테스트의 `order-svc`, `sub-2`, `PR38` 같은 이름은 예시입니다.

eli12 스킬 평가 (실제 에이전트를 돌리는 유료 실행. 3케이스 × 3회에 약 $0.7, 2026-10-12 측정):
```bash
cd eli12 && claude plugin eval . --trust-plugin --ablation none --runs 3 --no-publish --max-cost-usd 1
```
`eli12/evals/` 의 3케이스는 한 줄 답 요청에는 `explain-simply` 가 호출되지 않는지, 개념 설명 요청 2개에는 호출되는지, 그중 Kafka 설명에 그림과 비유·비유의 한계·사실 오류 없음(LLM 판정)이 있는지 봅니다. 결과는 `eli12/evals/results/` 에 저장되고 git 에서 제외됩니다.

## 라이선스

[MIT](LICENSE)

`team-board/hooks/failure.ts` 의 숨은 실패 규칙 일부는 [reasonofmoon-mods](https://github.com/Reasonofmoon/reasonofmoon-mods) (MIT, © Reason of Moon) 를 바탕으로 고쳐 썼습니다.
