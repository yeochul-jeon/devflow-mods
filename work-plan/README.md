# work-plan

Claude가 여러 단계 작업의 계획과 진행을 `plan_update` 도구로 보고하게 합니다. 화면 표시는 [team-board](../team-board/README.md)가 합니다. team-board의 할 일 경로선 `●━◉─○─◎` 과 진행률이 이 보고로 채워집니다.

- Opus 5.5 같은 새 모델에는 할 일 도구(TodoWrite, TaskCreate)가 없습니다. 그래서 team-board만 쓰면 경로선이 비어 있습니다.
- 혼자 설치하면 화면에 보이는 것이 없습니다. 오류도 나지 않습니다.
- team-board와 함께 쓰려고 `dependencies` 로 묶지 않았습니다. 두 mod는 각각 켜고 끌 수 있습니다.

```bash
claude plugin marketplace add yeochul-jeon/devflow-mods
claude plugin install work-plan@devflow-mods
claude plugin install team-board@devflow-mods     # 화면 표시
```

## 동작

- 도구 `plan_update`: 입력은 `{ steps: [{ title, status }] }` 입니다. 상태는 `todo`, `doing`, `done`, `blocked` 이고, 매번 전체 목록을 보냅니다. 제목은 60자, 단계는 30개까지입니다.
- 규칙: 대화의 첫 프롬프트에 한 번 붙입니다. 내용은 "여러 단계 작업이면 계획을 보고한다. 작업 도구와 같은 응답에 보낸다. 마지막 done 은 보내지 않아도 된다." 입니다. `/clear` 뒤와 compaction 뒤 첫 프롬프트에 다시 붙입니다. compaction 뒤에는 압축 전 계획 목록도 함께 붙입니다.
- 턴이 끝나면 끝났다는 표시만 남깁니다. team-board는 질문 없이 답으로 끝난 턴이면 남은 단계를 완료로 그립니다. 결정을 기다리거나 중단된 턴은 보고된 그대로 둡니다.
- 서브에이전트의 보고는 받기만 하고 저장하지 않습니다. 메인 세션의 경로선을 바꾸지 않습니다.
- 계획은 세션 안(`$.state`)에만 둡니다. 다른 세션에는 team-board가 자기 상태 파일로 전합니다.

## 비용과 끄기

2026-10-16 측정 (Opus 5.5, `claude -p`, 다른 mod 없이 2회씩):

| | work-plan 없음 | work-plan | 차이 |
| --- | --- | --- | --- |
| 요청마다 입력 (도구 설명) | 16,720 | 17,235 | +515 토큰 |
| 3단계 작업의 요청 수 | 3, 3 | 3, 3 | 0 |
| 3단계 작업의 입력 합계 | 52.3k | 55.1k | +2.8k |
| 3단계 작업의 출력 | 728 | 1,251 | +523 |
| 3단계 작업 `total_cost_usd` | 0.081 | 0.099 | +22% |

- 보고는 작업 도구(Write, Bash)와 같은 응답에 실려 요청이 늘지 않았습니다.
- 늘어난 비용은 요청마다 들어가는 도구 설명, 첫 프롬프트의 규칙 한 번, 보고 내용(출력)과 그 내용을 이후 요청이 다시 읽는 몫입니다.
- 작은 작업이라 비율이 크게 보입니다. 긴 작업에서의 비율은 재지 않았습니다.
- `total_cost_usd` 는 API 가격으로 환산한 추정치이고 실제 청구액이 아닙니다.

끄려면 플러그인을 끕니다. 규칙만 또는 도구만 끄는 설정은 없습니다. 규칙 없이 도구만 있으면 거의 부르지 않고, 도구 없이 규칙만 있으면 쓸모가 없기 때문입니다.

```bash
claude plugin disable work-plan@devflow-mods
```

## 알아둘 것

- 보고는 모델이 합니다. 2026-10-16 시험(Opus 5.5, 대화형)에서 15초짜리 3단계 작업은 10번 중 5번 보고했습니다. 4단계 작업과 질문으로 멈추는 작업은 3번 모두 보고했습니다. 보고하지 않은 작업은 경로선이 비어 있습니다.
- 모델이 질문 없이 중간에 멈추면 team-board는 남은 단계를 완료로 그립니다. team-board가 질문으로 알아보지 못한 답(예: `?` 뒤에 문장이 더 붙은 줄)도 같습니다.
- 끝난 계획은 다음 계획 보고나 `/clear` 전까지 경로선에 남습니다. 계획 없이 하는 다음 요청에서도 이전 작업의 `●━●━◎` 가 보입니다. 할 일 도구로 만든 할 일과 같은 동작입니다.
- Claude Code 2.1.301 에서 시험했습니다. 그보다 낮은 버전에서는 확인하지 않았습니다.
- `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` 로 할 일 도구도 켜 두면 둘 다 경로선을 씁니다. 나중에 쓴 쪽이 보입니다.

### 조직이 관리하는 Claude Code (Team, Enterprise)

- 관리자가 `allowManagedModsOnly` 를 켰으면 사용자가 설치한 mod는 돌지 않습니다. 이 mod와 team-board 모두 그렇습니다. 이때는 관리자가 디렉터리 marketplace와 managed `enabledPlugins` 로 배포해야 합니다.
- 조직 관리 환경에서는 사용자가 설치한 mod의 compaction hook(`session.compact`)이 돌지 않습니다(`claude plugin validate` 경고). 그래서 compaction 뒤 규칙과 계획을 다시 붙이지 않습니다. 도구 설명은 계속 들어갑니다.
- 규칙은 system prompt가 아니라 첫 프롬프트 문맥(`prompt.submit`)으로 붙입니다. 조직 관리 환경에서는 사용자 mod가 system prompt를 바꾸지 못하기 때문입니다. 실제 Enterprise 환경에서는 아직 확인하지 않았습니다.

## 개발

```bash
claude plugin validate ./work-plan
claude plugin test ./work-plan
```

- 계획 모양(`WorkPlan`)은 `types/index.d.ts` 에 있습니다. team-board가 같은 선언을 복사해 읽습니다. 모양을 바꾸면 `v` 를 올리고 team-board도 함께 고치세요.
