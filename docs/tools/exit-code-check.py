# Claude Code 업데이트 뒤 실패한 Bash tool_result 가 아직 'Exit code N' 으로 시작하는지 기록에서 센다(토큰 0).
# team-board 의 didRun 판정(team-board/hooks/register.tsx tool.call Bash)이 이 형식에 기댄다.
# 사용: python3 -I exit-code-check.py [--root DIR] [--days N] [--version X]   종료 코드: OK 0 / WARN 1 / NO DATA 2
import argparse, glob, json, os, re, sys, time

TEST_DIR = ('scratchpad', 'live-repo', '-private-tmp', '-tmp-')
EXIT_CODE = re.compile(r'^Exit code \d+')  # team-board 와 같은 식


def vkey(v):
    return tuple(int(p) if p.isdigit() else 0 for p in v.split('.'))


def text_of(content):
    # content 는 문자열이거나 블록 배열
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return ''.join(b.get('text', '') for b in content if isinstance(b, dict) and b.get('type') == 'text')
    return ''


def rows(path):
    with open(path, 'rb') as f:
        for line in f:
            try:
                r = json.loads(line)
            except ValueError:
                continue
            if isinstance(r, dict):
                yield r


def blocks(r, kind):
    m = r.get('message')
    c = m.get('content') if isinstance(m, dict) else None
    return [b for b in c if isinstance(b, dict) and b.get('type') == kind] if isinstance(c, list) else []


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--root', default=os.path.expanduser('~/.claude/projects'))
    ap.add_argument('--days', type=float, default=3)
    ap.add_argument('--version')
    a = ap.parse_args()
    since = time.time() - a.days * 86400
    files = [f for f in glob.glob(os.path.join(a.root, '*', '*.jsonl'))
             if os.path.getmtime(f) >= since and not any(t in os.path.basename(os.path.dirname(f)) for t in TEST_DIR)]
    # 파일마다 Bash id 와 (버전, 오류 글) 을 모은다. tool_use 와 tool_result 는 같은 파일 안에 있다
    errors, seen = [], set()
    for f in files:
        bash, res = set(), []
        for r in rows(f):
            if r.get('type') == 'assistant':
                bash.update(b.get('id') for b in blocks(r, 'tool_use') if b.get('name') == 'Bash')
            elif r.get('type') == 'user' and isinstance(r.get('version'), str):
                seen.add(r['version'])
                res += [(r['version'], b) for b in blocks(r, 'tool_result')]
        errors += [(v, text_of(b.get('content'))) for v, b in res if b.get('is_error') is True and b.get('tool_use_id') in bash]
    # 버전은 Bash 오류가 있는 행이 아니라 user 행 전체에서 가장 높은 것
    version = a.version or (max(seen, key=vkey) if seen else None)
    texts = [t for v, t in errors if v == version]
    exit_n = sum(1 for t in texts if EXIT_CODE.match(t))
    other = [t for t in texts if not EXIT_CODE.match(t)]
    print(f'version {version}  files {len(files)}  bash errors {len(texts)}  Exit code {exit_n}  other {len(other)}')
    for t in other:
        print('  other:', t[:50].replace('\n', ' '))
    if exit_n:
        print('OK')
        return 0
    if texts:
        print('WARN: Bash 오류가 있는데 Exit code 로 시작하는 것이 없습니다. team-board didRun 판정을 확인하세요')
        return 1
    print('NO DATA: 이 버전의 Bash 오류가 없습니다')
    return 2


if __name__ == '__main__':
    sys.exit(main())
