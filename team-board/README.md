# team-board

같은 저장소(워크트리 포함)에서 돌고 있는 여러 Claude Code 세션의 팀 상황판입니다.

- 입력창 위 **팀 창**: 세션마다 지금 상태, 진행 막대(채움 끝에 지금 단계 이름과 %), 결정 대기 질문, 숨은 실패
- 턴이 도는 동안 입력창 바로 위 줄(`✻ Sauteing…`)이 지금 단계 `2/5 테스트 실행…` 로 바뀝니다
- `/board` 패널: 세션별 요청·진행·결정 기록, 결정 대기 항목의 12살 버전·ASD-STE100 기준 설명 (탭, "왜 지금" 한 줄과 질문 직전 대화 반영), HTML 페이지 요청
- **숨은 실패 감지**: exit 0 인데 실패한 빌드·테스트를 Claude 와 모든 탭에 알림
- **보조 에이전트**: 세션이 띄운 서브에이전트가 몇 개 돌고 끝났는지, 지금 쓰는 도구와 토큰(끝난 뒤 엔진이 센 수). `/board` 카드에는 진행 막대 아래 보조마다 한 줄(설명·모델·지금 도구·시간). 턴이 끝나도 보조가 돌면 `대기` 대신 `보조` 로 표시 (토큰 추가 없음)
- 결정 대기 알림: chime 은 macOS·Windows·Linux(paplay 또는 aplay), 음성은 macOS
- [work-plan](../work-plan/README.md)을 함께 설치하면 Claude의 계획 보고로 진행 막대를 채웁니다 (할 일 도구가 없는 새 모델용)

설치와 주요 명령은 [저장소 README](../README.md#-team-board-팀-상황판), 세부 내용은 [docs/team-board.md](../docs/team-board.md), 바뀐 점은 [CHANGELOG](../CHANGELOG.md) 를 보세요.

```bash
claude plugin marketplace add yeochul-jeon/devflow-mods
claude plugin install team-board@devflow-mods
```
