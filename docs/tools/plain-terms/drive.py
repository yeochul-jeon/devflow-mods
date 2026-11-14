# plain-terms 효과 시험: 한 프로세스에서 6턴 대화. claude -p --input-format stream-json 에 프롬프트를 하나씩 넣고 result 가 오면 다음을 넣는다.
# (-p --resume 로 턴마다 새 프로세스를 띄우면 규칙이 턴마다 다시 붙어 잘못 잰다)
# 사용: python3 -I drive.py <session-uuid> <plugin-dir> <workdir> <outdir>
#   workdir: fixture/ 를 복사해 git 저장소로 만들 빈 폴더 (이 저장소 밖, 예: scratchpad). 이미 있으면 그대로 쓴다
#   outdir: 턴마다 결과를 <outdir>/pt_<uuid>_<턴>.json 으로 쓴다. 판정은 score.py
#   비교할 옛 판: git archive <커밋> plain-terms | tar -x -C <폴더> 로 꺼내 <폴더>/plain-terms 를 plugin-dir 로 준다
# 설치된 mod·MCP 는 빼고(--setting-sources project --strict-mcp-config) plugin-dir 의 mod 만 싣는다. plan 모드라 파일을 고치지 않는다.
import json, os, shutil, subprocess, sys

U, PLUGIN, FIX, OUT = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
if not os.path.isdir(os.path.join(FIX, '.git')):
    shutil.copytree(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'fixture'), FIX, dirs_exist_ok=True)
    subprocess.run(['git', 'init', '-q'], cwd=FIX, check=True)
    subprocess.run(['git', 'add', '-A'], cwd=FIX, check=True)
    subprocess.run(['git', 'commit', '-qm', 'fixture'], cwd=FIX, check=True)
PROMPTS = [
    'HANDOFF.md 읽고 지금 상태와 남은 일을 짧게 요약해 줘.',
    '결정 대기 항목들을 표로 정리해 줘.',
    'T7 이 왜 막혔는지 src/order.ts 를 보고 설명해 줘.',
    'T5부터 T9까지 각각 어디까지 왔는지 한 문단으로 이어서 설명해 줘.',
    '다음 작업 순서를 제안해 줘. 결정이 필요한 것도 같이.',
    '아까 정리한 것 중 Q 항목만 다시 말해 줘.',
]
env = {k: v for k, v in os.environ.items() if not k.startswith(('CLAUDE_CODE_', 'CLAUDECODE'))}
cmd = ['claude', '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
       '--session-id', U, '--permission-mode', 'plan', '--setting-sources', 'project', '--strict-mcp-config',
       '--plugin-dir', PLUGIN]
p = subprocess.Popen(cmd, cwd=FIX, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
results = []
for i, prompt in enumerate(PROMPTS):
    p.stdin.write(json.dumps({'type': 'user', 'message': {'role': 'user', 'content': prompt}}, ensure_ascii=False) + '\n')
    p.stdin.flush()
    for line in p.stdout:
        try:
            o = json.loads(line)
        except Exception:
            continue
        if o.get('type') == 'result':
            results.append(o)
            print(f'turn {i + 1} {o.get("subtype")}', flush=True)
            break
p.stdin.close()
p.wait(timeout=120)
for i, r in enumerate(results):
    json.dump(r, open(os.path.join(OUT, f'pt_{U}_{i + 1}.json'), 'w'), ensure_ascii=False)
