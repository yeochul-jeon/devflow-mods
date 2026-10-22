# 촬영용 가짜 동료 세션 기록을 쓴다. 사용: peers.py <dir> <scenario: hud|eight|five|many|ask|agents|flow|bars|ended|none(지우기만)>
import json, os, sys, time, glob
d, sc = sys.argv[1], sys.argv[2]
for f in glob.glob(os.path.join(d, 'peer-*.json')):
    os.remove(f)
now = int(time.time() * 1000)
cwd = '/repo/order-svc'
def t(*st):
    names = ['느린 쿼리 찾기', '조회 결과 캐시 붙이기', '캐시 무효화', '부하 테스트', '문서 정리', '배포 확인']
    return [{'id': str(i + 1), 'subject': names[i] if i < len(names) else f'할 일 {i + 1}', 'status': s} for i, s in enumerate(st)]
def put(id, name, **kw):
    b = {'id': 'peer-' + id, 'name': name, 'cwd': cwd, 'state': 'idle', 'step': '', 'prompt': '', 'last': '', 'question': '',
         'contextPct': 20, 'tasks': [], 'decisions': [], 'timeline': [], 'edits': 0, 'files': [], 'fail': None,
         'cacheAt': now - 5 * 60_000, 'updatedAt': now}
    b.update(kw)
    json.dump(b, open(os.path.join(d, b['id'] + '.json'), 'w'), ensure_ascii=False)
fail = {'at': now, 'command': './gradlew test 2>&1 | tail -20', 'key': './gradlew test', 'level': 'high',
        'signs': ['12 tests completed, 1 failed'], 'masks': []}
if False:
    pass
elif sc == 'hud':
    put('2', 'sub-2', state='asking', question='캐시 만료를 5분으로 할까요, 1시간으로 할까요?', tasks=t('completed', 'in_progress', 'pending', 'pending'))
    put('a', 'api-fix', state='working', step='Bash ./gradlew test --tests Order')
    put('3', 'sub-3', tasks=t('completed', 'completed', 'completed', 'completed'), last='PR38 래퍼 수정 완료',
        timeline=[{'at': now - 260_000, 'kind': 'prompt', 'text': 'PR38 래퍼 수정'}, {'at': now - 20_000, 'kind': 'done', 'text': '끝'}])
    put('4', 'sub-4', cacheAt=now - 52 * 60_000, last='JOIN 감시 규칙 정리')
elif sc == 'eight':
    put('3', 'sub-3', state='asking', question='캐시 만료를 5분으로 할까요, 1시간으로 할까요?')
    put('2', 'sub-2', fail=fail)
    put('4', 'sub-4', state='working', step='Edit OrderController.java')
    put('5', 'sub-5', cacheAt=now - 52 * 60_000, last='JOIN 감시 규칙 정리')
    put('6', 'sub-6', last='PR38 래퍼 수정 완료')
    put('7', 'sub-7', last='문서 링크 확인')
    put('8', 'sub-8', updatedAt=now - 6 * 60_000, last='로그 확인')
elif sc == 'five':
    for i in range(1, 5):
        put(str(i), f'sub-ars{i}')
elif sc == 'many':
    for i in range(1, 30):
        put(f'{i:02d}', f'sub-{i:02d}')
elif sc == 'ask':
    put('2', 'sub-2', state='asking', question='캐시 만료를 5분으로 할까요, 1시간으로 할까요?', prompt='주문 조회 캐시 정리',
        tasks=t('completed', 'in_progress', 'pending'))
elif sc == 'agents':
    ag = lambda id, desc, st, tool='', tok=0, ago=40: {'id': id, 'desc': desc, 'type': 'Explore', 'model': 'claude-haiku-5-5', 'status': st,
        'tool': tool, 'startedAt': now - ago * 1000, 'endedAt': None if st == 'working' else now - 5_000, 'tokens': tok}
    put('a', 'api-fix', last='조사 맡겨 둠', agents=[ag('a1', '주문 API 호출처 찾기', 'working', 'Grep', 0, 95),
        ag('a2', '캐시 설정 위치 찾기', 'done', '', 21_400, 70)])
    put('3', 'sub-3', last='PR38 래퍼 수정 완료')
    put('2', 'sub-2', state='asking', question='캐시 만료를 5분으로 할까요, 1시간으로 할까요?')
