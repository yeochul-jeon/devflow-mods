#!/bin/bash
# mod 하나를 릴리즈한다: <mod>--v<버전> 태그, GitHub Release(본문은 CHANGELOG 의 그 버전), stable 목록의 ref. 사용: release.sh <mod>
# main 에 커밋·push 하고 실화면을 확인한 뒤에 돌린다. 확인이 하나라도 틀리면 아무것도 하지 않고 멈춘다.
set -euo pipefail
cd "$(dirname "$0")/../.."
mod=${1:?사용: release.sh <mod>}
manifest=$mod/.claude-plugin/plugin.json
[ -f "$manifest" ] || { echo "없는 mod: $mod" >&2; exit 1; }
ver=$(python3 -I -c 'import json,sys;print(json.load(open(sys.argv[1]))["version"])' "$manifest")
tag=$mod--v$ver

git fetch -q origin main stable
[ "$(git branch --show-current)" = main ] || { echo "main 에서 돌리세요" >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "커밋 안 한 변경이 있습니다" >&2; exit 1; }
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || { echo "main 이 origin/main 과 다릅니다 (push 먼저)" >&2; exit 1; }
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null || git ls-remote --exit-code --tags origin "$tag" >/dev/null; then
  echo "태그가 이미 있습니다: $tag" >&2; exit 1
fi
bump=$(git log -1 --format=%H -G'"version"' -- "$manifest")
git diff --quiet "$bump" HEAD -- "$mod/" || { echo "버전을 올린 커밋($(git rev-parse --short "$bump")) 뒤에 $mod/ 가 바뀌었습니다. 버전을 다시 올리세요" >&2; exit 1; }
# CHANGELOG: '## <mod>' 아래 '### <ver>' 부터 다음 '###' 또는 '## ' 전까지
notes=$(awk -v mod="## $mod" -v ver="### $ver" '
  $0 == mod { inmod = 1; next }
  inmod && /^## / { exit }
  inmod && index($0, ver) == 1 && (length($0) == length(ver) || substr($0, length(ver) + 1, 1) == " ") { on = 1; next }
  on && /^##/ { exit }
  on { print }' CHANGELOG.md)
[ -n "${notes//[[:space:]]/}" ] || { echo "CHANGELOG 에 $mod $ver 항목이 없습니다" >&2; exit 1; }

git tag -a "$tag" -m "$mod $ver" "$bump"
git push -q origin "refs/tags/$tag"
printf '%s\n' "$notes" | gh release create "$tag" --verify-tag --title "$mod $ver" --notes-file -

wt=$(mktemp -d)/stable
git worktree add -q --detach "$wt" origin/stable
trap 'git worktree remove --force "$wt"' EXIT
python3 -I - "$wt/.claude-plugin/marketplace.json" "$mod" "$tag" <<'EOF'
import json, sys
path, mod, tag = sys.argv[1:]
m = json.load(open(path))
entry = next((p for p in m['plugins'] if p['name'] == mod), None)
if entry is None:
    entry = {'name': mod, 'source': {'source': 'git-subdir', 'url': 'https://github.com/yeochul-jeon/devflow-mods.git', 'path': mod}}
    m['plugins'].append(entry)
entry['source']['ref'] = tag
json.dump(m, open(path, 'w'), ensure_ascii=False, indent=2)
open(path, 'a').write('\n')
EOF
if git -C "$wt" diff --quiet; then
  echo "stable 은 이미 $tag 를 가리킵니다"
else
  claude plugin validate "$wt" >/dev/null
  git -C "$wt" commit -q -am "stable: $mod $ver"
  git -C "$wt" push -q origin HEAD:stable
fi
echo "릴리즈: $tag ($(git rev-parse --short "$bump"))"
