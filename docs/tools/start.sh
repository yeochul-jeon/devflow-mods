#!/bin/bash
# 촬영용 Claude 세션을 tmux 에 띄운다. 설치된 플러그인은 모두 끄고, 고른 mod 만 이 저장소에서 읽는다.
# 사용: start.sh <tmux 세션> <cols> <rows> <시험 저장소 폴더> <mod>...
# 예: start.sh tb 160 40 /tmp/x/order-svc team-board work-plan
# 설정을 더하려면 환경 변수 EXTRA 에 JSON (예: EXTRA='{"theme":"light","pluginConfigs":{"team-board@inline":{"options":{"palette":"theme"}}}}')
# 권한 모드는 기본 plan (파일 수정 없음). 시험 저장소에서 수정까지 찍을 때만 MODE=acceptEdits
# 시험 저장소가 없으면 빈 git 저장소로 만든다. 첫 화면의 폴더 신뢰 질문은 직접 넘긴다: tmux send-keys -t <세션> Down Enter
set -e
S=$1 COLS=$2 ROWS=$3 REPO=$4
shift 4
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
[ -d "$REPO/.git" ] || { mkdir -p "$REPO" && git -C "$REPO" init -q && git -C "$REPO" commit -q --allow-empty -m init; }
OFF=$(python3 -I -c "
import json, os
d = json.load(open(os.path.expanduser('~/.claude/settings.json'))).get('enabledPlugins', {})
print(json.dumps({'enabledPlugins': {k: False for k in d}, **json.loads(os.environ.get('EXTRA') or '{}')}))")
DIRS=""
for m in "$@"; do DIRS="$DIRS --plugin-dir $ROOT/$m"; done
tmux kill-session -t "$S" 2>/dev/null || true
# TMUX 가 있으면 Claude Code 가 256색으로 낮춘다. tmux 자체는 24비트를 보존한다
tmux new-session -d -s "$S" -x "$COLS" -y "$ROWS" \
  "cd '$REPO' && env -u TMUX -u TMUX_PANE TERM=xterm-256color TERM_PROGRAM=ghostty COLORTERM=truecolor claude --permission-mode ${MODE:-plan} $DIRS --settings '$OFF'"
