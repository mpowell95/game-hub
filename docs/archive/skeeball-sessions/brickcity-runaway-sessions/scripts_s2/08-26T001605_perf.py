import io, sys, os
os.chdir('/home/user/game-hub')
def edit(path, old, new, count=1):
    s = io.open(path, encoding='utf-8').read()
    n = s.count(old)
    if n != count:
        print('FAIL %s: expected %d occurrence(s), found %d' % (path, count, n)); sys.exit(1)
    io.open(path, 'w', encoding='utf-8').write(s.replace(old, new))
    print('ok   %s' % path)

# 1. hub top bar: sticky over a scrolling launcher, 0.92 alpha -> the blur was invisible and
#    re-computed every scroll frame.
edit('css/hub.css',
"""  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: saturate(1.2) blur(6px);
  border-bottom: 1px solid var(--hub-surface-2);""",
"""  /* OPAQUE, AND NO backdrop-filter (2026-08-26). This is a STICKY bar over the scrolling
     launcher, so a backdrop blur is re-blurred by the compositor on every scroll frame - and at
     0.92 alpha there was almost nothing showing through to blur. It cost a full-width blur pass
     per scrolled frame and looked identical without it. Same reasoning as .lb-top, which has
     always been opaque. */
  background: var(--hub-surface, #fff);
  border-bottom: 1px solid var(--hub-surface-2);""")

# 2. THE BIG ONE: the immersive back button floats over a LIVE 60fps canvas.
edit('css/hub.css',
"""  pointer-events: auto;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: saturate(1.2) blur(6px);
  box-shadow: 0 2px 10px rgba(20, 40, 80, 0.18);""",
"""  pointer-events: auto;
  /* NO backdrop-filter here, and this is the one that mattered most (2026-08-26). In immersive
     mode this button floats OVER A LIVE 60fps CANVAS - Skeeball, Ball Run, Pool, Hill Climb,
     Escoba, Mancala, Yahtzee, Pinball, Battleship - so the compositor re-read and re-blurred the
     region behind it on EVERY GAME FRAME, for a frosted edge nobody can see through 0.92 alpha.
     It was a per-frame GPU cost in all nine immersive games at once. */
  background: var(--hub-surface, #fff);
  box-shadow: 0 2px 10px rgba(20, 40, 80, 0.18);""")

# 3. every game's how-to / win-lose modal scrim
edit('css/ui.css',
"""  background: rgba(9, 16, 28, .55);
  backdrop-filter: blur(3px);
  -webkit-backdrop-filter: blur(3px);""",
"""  /* NO backdrop-filter (2026-08-26). Every game's how-to-play and win/lose modal uses this
     scrim, and the immersive games DO NOT STOP RENDERING behind it - so the blur was re-computed
     against a fresh 60fps frame the whole time the player sat reading. The scrim is darkened from
     .55 to .66 to carry the separation the blur used to, which costs nothing. */
  background: rgba(9, 16, 28, .66);""")

# 4. My Stats' sticky header. The leaderboard's .lb-top never had one; this brings the two in line.
edit('js/game-stats-ui.js',
"'.gs-top{position:sticky;top:0;z-index:2;padding:max(env(safe-area-inset-top,0px),8px) 18px 0;background:rgba(255,255,255,.94);backdrop-filter:saturate(1.2) blur(6px);border-bottom:1px solid var(--hub-surface-2,#eef2f8)}',",
"""// STICKY over a scrolling game list, so a backdrop blur is re-blurred every scroll frame - at
    // .94 alpha, for an effect that was not visible. The Leaderboard's own .lb-top has always been
    // opaque; this is the same band and now behaves the same way (2026-08-26).
    '.gs-top{position:sticky;top:0;z-index:2;padding:max(env(safe-area-inset-top,0px),8px) 18px 0;background:var(--hub-surface,#fff);border-bottom:1px solid var(--hub-surface-2,#eef2f8)}',""")
