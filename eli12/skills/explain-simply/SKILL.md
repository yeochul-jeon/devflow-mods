---
name: explain-simply
user-invocable: false
description: Explain hard, new, or multi-part concepts so a 12-year-old could follow — one everyday analogy plus one text diagram — but only for the parts that need it. Use when introducing an unfamiliar concept, architecture, or flow, or when the user says "쉽게", "12살", "직관적으로", "그림으로", "ELI5/ELI12". Do not use for routine code edits, short factual answers, or things the user already clearly knows.
---

# 필요한 부분만 쉽게 설명하기

## 언제 쓰나
다음 중 하나일 때만 적용한다. 해당 없으면 평소처럼 간결하게 답한다.
- 사용자가 처음 보는 개념, 또는 3개 이상의 요소가 서로 얽힌 흐름/구조를 설명할 때
- 사용자가 "쉽게", "12살", "직관적으로", "그림으로" 같은 표현을 썼을 때
- 같은 내용을 두 번 이상 다시 묻거나 헷갈려 할 때

전체 답변을 쉽게 만들지 말고, **어려운 부분 하나만** 골라 쉽게 만든다.
코드 수정, 짧은 사실 답변, 사용자가 이미 아는 내용에는 쓰지 않는다.

## 형식 (해당 부분에만)
1. **한 줄 요약**: 20자 안팎.
2. **일상 비유 하나**: 학교, 게임, 택배, 식당처럼 12살이 겪는 장면. 비유가 어디서 깨지는지도 한 줄로 밝힌다.
3. **텍스트 그림 하나**: 터미널에서는 Mermaid가 그림으로 보이지 않으므로 상자와 화살표로 그린다.

```
┌────────┐   주문   ┌────────┐   요리   ┌────────┐
│  손님  │ ───────→ │  주방  │ ───────→ │  배달  │
└────────┘          └────────┘          └────────┘
```

   - 상자 4개, 줄 12개 이내. 한 줄은 한글 기준 30자 이내.
   - 그림이 글보다 나을 때만 넣는다 (흐름, 구조, 포함 관계). 정의 하나에는 넣지 않는다.
4. **정확한 버전으로 돌아오기**: 비유 뒤에 실제 용어로 한두 문장 다시 연결한다.

## 지킬 것
- 전문 용어는 처음 나올 때 괄호로 쉽게 풀어준다.
- 비유 때문에 사실을 틀리게 말하지 않는다.
- 사용자가 전문가라는 맥락이 있으면 기술적 정확성은 유지하고, 비유는 보조로만 쓴다.

## 사용자가 더 원할 때
답변이 이미 끝났는데 더 쉬운 버전이 필요하면 `/eli12 [어려운 부분]` 명령을 안내한다.
이 명령은 직전 답변을 옆 패널에 12살 버전으로 다시 설명해 준다 (eli12 플러그인의 mod).
