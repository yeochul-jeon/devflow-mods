# work-plan

Claude가 여러 단계 작업의 계획과 진행을 `plan_update` 도구로 보고하게 합니다. 화면 표시는 [team-board](../team-board/README.md)가 합니다. team-board의 진행 막대와 지금 단계 줄(`2/5 테스트 실행…`)이 이 보고로 채워집니다.

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
- 규칙: 대화의 첫 프롬프트에 한 번 붙입니다. 내용은 "작업 도구를 두 번 이상 쓰는 턴이면 계획을 보고한다. 한 응답에 몰아 보내도 보고한다. 작업 도구와 같은 응답에 보낸다. 마지막 done 은 보내지 않아도 된다." 입니다. `/clear` 뒤와 compaction 뒤 첫 프롬프트에 다시 붙입니다. compaction 뒤에는 압축 전 계획 목록도 함께 붙입니다.
- 갱신 알림 (0.3.0): 계획이 열린 동안 마지막 `plan_update` 뒤 작업 도구(Edit, Write, NotebookEdit, Bash)를 5번 쓰면, 5번째 도구 결과 뒤에 한 줄을 붙입니다: `work-plan: 5 work calls since your last plan_update. If a step finished, send plan_update (that step done, the next doing) with your next work tool call.` 모델만 보고 화면에는 나오지 않습니다. 보고가 오거나 계획이 끝나면 다시 0부터 셉니다. 서브에이전트 호출과 거부된 호출은 세지 않습니다. 요청은 늘지 않습니다.
  - 이유: 2026-10-21 대화 기록에서 보고가 있는 턴 38개 중 30개가 턴 시작에 한 번만 보고해, 작업 도구를 18~40번 쓰는 동안 진행 표시가 첫 단계에 머물렀습니다.
  - 규칙 문구에 "단계가 끝나면 다시 보고"를 넣는 안도 쟀습니다(`claude -p`, 작업 도구 11~13번인 작업 3회씩). 보고는 평균 3 → 4.3번으로 늘었지만 요청이 2~3번, 비용이 약 15% 늘어 넣지 않았습니다. 알림은 보고가 잘 오는 턴에는 붙지 않아 비용이 들지 않습니다(같은 측정에서 한 번도 붙지 않음).
  - 알림이 모델에 닿는 것은 확인했습니다(echo 6번 시험에서 모델이 5번째 뒤 알림 원문을 인용). 실제 세션에서 보고가 얼마나 늘었는지는 아직 재지 않았습니다.
- 첫 보고 알림 (0.4.0): 한 턴에서 계획 보고 없이 작업 도구를 3번 쓰면, 3번째 도구 결과 뒤에 한 번만 한 줄을 붙입니다: `work-plan: 3 work calls in this turn and no plan_update yet. If this task has two or more steps, send plan_update with your next work tool call.` 이 턴에 보고한 계획이 모두 끝난 뒤의 호출은 세지 않습니다. 실제 세션에서 조사 Bash 6번(47초) 뒤에야 첫 보고가 와 그동안 진행 표시가 비었던 것을 고치려는 것입니다.
- 턴이 끝나면 끝났다는 표시만 남깁니다. team-board는 답으로 끝난 턴이면 질문으로 끝났어도 남은 단계를 완료로 그립니다. 중단·오류로 끝난 턴은 보고된 그대로 둡니다.
- 서브에이전트의 보고는 받기만 하고 저장하지 않습니다. 메인 세션의 경로선을 바꾸지 않습니다.
- 계획은 세션 안(`$.state`)에만 둡니다. 다른 세션에는 team-board가 자기 상태 파일로 전합니다.

## 비용과 끄기

2026-10-16 측정 (Opus 5.5, `claude -p`, 다른 mod 없이 2회씩):

| | work-plan 없음 | work-plan | 차이 |
| --- | --- | --- | --- |
| 요청마다 입력 (도구 설명) | 16,720 | 17,277 | +557 토큰 |
| 3단계 작업의 요청 수 | 3, 3 | 3, 3 | 0 |
| 3단계 작업의 입력 합계 | 52.3k | 55.1k | +2.8k |
| 3단계 작업의 출력 | 728 | 1,251 | +523 |
| 3단계 작업 `total_cost_usd` | 0.081 | 0.099 | +22% |

