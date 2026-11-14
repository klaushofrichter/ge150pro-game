"""What the game browser checks here share: the table's API, screenshots, the board with the simulated pedal
(fake_pedal.js), phones that join it, and the phone layout rules of games-service (D-065). Builds on games-service's
own e2e helpers (`common`, from .games-service).

    T = TableCheck(BASE, KEY, OUT, "ge150-pro")
    a, shot, check, phone, problems = T.a, T.shot, T.check, T.phone, T.problems
"""
import json, os
from common import api, join_deck, watch

FAKE = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "fake_pedal.js")).read()


def sent(board, cmd):
    """How many messages with this command byte the simulated pedal received."""
    return board.evaluate(f"() => window.__pedal.log.filter((m) => m.cmd === {cmd}).length")


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

    def board(self, browser, label="board", script=None, **pedal):
        """The table's board at 1920x1080 with the simulated pedal (`pedal` are its options), or with another init
        script instead."""
        ctx = browser.new_context(viewport={"width": 1920, "height": 1080}, has_touch=True)
        ctx.add_init_script(script if script is not None else f"window.__fakePedalOptions = {json.dumps(pedal)};\n{FAKE}")
        page = ctx.new_page()
        watch(page, label)
        page.goto(self.base + "/board/")
        return page
