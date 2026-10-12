#!/bin/bash
# tmux 세션 tb 를 찍어 현재 폴더에 <name>.ansi/.html/.png 를 만든다. 사용: shot.sh <name> <first> <last> <cols> <widthPx> <heightPx>
T=$(cd "$(dirname "$0")" && pwd)
tmux capture-pane -t tb -e -p > "$1.ansi"
python3 "$T/ansi2html.py" "$1.html" "$4" "$1.ansi:$2:$3"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size="$5,$6" --screenshot="$PWD/$1.png" "file://$PWD/$1.html" 2>/dev/null
