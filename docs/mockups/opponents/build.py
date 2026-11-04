# Builds the "how scores are calculated" mockups for the more-opponents points rule (2026-11-04).
# Tile art is copied from docs/mockups/final/sheet-<game>.html. Run: python3 docs/mockups/opponents/build.py
import re, pathlib
HERE = pathlib.Path(__file__).parent
FINAL = HERE.parent / 'final'

def art(game):
    s = (FINAL / f'sheet-{game}.html').read_text()
    return re.search(r'<span class="art">(.*?)</span>', s, re.S).group(1)

SH = {
  'Easy': '<svg viewBox="0 0 20 20" fill="#2e9e44"><circle cx="10" cy="10" r="8"/></svg>',
  'Medium': '<svg viewBox="0 0 20 20" fill="#1F5FA8"><rect x="3" y="3" width="14" height="14" rx="3"/></svg>',
  'Hard': '<svg viewBox="0 0 20 20" fill="#1c2430"><rect x="4.9" y="4.9" width="10.2" height="10.2" rx="1.6" transform="rotate(45 10 10)"/></svg>',
}
PEOPLE = '<svg viewBox="0 0 22 20" width="22" height="20"><circle cx="7" cy="6.5" r="3.6" fill="currentColor"/><circle cx="15" cy="6.5" r="3.6" fill="currentColor"/><path d="M0.5 19c0-3.8 2.9-6.6 6.5-6.6s6.5 2.8 6.5 6.6zM8.5 19c0-3.8 2.9-6.6 6.5-6.6s6.5 2.8 6.5 6.6z" fill="currentColor"/></svg>'

CSS = """*{box-sizing:border-box;margin:0;padding:0}
body{background:#07090d;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",Roboto,sans-serif;color:#F4F6F9;padding:24px}
.phone{position:relative;width:402px;height:874px;border-radius:44px;overflow:hidden;background:#11141b;border:1px solid #262b35}
.tabs{position:absolute;left:0;right:0;bottom:0;height:84px;background:#141821;border-top:1px solid #222834;display:flex;justify-content:space-around;padding-top:16px;z-index:4}
.tabs i{width:30px;height:28px;border-radius:7px;background:#3a4150}.tabs i.on{background:#e8b72a}
.gamebar{position:absolute;top:56px;left:0;right:0;height:80px;display:flex;align-items:center;gap:12px;padding:0 20px}
.art svg{width:62px;height:35px;display:block;border-radius:8px}
.gname{flex:1;font-size:24px;font-weight:800}
.play{background:#2b4a85;border-radius:24px;padding:12px 22px;font-weight:700;font-size:17px}
.scrim{position:absolute;inset:0;background:rgba(5,8,14,.55);z-index:1}
.sheet{position:absolute;z-index:2;left:0;right:0;bottom:0;background:#191c23;border-radius:22px 22px 0 0;padding:10px 16px 108px;display:flex;flex-direction:column;gap:16px}
.grab{align-self:center;width:40px;height:5px;border-radius:3px;background:#3a4150}
.hd{display:flex;align-items:center;gap:14px;padding:4px 2px 0}
h2{font-size:26px;font-weight:800}
.card{border:1px solid #2B313B;border-radius:14px;background:#1E222A;overflow:hidden}
table{width:100%;border-collapse:collapse}
th{font-size:16px;font-weight:700;color:#F4F6F9;text-align:center;padding:10px 0 8px;line-height:1.2}
th.sup{padding:12px 0 4px;border-bottom:1px solid #3a4150}
th:first-child{width:auto}
td{text-align:center;height:52px;border-top:1px solid rgba(255,255,255,.07);color:#FFFFFF;font-weight:800;font-size:22px}
td.lv{text-align:left;padding-left:14px;font-weight:500;font-size:18px;white-space:nowrap}
.sh{display:inline-flex;width:22px;height:22px;background:#fff;border-radius:4px;padding:2px;vertical-align:middle}
.sh svg{width:100%;height:100%;display:block}
.ic{display:inline-flex;width:22px;color:#E6E9EF;vertical-align:middle}
td.lv .n{margin-left:12px;vertical-align:middle}
.gap{border-top:6px solid #11141b}
.note{padding:12px 14px 14px;font-size:17px;line-height:1.4;color:#F4F6F9;border-top:1px solid rgba(255,255,255,.07)}
.new{background:rgba(255,206,58,.13)}
.done{margin-top:4px;width:100%;background:#7AA7FF;color:#0c1424;border-radius:16px;height:54px;font-size:19px;font-weight:700;border:0;font-family:inherit}
"""

