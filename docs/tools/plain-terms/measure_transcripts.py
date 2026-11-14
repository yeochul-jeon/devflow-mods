# work-plan·plain-terms 의 비용·효과를 실제 대화 기록(~/.claude/projects/*/*.jsonl)에서 잰다. 모델 호출 없음.
# 사용: python3 -I measure_transcripts.py <files.txt> [--colon] [--label N] [--only SUBSTR]
#   files.txt: 볼 기록 파일 경로를 한 줄에 하나 (임시·시험 폴더는 미리 뺀다)
#   --colon: 「- F4: 설명」 꼴 목록식 정의도 풀이로 센다. --label N: 판정한 용어 N개를 문맥과 함께 찍는다 (손 확인용)
# 풀이 판정은 정규식이라 대략값이다: 2026-11-15 표본 40개에서 풀이가 필요 없는 낱말 약 8개, 놓친 풀이 2~3개.
# 턴: 사용자 프롬프트 행에서 시작해 system turn_duration/stop_hook_summary 에서 끝난다 (없으면 다음 프롬프트).
# 규칙·알림: attachment.type == hook_additional_context 행만 센다 (도구 결과에 찍힌 같은 문구는 코드 출력이라 뺀다).
import json, re, sys, collections, random

COMMON = set('API JSON HTML CSS CLI UI URL PR OK README HANDOFF CHANGELOG MD TODO ID IDS PDF PNG SVG HTTP HTTPS SQL AI LLM GPT CPU OS UTF KST UTC AM PM VS ASCII YAML XML TS JS NPM GH MIT DB EOF CI QA MR IP HEAD NPE INFO'.split())
WORK = {'Edit', 'Write', 'NotebookEdit', 'Bash'}
PLAN = 'mcp__work-plan__plan_update'
NUDGES = {'after-update': 'work calls since your last plan_update', 'first': 'no plan_update yet'}

TERM = re.compile(r'(?<![\w/.-])([A-Z][A-Z0-9]{1,5}|[A-Z]\d{1,3}[a-z]?|[a-z]+[A-Z][A-Za-z0-9]*|[a-z][a-z0-9]*_[a-z0-9_]+)(?![\w/-])(?!\.\w)')
FENCE = re.compile(r'```.*?```', re.S)
INLINE = re.compile(r'`([^`\n]+)`')
COLON = '--colon' in sys.argv
GLOSS_AFTER = re.compile(r'[*`_]*\s?[(（]')
DEF_AFTER = re.compile(r'[*`_]*\s?[:：]\s*\S')  # 「- F4: 설명」 꼴 정의 줄


def kind(t):
    if re.fullmatch(r'[A-Z]{1,2}\d{1,3}[a-z]?', t):
        return 'id'
    if t[0].islower():
        return 'code'
    return 'abbr'


def occurrences(text):
    """(start, end, term) 목록. 코드 블록은 뺀다. 인라인 코드는 내용 전체가 용어일 때만 (닫는 ` 까지가 end)."""
    text = FENCE.sub(lambda m: ' ' * len(m.group(0)), text)
    spans = [(m.start(), m.end(), m.group(1)) for m in INLINE.finditer(text)]
    out = [(s, e, b) for s, e, b in spans if TERM.fullmatch(b)]
    for m in TERM.finditer(text):
        if not any(s <= m.start() < e for s, e, _ in spans):
            out.append((m.start(), m.end(), m.group(1)))
    out.sort()
    return text, out


def terms(text):
    """답 하나의 용어별 (kind, 풀이 여부, 문맥). 한 번이라도 풀이가 붙으면 풀이로 본다."""
    text, occ = occurrences(text)
    res = collections.OrderedDict()
    for s, e, t in occ:
        if t in COMMON or (kind(t) == 'abbr' and sum(c.isupper() for c in t) < 2):
            continue
        g = bool(GLOSS_AFTER.match(text[e:e + 5])) or (text[max(0, s - 1):s] in '(（' and text[e:e + 1] in ')）')
        if COLON:
            g = g or bool(DEF_AFTER.match(text[e:e + 6]))
        if t not in res:
            res[t] = [kind(t), g, text[max(0, s - 20):e + 25].replace('\n', ' ')]
        elif g and not res[t][1]:
            res[t][1] = True
            res[t][2] = text[max(0, s - 20):e + 25].replace('\n', ' ')
    return [(t, k, g, ctx) for t, (k, g, ctx) in res.items()]


