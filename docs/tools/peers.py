# 촬영용 가짜 동료 세션 기록을 쓴다. 사용: peers.py <dir> <scenario: hud|eight|five|many|none(지우기만)>
import json, os, sys, time, glob
d, sc = sys.argv[1], sys.argv[2]
for f in glob.glob(os.path.join(d, 'peer-*.json')):
    os.remove(f)
now = int(time.time() * 1000)
cwd = '/repo/order-svc'
def t(*st):
    return [{'id': str(i + 1), 'subject': f'할 일 {i + 1}', 'status': s} for i, s in enumerate(st)]
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
    put('3', 'sub-3', tasks=t('completed', 'completed', 'pending', 'pending'), last='PR38 래퍼 수정 완료')
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
