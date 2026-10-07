# team-board

같은 저장소(워크트리 포함)에서 돌고 있는 여러 Claude Code 세션의 팀 상황판입니다.

- 입력창 위 **팀 창**: 세션마다 지금 상태, 할 일 경로선, 결정 대기 질문, 숨은 실패
- `/board` 패널: 세션별 요청·진행·결정 기록, 결정 대기 항목의 12살 버전 설명
- **숨은 실패 감지**: exit 0 인데 실패한 빌드·테스트를 Claude 와 모든 탭에 알림
- 결정 대기 음성 알림 (macOS)

설치, 명령, 화면 설명은 [저장소 README](../README.md#team-board-사용), 바뀐 점은 [CHANGELOG](../CHANGELOG.md) 를 보세요.

```bash
claude plugin marketplace add yeochul-jeon/yeocheol-mods
claude plugin install team-board@yeocheol-mods
```