def is_prompt(o):
    if o.get('type') != 'user' or o.get('isMeta') or o.get('isSidechain'):
        return False
    c = (o.get('message') or {}).get('content')
    if isinstance(c, str):
        return not c.lstrip().startswith(('<local-command-stdout', '<local-command-caveat', '<local-command-stderr'))
    if isinstance(c, list):
        return any(b.get('type') == 'text' for b in c) and not any(b.get('type') == 'tool_result' for b in c)
    return False


def hac_text(o):
    a = o.get('attachment')
    if o.get('type') == 'attachment' and isinstance(a, dict) and a.get('type') == 'hook_additional_context':
        return json.dumps(a.get('content'), ensure_ascii=False)
    return None


class Stat:
    def __init__(self):
        self.bucket = collections.defaultdict(lambda: [0, 0, 0])
        self.final = collections.defaultdict(lambda: [0, 0])
        self.kind = collections.defaultdict(lambda: [0, 0])
        self.first_sess = collections.defaultdict(lambda: [0, 0])
        self.c = collections.Counter()


def bucket_of(s):
    if s is None:
        return 'none'
    return '1' if s == 0 else '2-5' if s < 5 else '6-20' if s < 20 else '21-50' if s < 50 else '51+'


def process(f, st, labels):
    rows = []
    for l in open(f):
        try:
            rows.append(json.loads(l))
        except Exception:
            pass
    turns = []  # dict(text_all, text_final, since, work, plan, first_ok, wp)
    since = None
    wp_on = False
    pt_on = False
    turn = None
    last_msg = {}  # message.id -> text (마지막 텍스트 메시지 판정용)
    responses = collections.OrderedDict()
    for o in rows:
        if o.get('isSidechain'):
            continue
        t = o.get('type')
        h = hac_text(o)
        if h is not None:
            if '# Plain terms' in h:
                st.c['rule plain-terms'] += 1
                pt_on = True
                # 규칙은 그 프롬프트 행 뒤에 기록된다: 지금 턴이 규칙 뒤 첫 답
                if turn is not None:
                    turn['since'] = 0
                    since = 1
                else:
                    since = 0
            if '# Plan reporting' in h:
                st.c['rule work-plan'] += 1
                wp_on = True
                if turn is not None:
                    turn['wp'] = True
            for k, n in NUDGES.items():
                if n in h:
                    st.c['nudge ' + k] += 1
            continue
        if t == 'system' and o.get('subtype') in ('turn_duration', 'stop_hook_summary'):
            if turn is not None:
                turns.append(turn)
                turn = None
            continue
        if is_prompt(o):
            if turn is not None:
                turns.append(turn)
                st.c['turn closed by next prompt'] += 1
            turn = {'all': '', 'msgs': collections.OrderedDict(), 'since': since, 'work': 0, 'plan': False, 'first_ok': False,
                    'first_work_msg': None, 'wp': wp_on}
            if since is not None:
                since += 1
            continue
        if t == 'assistant':
            m = o.get('message') or {}
            mid = m.get('id')
            for b in m.get('content') or []:
                if b.get('type') == 'tool_use':
                    responses.setdefault(mid, []).append(b.get('name'))
                    if b.get('name') == PLAN:
                        st.c['plan_update calls'] += 1
                        st.c['plan_update input chars'] += len(json.dumps(b.get('input'), ensure_ascii=False))
                        if turn is None:
                            st.c['plan_update outside prompt turns'] += 1
        if t == 'assistant' and turn is not None:
            for b in m.get('content') or []:
                if b.get('type') == 'text':
                    turn['all'] += b.get('text', '') + '\n'
                    turn['msgs'][mid] = turn['msgs'].get(mid, '') + b.get('text', '') + '\n'
                elif b.get('type') == 'tool_use':
                    name = b.get('name')
                    if name in WORK:
                        turn['work'] += 1
                        if turn['first_work_msg'] is None:
                            turn['first_work_msg'] = mid
                    if name == PLAN:
                        if not turn['plan']:
                            turn['plan'] = True
                            turn['first_ok'] = turn['first_work_msg'] in (None, mid)
    if turn is not None:
        turns.append(turn)
    for names in responses.values():
        if names and all(n == PLAN for n in names):
            st.c['plan_update-only responses'] += 1
    if pt_on:
        st.c['sessions with plain-terms rule'] += 1
    if wp_on:
        st.c['sessions with work-plan rule'] += 1
    seen = set()
    for tr in turns:
        st.c['turns'] += 1
        if tr['wp'] and tr['work'] >= 2:
            st.c['wp turns 2+ work'] += 1
            st.c['wp turns 2+ work with plan'] += tr['plan']
            st.c['wp turns reported, first ok'] += tr['plan'] and tr['first_ok']
        if not tr['all'].strip():
            continue
        b = bucket_of(tr['since'])
        ts = terms(tr['all'])
        st.bucket[b][0] += 1
        st.bucket[b][1] += len(ts)
        st.bucket[b][2] += sum(g for *_, g, _ in [(x[0], x[1], x[2], x[3]) for x in ts])
        final_txt = list(tr['msgs'].values())[-1] if tr['msgs'] else ''
        fts = terms(final_txt)
        st.final[b][0] += len(fts)
        st.final[b][1] += sum(x[2] for x in fts)
        for t, k, g, ctx in ts:
            if b != 'none':
                st.kind[k][0] += 1
                st.kind[k][1] += g
            if t not in seen:
                seen.add(t)
                key = 'rule' if b != 'none' else 'none'
                st.first_sess[key][0] += 1
                st.first_sess[key][1] += g
            labels.append((f.split('/')[-2][-20:], b, t, k, g, ctx))


