---
name: write-unambiguous
user-invocable: false
description: Write steps, instructions, and decision items so the reader cannot misread them — a style about 80% of the way to ASD-STE100 (Simplified Technical English), adapted to Korean. Use when the reader will act on the text (procedures, runbooks, handoff to-dos, commands to run, choices to decide), or when the user says "STE", "ASD-STE100", "절차로", "순서대로", "오해 없게", "그대로 따라 할 수 있게". Do not use for routine code edits, short factual answers, or "쉽게/12살" requests (that is explain-simply).
---

# 오해 없는 글 (ASD-STE100 에서 착안, 80%)

## 언제 쓰나
다음 중 하나일 때만 적용한다. 해당 없으면 평소처럼 답한다.
- 읽는 사람이 글을 보고 그대로 실행하거나 결정할 때: 절차, 런북, 인계할 일, 사용자가 칠 명령, 결정 항목
- 사용자가 "STE", "ASD-STE100", "절차로", "순서대로", "오해 없게" 같은 말을 썼을 때

전체 답변이 아니라 **실행·결정에 쓰일 부분**에만 적용한다.
코드 수정, 짧은 사실 답변에는 쓰지 않는다.
사용자가 "쉽게", "12살" 을 말하면 이 규칙 대신 비유를 쓰는 `explain-simply` 를 따른다. 한 부분에 두 규칙을 함께 쓰지 않는다.

## 지킬 것
- 한 문장에는 지시나 사실 하나만 쓴다. 동시에 해야 하는 행동만 예외다.
  지시 두 개를 "-고", "-말고", "-한 뒤" 로 잇지 않는다. "멈추고 담당 팀에 연락하세요" 대신 "멈추세요. 담당 팀에 연락하세요."
- 능동태로 쓴다. 누가 무엇을 하는지 보이게 쓴다.
- 조건이 있으면 문장 앞에 쓴다. "X 이면 Y 하세요."
- 같은 대상은 끝까지 같은 이름으로 부른다. 동의어로 바꾸지 않는다.
- 명사를 3개 넘게 잇지 않는다. "설정 변경 요청 처리" 대신 "설정을 바꾸는 요청을 처리합니다".
- 단계나 항목이 3개 이상이면 번호 붙은 세로 목록으로 쓴다.
- 전문용어·식별자·명령은 원문 그대로 쓴다. 명령은 코드 블록에 넣는다.
- 비유·꾸밈말·감탄·수사 의문문은 쓰지 않는다.
- 한 문장은 25어절 이내로 쓴다.

## 풀어 줄 것 (나머지 20%)
- ASD-STE100 승인 어휘 사전은 쓰지 않는다. 보통의 기술 어휘를 쓴다.
- 단계 뒤에 짧은 이유 한 문장을 붙여도 된다.

## 정확성
쉬운 문장이 사실을 틀리게 말할 수 있다. 명료함과 정확성은 따로 확인한다.
- 원문의 수치·조건·예외를 지우지 않는다.
- 원문에 없는 사실을 더하지 않는다.

## 예시
```
전: 필요한 설정 변경 후 시스템 재시작을 진행해주세요.
후: 자동 저장이 꺼져 있으면 켜세요. 설정을 저장하세요. 프로그램을 다시 시작하세요.
```

## 이름 붙이기
이 글을 "ASD-STE100 준수" 라고 부르지 않는다. 규격 원문과 대조하지 않은 규칙이다. 필요하면 "ASD-STE100 에서 착안한 80% 문체" 라고 쓴다.
