# tmux capture-pane -e 출력(ANSI)을 칸 격자 HTML 로. 사용: ansi2html.py <out.html> <cols> <in:first:last>...
# first/last 가 'band' 면 ╔ 줄부터 ╚ 줄까지
import re, sys, unicodedata, html
out, cols, segs = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
import os
BG, FG = os.environ.get('BG', '#111827'), os.environ.get('FG', '#cbd5e1')
base = ['#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
        '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff']
def x256(n):
    if n < 16: return base[n]
    if n < 232:
        n -= 16; v = [0, 95, 135, 175, 215, 255]
        return '#%02x%02x%02x' % (v[n // 36], v[n // 6 % 6], v[n % 6])
    g = 8 + (n - 232) * 10; return '#%02x%02x%02x' % (g, g, g)
def seg_lines(spec):
    src, first, last = spec.rsplit(':', 2)
    ls = open(src, encoding='utf-8').read().split('\n')
    if first == 'band':
        plain = [re.sub(r'\x1b\[[0-9;:]*m', '', l) for l in ls]
        first = next(i for i, l in enumerate(plain) if '╔' in l)
        last = next(i for i, l in enumerate(plain) if '╚' in l and i > first)
    return ls[int(first):int(last) + 1]
def parse(ln):
    st = {'fg': None, 'bg': None, 'b': False, 'dim': False, 'rev': False}
    cells, pos = [], 0
    for m in re.finditer(r'\x1b\[([0-9;:]*)m|([^\x1b])', ln):
        if m.group(1) is not None:
            ps = [int(p) if p else 0 for p in re.split('[;:]', m.group(1))] or [0]
            i = 0
            while i < len(ps):
                p = ps[i]
                if p == 0: st = {'fg': None, 'bg': None, 'b': False, 'dim': False, 'rev': False}
                elif p == 1: st['b'] = True
                elif p == 2: st['dim'] = True
                elif p == 22: st['b'] = st['dim'] = False
                elif p == 7: st['rev'] = True
                elif p == 27: st['rev'] = False
                elif 30 <= p <= 37: st['fg'] = base[p - 30]
                elif 90 <= p <= 97: st['fg'] = base[p - 82]
                elif 40 <= p <= 47: st['bg'] = base[p - 40]
                elif 100 <= p <= 107: st['bg'] = base[p - 92]
                elif p == 39: st['fg'] = None
                elif p == 49: st['bg'] = None
                elif p in (38, 48):
                    k = 'fg' if p == 38 else 'bg'
                    if ps[i + 1] == 2: st[k] = '#%02x%02x%02x' % tuple(ps[i + 2:i + 5]); i += 4
                    elif ps[i + 1] == 5: st[k] = x256(ps[i + 2]); i += 2
                i += 1
            continue
        ch = m.group(2)
        w = 2 if unicodedata.east_asian_width(ch) in 'WF' else 1
        fg, bg = st['fg'] or FG, st['bg']
        if st['rev']: fg, bg = (bg or BG), fg
        cells.append((ch, w, fg, bg, st['b'], st['dim']))
        pos += w
    return cells
rows = []
for k, spec in enumerate(segs):
    if k: rows += [[], []]
    rows += [parse(l) for l in seg_lines(spec)]
def span(c):
    ch, w, fg, bg, b, dim = c
    s = f'width:{w}ch;color:{fg};' + (f'background:{bg};' if bg else '') + ('font-weight:700;' if b else '') + ('opacity:.6;' if dim else '')
    return f'<span style="{s}">{html.escape(ch) if ch != " " else "&nbsp;"}</span>'
body = '\n'.join('<div class="r">' + ''.join(span(c) for c in r) + '</div>' for r in rows)
open(out, 'w', encoding='utf-8').write(f'''<!doctype html><meta charset="utf-8"><style>
html,body{{margin:0;background:{BG}}} .w{{padding:14px 16px;width:{cols}ch;font:15px/1.35 "D2Coding ligature",Menlo,"Apple SD Gothic Neo",monospace}}
.r{{white-space:pre;height:1.35em;font-variant-ligatures:none}} .r span{{display:inline-block;text-align:center;overflow:visible}}
</style><div class="w">{body}</div>''')
