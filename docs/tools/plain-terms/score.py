# drive.py 시험 대화 판정. 사용: python3 -I score.py <outdir> <label> <uuid>...
# 턴마다 최종 답(result)을 읽어, 대화에서 처음 나온 작업 번호·코드 이름의 풀이 여부, 앞 답에서 푼 것을 다시 푼 횟수,
# 번호만 되풀이한 빈 풀이(「T5 (작업 5번)」, 풀이로 치지 않음)를 센다. 범례 줄(「D25 = …」)은 세지 않으므로 손으로 더한다.
import json, re, sys, os, collections

HERE = os.path.dirname(os.path.abspath(__file__))
D = sys.argv.pop(1)
sys.argv_saved = sys.argv
sys.argv = ['x', '--colon']
src = open(os.path.join(HERE, 'measure_transcripts.py')).read().replace('\nmain()\n', '\n')
m = {}
exec(compile(src, 's1_measure', 'exec'), m)
sys.argv = sys.argv_saved

# 「T5 (작업 5번)」「D24(결정 항목 24)」처럼 번호만 되풀이한 풀이
EMPTY = re.compile(r'^\s*[(（]\s*(작업|결정|결정 항목|질문|항목|단계|절차|절차서|task|item|step|decision|question)\s*\d+\s*(번|번째)?\s*[)）]', re.I)


def gloss_text(text, term):
    i = text.find(term)
    while i >= 0:
        j = i + len(term)
        k = j
        while k < len(text) and text[k] in '*`_ ':
            k += 1
        if k < len(text) and text[k] in '(（':
            end = text.find(')', k)
            return text[k:end + 1] if end > 0 else text[k:k + 40]
        i = text.find(term, j)
    return None


label = sys.argv[1]
tot = collections.Counter()
for u in sys.argv[2:]:
    seen, glossed_before = set(), set()
    t = 0
    while os.path.exists(os.path.join(D, f'pt_{u}_{t + 1}.json')):
        t += 1
        r = json.load(open(os.path.join(D, f'pt_{u}_{t}.json')))
        text = r.get('result') or ''
        tot['chars'] += len(text)
        for term, kind, g, ctx in m['terms'](text):
            if kind == 'abbr':
                continue
            if g:
                gt0 = gloss_text(text, term)
                if gt0 and EMPTY.match(gt0):
                    tot['empty gloss'] += 1
                    g = False
            if term not in seen:
                seen.add(term)
                tot['first'] += 1
                tot['first glossed'] += g
            elif g and term in glossed_before:
                tot['re-glossed'] += 1
            if g:
                glossed_before.add(term)
                tot['glosses'] += 1
print(f"{label}: runs {len(sys.argv) - 2}  first-use ids+code {tot['first']}  glossed {100 * tot['first glossed'] / max(1, tot['first']):.0f}%"
      f"  re-glossed in later replies {tot['re-glossed']}  empty glosses {tot['empty gloss']} (not counted), real glosses {tot['glosses']}  answer chars/run {tot['chars'] // max(1, len(sys.argv) - 2)}")
