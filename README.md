# devflow-mods

Claude Code mod 모음입니다. 여러 세션의 상황판, 12살 버전 설명, 다음 요청 제안, 초안 다듬기를 제공합니다.

[![Claude Code](https://img.shields.io/badge/Claude_Code-2.1.287%2B-d97757)](https://code.claude.com/docs/en/plugins/mods/overview)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue)](LICENSE)

<p align="center">
  <img src="docs/images/board.webp" alt="team-board: 결정을 기다리는 세션은 주의 띠와 느낌표 아이콘, 할 일은 경로선으로 표시" width="560">
</p>

## mod 목록

| | mod | 하는 일 | 명령 |
| :---: | --- | --- | --- |
| 🧭 | [**team-board**](#-team-board-팀-상황판) | 같은 저장소의 여러 세션을 한 화면에 보여 줍니다. 진행 현황, 결정 기록, 결정 대기 알림, 숨은 실패, 프롬프트 캐시 남은 시간을 표시합니다. | `/board` |
| 🧒 | [**eli12**](#-eli12-12살-버전-설명) | 어려운 설명을 12살 버전으로 풉니다. | `/eli12 [주제]` |
| 💡 | [**next-steps**](#-next-steps-다음-요청-제안) | 답변이 끝나면 다음 요청 2~3개를 제안합니다. | `/next [on\|off]` |
| 📝 | [**prompt-coach**](#-prompt-coach-초안-다듬기) | 보내기 전에 초안을 다듬습니다. | `/coach <초안>`, `[다듬기]` 버튼, `/coach template` |

| 설정 | mod | 바꾸는 곳 | 기본값 |
| --- | --- | --- | --- |
| 색 `palette` | team-board | `claude plugin configure team-board@devflow-mods` | `night` |
| 팀 창 켜기·끄기, 모양 | team-board | `/board band on\|off\|hud\|line`, `/board band solo off` | 켜짐, `hud` |
| 결정 대기 음성 알림 | team-board | `/board sound on\|off\|test` | 켜짐, macOS만 |
| 숨은 실패 감지 | team-board | `/board fail on\|off\|clear` | 켜짐 |
| 세션 표시 이름 | team-board | `/board name <이름>` | 세션 이름 → 브랜치 → 폴더 |
| 다른 mod보다 앞에 두기 | team-board | `~/.claude/settings.json` 의 `prependPlugins` | 없음 |
| 다음 요청 제안 | next-steps | `/next on\|off` | 켜짐 |

Claude Code v2.1.287 이상이 필요합니다. `claude --version` 으로 확인하세요.

## 설치

```bash
claude plugin marketplace add yeochul-jeon/devflow-mods
claude plugin install team-board@devflow-mods
claude plugin install eli12@devflow-mods
claude plugin install next-steps@devflow-mods     # 답변마다 Haiku를 호출합니다
claude plugin install prompt-coach@devflow-mods   # 누를 때만 Haiku를 호출합니다
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

<img src="docs/images/hud.webp" alt="입력창 위 팀 창: 결정 대기 세션은 노란 칸, 할 일은 경로선" width="760">

같은 저장소에서 실행 중인 Claude Code 세션을 모두 보여 줍니다. 워크트리도 포함합니다.

- **팀 창**: 입력창 위에 세션마다 칸을 그립니다. 칸은 상태, 할 일 경로선, 결정 대기 질문, 숨은 실패를 보여 줍니다.
- **보드**: `/board` 는 세션별 요청, 진행, 결정 기록을 보여 줍니다. 결정 대기 항목을 12살 버전으로 설명합니다.
- **숨은 실패**: exit 0으로 끝났지만 출력에 실패 흔적이 있는 빌드·테스트를 찾습니다. Claude와 모든 탭에 알립니다.
- **음성 알림**: 세션이 결정을 20초 넘게 기다리면 소리로 알립니다. macOS에서만 동작합니다.
- **캐시 남은 시간**: 프롬프트 캐시가 10분 이하로 남으면 칸에 표시합니다.

| 명령 | 동작 |
| --- | --- |
| `/board` | 모든 세션을 보여 줍니다. |
| `/board <세션>` | 한 세션의 할 일, 결정 기록, 흐름, 최근 편집 파일을 보여 줍니다. |
| `/board fail` | 숨은 실패 보고서를 보여 줍니다. |
| `/board help` | 모든 명령과 예시를 보여 줍니다. |

<img src="docs/images/silent-failure.webp" alt="숨은 실패: 빨간 주의 띠와 함께 명령과 실패 흔적을 보여 주는 카드" width="460">

팀 창 모양, 세션 이름, 카드 기호, 숨은 실패 판정 규칙, 기록하는 내용은 [docs/team-board.md](docs/team-board.md)를 보세요.

---

## 🧒 eli12: 12살 버전 설명

- 자동 스킬 `explain-simply` 는 어려운 설명에만 비유와 그림을 넣습니다.
- `/eli12` 는 직전 답변을 옆 패널에 12살 버전으로 풉니다.
- `/eli12 바운디드 컨텍스트` 는 그 부분만 풉니다. 직전 답변이 없으면 주제 자체를 설명합니다.
- Esc로 패널을 닫습니다.
- 실행마다 Haiku를 1회 호출합니다.

---

## 💡 next-steps: 다음 요청 제안

- 답변이 끝나면 입력창 위에 `다음: 1 … 2 … 3 …` 을 보여 줍니다.
- 빈 입력창에서 숫자를 누르면 그 요청이 초안으로 들어갑니다. 고치거나 Enter로 보내세요. 자동으로 보내지 않습니다.
- `0` 은 목록을 닫습니다.
- 제안은 대화 언어를 따릅니다. 파일 이름, 명령, 식별자는 그대로 둡니다.
- `/next` 는 이번 세션 사용량을 보여 줍니다. `/next off` 와 `/next on` 은 다음 세션에도 유지됩니다.

<details>
<summary>비용과 주의</summary>

- 메인 스레드의 답변이 끝날 때마다 Haiku를 1회 호출합니다.
- 보내는 내용: 최근 대화 6개를 800자씩, 최신 답변 2000자. 출력은 200토큰 이하입니다.
- 20자 미만의 답변, 서브에이전트의 턴, 백그라운드 에이전트가 실행 중일 때는 호출하지 않습니다.
- 목록이 보이는 동안 빈 입력창에 `1` 로 시작하는 글을 치면 첫 글자가 제안을 고릅니다. 이때는 `0` 으로 목록을 먼저 닫으세요.
- 아이디어는 [hamzafer/claude-code-mods](https://github.com/hamzafer/claude-code-mods)의 next-steps(MIT)에서 얻었습니다. 코드는 새로 썼습니다.

</details>

---

## 📝 prompt-coach: 초안 다듬기

- 입력창에 초안을 쓰면 위에 `[다듬기]` 버튼이 보입니다.
- 버튼을 누르면 초안을 목표 → 맥락 → 조건 → 완료 기준 순으로 다듬어 입력창을 바꿉니다. 보내기는 직접 하세요.
- 다듬는 동안 초안을 고치면 결과로 덮지 않습니다.
- `/coach <초안>` 은 같은 일을 키보드로 합니다.
- 다듬은 결과에 완료 기준이 없으면 토스트로 알립니다. 다듬은 글에는 덧붙이지 않습니다.
- 다듬은 뒤에는 `[되돌리기]` 버튼이 보입니다. 누르면 다듬기 전 원문으로 되돌립니다. 다듬은 뒤 입력창을 고쳤으면 덮지 않습니다.
- `/coach undo` 도 원문으로 되돌립니다. 원문은 한 번만 되돌릴 수 있고, 보내면 지워집니다.
- `/coach template` 은 빈 틀(목표·맥락·조건·완료 기준)을 입력창에 넣습니다. 모델을 호출하지 않습니다.
- `/coach` 는 이번 세션 사용량을 보여 줍니다.

<details>
<summary>비용과 주의</summary>

- 누를 때마다 Haiku를 1회 호출합니다. 초안만 보내고, 출력은 1500토큰 이하입니다.
- 공백을 뺀 12자 미만의 초안은 다듬지 않습니다. 보낼 때 자동으로 검사하지 않습니다.
- 파일 이름, 경로, 숫자, 조건, 이유, 범위를 정하는 말("모든", "첫 번째만")은 그대로 둡니다. 붙여넣은 블록, 코드, `@` 파일 참조, 초안의 라벨도 그대로 둡니다. 초안에 없는 요구사항은 더하지 않습니다.
- 초안 안에 있는 지시는 Haiku가 따르지 않고 다듬기만 합니다.
- 대화 기록은 보내지 않습니다. "아까 그 파일" 같은 말은 그대로 남습니다.
- 결과는 초안의 언어를 따릅니다.
- 입력창에 포커스가 있으면 단축키로 버튼을 누를 수 없습니다. 마우스로 누르거나 `/coach` 를 쓰세요.
- 아이디어는 [yuk7392/prompt-coach](https://github.com/yuk7392/prompt-coach)의 Refine(MIT)에서 얻었습니다. 코드는 새로 썼습니다.

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
```

- 각 mod의 화면과 문구는 `hooks/` 의 순수 함수에 있습니다. 예: `board.ts`, `diagram.ts`, `failure.ts`, `prompt.ts`
- 문서와 테스트의 `order-svc`, `sub-2`, `PR38` 은 예시 이름입니다.

## 변경 기록

[CHANGELOG.md](CHANGELOG.md)

## 라이선스

[MIT](LICENSE)

`team-board/hooks/failure.ts` 의 숨은 실패 규칙 일부는 [reasonofmoon-mods](https://github.com/Reasonofmoon/reasonofmoon-mods)(MIT, © Reason of Moon)를 바탕으로 고쳐 썼습니다.