def report(name, st):
    c = st.c
    print(f'## {name}')
    for k in ['turns', 'sessions with plain-terms rule', 'sessions with work-plan rule', 'rule plain-terms', 'rule work-plan',
              'nudge after-update', 'nudge first', 'plan_update calls', 'plan_update-only responses', 'plan_update outside prompt turns', 'turn closed by next prompt']:
        print(f'  {k}: {c[k]}')
    print(f"  plan_update avg input chars: {c['plan_update input chars'] / max(1, c['plan_update calls']):.0f}")
    w, p, ok = c['wp turns 2+ work'], c['wp turns 2+ work with plan'], c['wp turns reported, first ok']
    print(f'  work-plan sessions: turns with 2+ work calls {w}, reported {p} ({100 * p / max(1, w):.1f}%), first report with/before first work call {ok} ({100 * ok / max(1, p):.1f}% of reported)')
    print('  gloss (any occurrence) by replies since rule: bucket turns terms glossed% | final message terms glossed%')
    for k in ['1', '2-5', '6-20', '21-50', '51+', 'none']:
        r, n, g = st.bucket[k]
        fn, fg = st.final[k]
        print(f'    {k:6} {r:6} {n:7} {100 * g / max(1, n):5.1f}% | {fn:6} {100 * fg / max(1, fn):5.1f}%')
    print('  by kind (rule):', {k: f'{v[0]} {100 * v[1] / max(1, v[0]):.1f}%' for k, v in st.kind.items()})
    print('  first use in session:', {k: f'{v[0]} {100 * v[1] / max(1, v[0]):.1f}%' for k, v in st.first_sess.items()})


def main():
    files = [l.strip() for l in open(sys.argv[1]) if l.strip()]
    if '--only' in sys.argv:
        files = [f for f in files if sys.argv[sys.argv.index('--only') + 1] in f]
    label_n = int(sys.argv[sys.argv.index('--label') + 1]) if '--label' in sys.argv else 0
    groups = {'devflow-mods': Stat(), 'other projects': Stat()}
    labels = []
    for f in files:
        process(f, groups['devflow-mods' if 'devflow-mods' in f else 'other projects'], labels)
    for n, st in groups.items():
        if st.c['turns']:
            report(n, st)
    if label_n:
        random.seed(11)
        for x in random.sample([l for l in labels if l[1] != 'none'], min(label_n, len(labels))):
            print(f'  [{"Y" if x[4] else "n"}] {x[3]:4} {x[2]:24} | {x[5]}')


main()
