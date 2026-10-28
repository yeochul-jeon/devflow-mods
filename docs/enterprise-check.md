# Team·Enterprise 기기 점검 (E1)

회사가 관리하는 Claude Code(Team·Enterprise 로그인, managed settings)에서 team-board 와 work-plan 이 도는지 확인하는 절차입니다. 이 저장소의 개발 기기는 조직 관리 환경이 아니라서 직접 확인하지 못했습니다.

## 점검 5단계

1. 두 mod 를 설치하세요.
   ```bash
   claude plugin marketplace add 'yeochul-jeon/devflow-mods#stable' && claude plugin install team-board@devflow-mods && claude plugin install work-plan@devflow-mods
   ```
   `1 userConfig option not yet set` 줄이 나와도 정상입니다. 설정하지 않아도 됩니다.
2. 빈 폴더에서 디버그 로그를 켜고 Claude Code 를 시작하세요.
   ```bash
   mkdir -p ~/e1 && cd ~/e1 && claude --debug-file ~/e1/debug.txt
   ```
   폴더를 믿는지 묻는 화면이 나오면 `Yes, I trust this folder` 를 고르세요.
3. 아래 요청을 보내세요. 파일 쓰기나 명령 실행 권한을 물으면 허용하세요.
   ```
   math.py 에 add 함수를 만들고, test_math.py 에 테스트를 쓰고, 테스트를 실행해 줘
   ```
   작업하는 동안 입력창 위의 띠에 진행 막대(`▏ <단계 이름> ╌╌│╌╌ 0%`)가 보이는지 보세요. 작업이 끝나면 막대가 `✓ <걸린 시간> 100%` 로 바뀝니다. 작업이 끝나면 `/board` 를 입력하세요. 화면을 1장 캡처하세요.
4. `/exit` 로 Claude Code 를 끝내세요. 아래 명령을 실행하세요.
   ```bash
   grep -E "team-board|work-plan" ~/e1/debug.txt | grep -i -E "loaded \(|plugin\.register|visible after|/board listed|refus|denied|block|error|not run"
   ```
5. 결과 3가지를 보내 주세요: 3단계의 캡처, 4단계의 출력, `claude --version` 의 출력.

`~/e1` 폴더는 점검이 끝나면 지워도 됩니다.

## 결과 읽기

정상이면 4단계 출력은 아래 6줄과 같은 모양입니다(시각·번호는 다릅니다). team-board 줄에 `user` 대신 `prepend` 가 찍혀도 정상입니다.

```
hooks module team-board@devflow-mods loaded (worker, ..., tier user); events: ...
hooks module work-plan@devflow-mods loaded (worker, ..., tier user); events: ...
plugin.register: team-board (user, team-board@devflow-mods), judged by ...: admitted
plugin.register: work-plan (user, work-plan@devflow-mods), judged by ...: admitted
$.tool.register (work-plan): mcp__work-plan__plan_update visible after ...ms
$.command.register (team-board): /board listed
```

- `admitted` 가 아니면 조직이 사용자 mod 를 막은 것입니다(예: 관리자의 `allowManagedModsOnly`). 이때는 관리자가 managed `enabledPlugins` 로 배포해야 합니다.
- `refus`·`denied`·`block`·`error`·`not run` 이 들어간 줄이 있으면 그 줄을 그대로 보내 주세요.
- 띠에 진행 막대가 없는데 6줄이 모두 정상이면, 모델이 `plan_update` 를 부르지 않은 것일 수 있습니다. 작은 작업에서는 부르지 않을 때가 있습니다. 같은 요청을 한 번 더 보내 보세요.

## 알려진 제약 (확인할 필요 없음)

- 조직 관리 환경에서는 사용자 mod 의 `session.compact` hook 이 돌지 않습니다(`claude plugin validate` 경고). 그래서 compaction 뒤 work-plan 이 규칙과 계획을 다시 붙이지 않습니다.
- 사용자 설정의 `prependPlugins` 는 무시됩니다. 다른 mod 가 띠를 가리면 team-board 띠가 안 보일 수 있습니다.
