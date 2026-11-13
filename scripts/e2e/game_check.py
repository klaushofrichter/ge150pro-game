"""What the game browser checks here share: the table's API, screenshots, phones that join it, the phone layout
rules of games-service (D-065), and the drag checks of E-035. Builds on games-service's own e2e helpers (`common`,
from .games-service).

    T = TableCheck(BASE, KEY, OUT, "chess")
    a, shot, check, phone, problems = T.a, T.shot, T.check, T.phone, T.problems
"""
import os, time
from common import api, join_deck, watch


def layout_check(cards=".card", skip_svg_parts=False):
    """The phone layout rules as a page function returning the problems found: no sideways scrolling, every button on
    screen and at least 40 px high, and (with `cards`) nothing sticking out of a card. `skip_svg_parts`: an SVG inside a
    card is checked as a whole, not by its parts."""
    card_rule = "" if not cards else f"""
  for (const card of document.querySelectorAll('{cards}')) {{
    const c = card.getBoundingClientRect();
    if (!c.width) continue;
    for (const el of card.querySelectorAll('*')) {{
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height{" || el.closest('svg') && el.tagName !== 'svg'" if skip_svg_parts else ""}) continue;
      if (r.left < c.left - 1 || r.right > c.right + 1) out.push(`${{el.tagName.toLowerCase()}}.${{String(el.getAttribute('class') || '').split(' ')[0]}} sticks out of its card by ${{Math.round(Math.max(c.left - r.left, r.right - c.right))}}px`);
    }}
  }}"""
    return """() => {
  const w = innerWidth, out = [];
  if (document.documentElement.scrollWidth > w + 1) out.push(`page is ${document.documentElement.scrollWidth}px wide in a ${w}px window`);
  for (const b of document.querySelectorAll('button')) {
    const r = b.getBoundingClientRect(), cs = getComputedStyle(b);
    if (!r.width || !r.height || cs.visibility === 'hidden' || b.closest('[hidden]')) continue;
    if (r.right > w + 1) out.push(`"${(b.textContent || b.className).trim().slice(0, 30)}" sticks out to ${Math.round(r.right)}px`);
    if (r.height < 40) out.push(`"${(b.textContent || b.getAttribute('aria-label') || b.className).trim().slice(0, 30)}" is only ${Math.round(r.height)}px high`);
  }""" + card_rule + """
  return out;
}"""


CHECK = layout_check()


class TableCheck:
    """One check's Table Host: its API with the table key, screenshots named after the game, phones that join it, and
    the layout problems found on them (reported at the end)."""

    def __init__(self, base, key, out, prefix, check_js=CHECK):
        self.base, self.key, self.out, self.prefix, self.check_js = base, key, out, prefix, check_js
        self.problems = []

    def a(self, method, path, body=None):
        return api(method, path, body, base=self.base, key=self.key)

    def shot(self, page, name):
        page.screenshot(path=os.path.join(self.out, f"{self.prefix}-{name}.png"))

    def check(self, page, where):
        for p in page.evaluate(self.check_js):
            self.problems.append(f"{where}: {p}")

    def phone(self, browser, name, w, h):
        ctx = browser.new_context(viewport={"width": w, "height": h}, device_scale_factor=2, has_touch=True)
        d = ctx.new_page()
        watch(d, name)
        join_deck(d, self.a("GET", "/join")["url"], name)
        d.label = name
        return d


# A slow link for the board's intents (held 400 ms on the socket): what a dropped piece does while it waits shows.
SLOW_INTENTS = """(on) => { const ws = WebSocket.prototype; ws.__send ??= ws.send;
  ws.send = on ? function (d) { if (typeof d === "string" && d.includes('"intent"')) return void setTimeout(() => ws.__send.call(this, d), 400);
    return ws.__send.call(this, d); } : ws.__send; }"""


# Follows a dropped piece frame by frame (the piece nearest to where it was last seen, starting at the drop): it must
# only ever come closer to where it ends, never slide back toward where it came from first; and no piece may show where
# the dragged one started, which is a jump back (E-035).
PATH_WATCH = """([sel, x, y, ox, oy]) => { const path = (window.__path = []); window.__home = 0; let p = { x, y };
  const until = performance.now() + 1200;
  const look = () => { let best = null, bd = Infinity;
    for (const e of document.querySelectorAll(sel)) { const r = e.getBoundingClientRect(), c = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      if (Math.hypot(c.x - ox, c.y - oy) < 6) window.__home++;
      const d = Math.hypot(c.x - p.x, c.y - p.y); if (d < bd) { bd = d; best = c; } }
    if (best) path.push((p = best));
    if (performance.now() < until) requestAnimationFrame(look); };
  requestAnimationFrame(look); }"""


def settles_smoothly(board, what):
    time.sleep(1.3)
    path = board.evaluate("() => window.__path")
    end = path[-1]
    d = [((q["x"] - end["x"]) ** 2 + (q["y"] - end["y"]) ** 2) ** 0.5 for q in path]
    back = max((b - a for a, b in zip(d, d[1:])), default=0)
    assert back <= 3, f"{what}: moved {back:.0f}px away from where it ends, after the drop"
    assert board.evaluate("() => window.__home") == 0, f"{what}: jumped back to where it started"