- 0.1.1 의 문구로 요청마다 입력이 46 토큰 늘었습니다(같은 조건에서 0.1.0 은 17,231). 표의 나머지 값은 0.1.0 측정입니다.
- 보고는 작업 도구(Write, Bash)와 같은 응답에 실려 요청이 늘지 않았습니다.
- 늘어난 비용은 요청마다 들어가는 도구 설명, 첫 프롬프트의 규칙 한 번, 보고 내용(출력)과 그 내용을 이후 요청이 다시 읽는 몫입니다.
- 작은 작업이라 비율이 크게 보입니다. 긴 작업에서의 비율은 재지 않았습니다.
- `total_cost_usd` 는 API 가격으로 환산한 추정치이고 실제 청구액이 아닙니다.

끄려면 플러그인을 끕니다. 규칙만 또는 도구만 끄는 설정은 없습니다. 규칙 없이 도구만 있으면 거의 부르지 않고, 도구 없이 규칙만 있으면 쓸모가 없기 때문입니다.

```bash
claude plugin disable work-plan@devflow-mods
```

## 계획 전 수정 막기 (`planGate`, 기본 꺼짐)

켜면 Claude가 한 턴에서 `plan_update` 로 계획을 보고하기 전에는 파일을 바꾸는 도구(Edit, Write, NotebookEdit)를 거부합니다. 계획 없이 바로 고치기 시작하는 것을 막으려고 만들었습니다.

```bash
claude plugin configure work-plan@devflow-mods      # 또는 /plugin → Installed → work-plan → Configure
```

- 한 턴은 사용자가 보낸 요청 하나입니다. 턴마다 새로 보고해야 합니다. 한 줄 수정도 보고가 필요합니다.
- 같은 응답 안에서는 `plan_update` 가 수정보다 앞에 있어야 합니다. 엔진은 응답이 다 오기 전에 도구를 차례로 실행합니다.
- 한 턴에 3번 거부하면 그 턴의 나머지는 막지 않습니다. 도구를 부르지 못하는 환경에서 작업이 멈추지 않게 하려는 것입니다.
- 서브에이전트, Bash, 읽기 도구는 막지 않습니다. Bash는 조사·테스트에 많이 쓰여 막으면 거부가 너무 잦습니다.
- 켜면 첫 프롬프트 규칙에 이 게이트를 알리는 한 줄을 더합니다. 꺼 두면 hook을 달지 않아 0.1.1과 같습니다.
- 게이트가 아는 것은 "Claude가 계획을 보고했나" 뿐입니다. 사람이 그 계획을 승인했는지는 모릅니다.

2026-10-18 측정 (Opus 5.5, `claude -p`, 다른 mod 없이):

| | 꺼짐 | 켜짐 |
| --- | --- | --- |
| 첫 요청 입력 | 17,402 (0.1.1 과 같음) / 17,450 | 17,528 |
| 3단계 작업의 요청 수 | 3 | 3, 2 |
| 거부 횟수 (3단계 작업 2회, 한 줄 수정 2회) | - | 0 |

- 꺼짐 첫 줄의 17,402 는 짧은 질문, 17,450 은 3단계 작업 프롬프트입니다.
- 켜 두면 Claude가 규칙 줄을 보고 먼저 보고해서 거부가 나지 않았습니다. 한 줄 수정도 1단계 계획을 수정과 같은 응답에 보냈습니다.
- 거부를 받은 경우는 개발 중 이전 판정 방식에서 난 2회뿐입니다. 그때 Claude는 `plan_update` 를 다시 보내고 같은 수정을 다시 해서 작업을 마쳤습니다. 지금 판정 방식의 거부문과 3번 뒤 풀림은 테스트로만 확인했습니다.

## 알아둘 것

- 보고는 모델이 합니다. 2026-10-16 시험(Opus 5.5, 대화형, effort medium)에서 15초짜리 3단계 작업은 0.1.1 문구로 10번 모두 보고했습니다(0.1.0 문구는 10번 중 6번). 4단계 작업과 질문으로 멈추는 작업은 3번 모두 보고했습니다. 보고하지 않은 작업은 경로선이 비어 있습니다.
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