elif sc == 'bars':
    # 진행 막대 상태 4종: 작업 · 결정 대기 · 멈춤(중단된 계획) · 끝남
    sub = ['느린 쿼리 찾기', '조회 결과 캐시 붙이기', '캐시 무효화', '부하 테스트']
    plan = lambda *st: [{'id': str(i + 1), 'subject': x, 'status': s} for i, (x, s) in enumerate(zip(sub, st))]
    put('a', 'api-fix', state='working', step='할 일: 조회 결과 캐시 붙이기', tasks=plan('completed', 'in_progress', 'pending', 'pending'))
    put('2', 'sub-2', state='asking', question='캐시 만료를 5분으로 할까요, 1시간으로 할까요?', tasks=plan('completed', 'completed', 'in_progress', 'pending'))
    put('3', 'sub-3', last='중단됨', planEnded=True, tasks=plan('completed', 'completed', 'in_progress', 'pending'))
    put('4', 'sub-4', last='부하 테스트까지 마쳤습니다.', tasks=plan('completed', 'completed', 'completed', 'completed'),
        timeline=[{'at': now - 200_000, 'kind': 'prompt', 'text': '주문 조회 캐시'}, {'at': now - 8_000, 'kind': 'done', 'text': '끝'}])
elif sc == 'ended':
    # 끝난 계획 두 가지: 진행 중 단계가 남은 것, 단계를 끝내고 다음을 시작하기 전에 중단된 것 (둘 다 멈춤)
    sub = ['느린 쿼리 찾기', '조회 결과 캐시 붙이기', '캐시 무효화', '부하 테스트']
    plan = lambda *st: [{'id': str(i + 1), 'subject': x, 'status': s} for i, (x, s) in enumerate(zip(sub, st))]
    put('3', 'sub-3', last='중단됨', planEnded=True, tasks=plan('completed', 'completed', 'in_progress', 'pending'))
    put('5', 'sub-5', last='중단됨', planEnded=True, tasks=plan('completed', 'pending', 'pending', 'pending'))
elif sc == 'flow':
    m = lambda s: now - s * 60_000
    sub = ['느린 쿼리 찾기', '조회 결과 캐시 붙이기', '주문 수정 때 캐시 무효화', '부하 테스트']
    # 단계별 시간 (0.26.0): 끝난 단계에 doneAt, 계획 첫 보고 planStartAt
    done_at = [m(27) + 12_000, m(20) - 30_000, None, None]
    put('3', 'sub-3', state='working', step='할 일: 주문 수정 때 캐시 무효화', planStartAt=m(31), tasks=[{'id': str(i + 1), 'subject': x, 'status': st, **({'doneAt': d} if d else {})} for i, (x, st, d) in
        enumerate(zip(sub, ['completed', 'completed', 'in_progress', 'pending'], done_at))], last='주문 조회 테스트 통과', edits=4,
        files=['src/order/OrderService.java', 'src/order/OrderCache.java'],
        decisions=[{'at': m(20), 'question': '캐시 만료를 5분으로 할까요, 1시간으로 할까요?', 'answer': '5분으로 해 주세요'}],
        timeline=[{'at': m(32), 'kind': 'prompt', 'text': '주문 조회가 느려요. 캐시를 붙여 주세요'},
                  {'at': m(21), 'kind': 'ask', 'text': '캐시 만료를 5분으로 할까요, 1시간으로 할까요?'},
                  {'at': m(20), 'kind': 'decide', 'text': '캐시 만료를 5분으로 할까요, 1시간으로 할까요? → 5분으로 해 주세요'},
                  {'at': m(20), 'kind': 'prompt', 'text': '5분으로 해 주세요'},
                  {'at': m(9), 'kind': 'done', 'text': '주문 조회에 5분 캐시를 붙였고 테스트가 통과했습니다.'},
                  {'at': m(3), 'kind': 'prompt', 'text': '캐시 무효화도 주문 수정 때 하게 해 줘'}])
