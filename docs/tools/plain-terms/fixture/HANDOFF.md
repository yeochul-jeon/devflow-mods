# Handoff (order-svc)

## 현재 상태
- T5 끝남: `retrieveEmpDc` 호출부 정리 (`:908` 한 곳만 남음).
- T6 진행 중: `mr_gate` 가 통합 브랜치에서 빈 출력을 냄. `count_docs` 는 rc 0.
- T7 막힘: `src/order.ts` 의 `placeOrder()` 가 `hpNo` 를 DTO 에 넣기만 하고 조회 단계에서 쓰지 않음. D24 결정 대기.
- T8, T9 시작 전.

## 결정 대기
- D24: `hpNo` 를 조회 키로 쓸지 (P3 절차 영향)
- D25: `scanGen` 초기화 시점을 배포 전/후 중 어디로
- D30: `dockColumns` 기본값 80 유지 여부
- Q2: 11-11 배포와 승인 상태가 맞는지
- Q5: E1 결과를 기다릴지

## 용어
- P3: 배포 전 고객 조회 절차서 (운영팀 승인 필요)
- E1: Enterprise 계정에서 설치 확인하는 시험
- VF2: 문서 2차 검수

## 남은 일
1. T7 고치기 (D24 답 뒤)
2. T8: `mr_gate` 수정 후 `count_docs` 다시 돌리기
3. T9: P3 절차서 갱신, VF2 재검수