def lvrow(name, vals, cls=''):
    return (f'<tr{" class=%s" % cls if cls else ""}><td class="lv"><span class="sh">{SH[name]}</span><span class="n">{name}</span></td>'
            + ''.join(f'<td>{v}</td>' for v in vals) + '</tr>')

def grid(head, cols, rows, colw):
    if len(cols) == 1:
        h = f'<tr><th></th><th class="sup" style="width:{colw}px">{head}</th></tr>'
    else:
        h = f'<tr><th></th><th colspan="{len(cols)}" class="sup">{head}</th></tr><tr><th></th>' + ''.join(f'<th style="width:{colw}px">{c}</th>' for c in cols) + '</tr>'
    return f'<table><thead>{h}</thead><tbody>' + ''.join(lvrow(n, v) for n, v in rows) + '</tbody></table>'

def online(vals, colw, label='Opponents'):
    cols = ''.join(f'<th style="width:{colw}px">{i + 1}</th>' for i in range(len(vals)))
    return (f'<table class="gap"><thead><tr><th></th><th colspan="{len(vals)}" class="sup">{label}</th></tr><tr><th></th>{cols}</tr></thead>'
            f'<tbody><tr><td class="lv"><span class="ic">{PEOPLE}</span><span class="n">Online</span></td>' + ''.join(f'<td>{v}</td>' for v in vals) + '</tr></tbody></table>')

def page(game, title, body):
    a = art(game)
    return (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            f'<title>{title} scores</title><style>{CSS}</style></head><body><div class="phone">'
            f'<div class="gamebar"><span class="art">{a}</span><span class="gname">{title}</span><span class="play">Play</span></div><div class="scrim"></div>'
            f'<div class="sheet"><span class="grab"></span><div class="hd"><span class="art">{a}</span><h2>{title}</h2></div>'
            f'<div class="card">{body}</div><button class="done">Done</button></div>'
            f'<div class="tabs"><i></i><i></i><i></i><i class="on"></i><i></i></div></div></body></html>')

SHEETS = {
  'business': ('Monopoly Deal', grid('Computers', [1, 2, 3, 4], [('Easy', [1, 2, 3, 4]), ('Medium', [2, 4, 6, 8]), ('Hard', [3, 6, 9, 12])], 58)),
  'uno': ('Uno', grid('Computers', [1, 2, 3], [('Easy', [1, 2, 3]), ('Medium', [2, 4, 6]), ('Hard', [3, 6, 9])], 70)),
  'eightball': ('Pool', grid('Racks to win', [1, 2, 3], [('Easy', [1, 1, 2]), ('Medium', [1, 3, 6]), ('Hard', [3, 5, 10])], 70)
      + '<div class="note"><b>Cutthroat</b> (2 computers): x2<br>Hard, 3 racks = 20</div>'
      + online([3, 6], 70)),
  'chinchon': ('Chinchón', grid('Game ends at (points)', ['Under 100', '100+'], [('Easy', [1, 1]), ('Medium', [1, 2]), ('Hard', [2, 4])], 100)
      + '<div class="note"><b>2 or 3 computers:</b> points added up.<br>Easy + Hard = 5</div>'
      + online([3, 6, 9], 66)),
  'escoba': ('Escoba', grid('Points per win', [''], [('Easy', [1]), ('Medium', [2]), ('Hard', [4])], 130)
      + '<div class="note"><b>2 or 3 computers:</b> points added up.<br>Easy + Hard = 5</div>'
      + online([2, 4, 6], 66)),
}
for g, (title, body) in SHEETS.items():
    (HERE / f'sheet-{g}.html').write_text(page(g, title, body))
    print('wrote', g)
