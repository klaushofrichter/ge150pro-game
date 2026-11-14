"""Browser check for GE150 Pro on a real games-service Table Host: the board page with a simulated pedal
(scripts/e2e/fake_pedal.js replaces WebHID) and one phone at the smallest supported size, 320 x 568.

Checks on the way:
  - no browser console error or uncaught exception, on the board or the phone;
  - the lobby's way in: the player joins, marks ready, the game starts with the player on South;
  - the board connects to the pedal by itself, loads its 200 presets and shows the current one; so does the phone;
  - the board switches a module on and off and moves a fader: the pedal receives the module writes;
  - Save configuration… on the board puts a configuration on quick slot 1 and on the footswitch of the current preset;
  - the phone's quick slot recalls it (the pedal receives it), ▶ selects the next preset (the pedal switches);
  - the pedal's footswitch selecting the trigger preset applies the configuration;
  - the Rhythm tab shows the pedal's drum machine by name and runs the table's click;
  - the phone layout rules of games-service (D-065) on every tab;
  - Finish asks first, then ends with a summary.
  python3 scripts/e2e/ge150_pro.py out/
"""
import os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, ".games-service", "scripts", "e2e"))
from playwright.sync_api import sync_playwright  # noqa: E402
from common import errors, pick_game, start_table, wait  # noqa: E402
from game_check import CHECK, TableCheck, sent  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8097
BASE = f"http://127.0.0.1:{PORT}"
KEY = "e2ekey"
T = TableCheck(BASE, KEY, OUT, "ge150-pro", CHECK)
a, shot, check, phone, problems = T.a, T.shot, T.check, T.phone, T.problems


def main():
    proc = start_table(PORT, TABLE_KEY=KEY, GAMES_DIR=os.path.join(ROOT, "games"), PUBLIC_URL=BASE)
    try:
        with sync_playwright() as p:
            # Tables run Google Chrome; E2E_BROWSER=chrome (as in CI) uses it instead of Playwright's Chromium.
            channel = "chrome" if os.environ.get("E2E_BROWSER") == "chrome" else None
            browser = p.chromium.launch(channel=channel, args=["--autoplay-policy=no-user-gesture-required"])
            board = T.board(browser)
            board.wait_for_selector("button.tile")
            deck = phone(browser, "Klaus", 320, 568)
            pick_game(board, "ge150-pro")
            if board.locator(".dialog [data-x=yes]").count():
                board.locator(".dialog [data-x=yes]").click()
            time.sleep(0.4)
            deck.click("#ready")
            time.sleep(0.4)
            a("POST", "/game/start")
            st = a("GET", "/state")
            seat = next(x for x in st["players"] if x["name"] == "Klaus")["seat"]
            assert st["seatEdges"][seat] == "south", f"the player sits {st['seatEdges'][seat]}, not south"

            # The board connects by itself (a pedal granted before) and loads the presets.
            board.wait_for_selector(".gp-root")
            wait(lambda: board.locator(".gp-dot[data-state=on]").count(), 20, "the board to connect to the pedal")
            wait(lambda: "Preset 5" in board.locator(".gp-name").inner_text(), 10, "the board to show the current preset")
            assert board.locator(".gp-label").inner_text() == "2A", board.locator(".gp-label").inner_text()
            assert board.locator(".gp-notice").is_hidden(), "no notice once the pedal is connected and supported"
            if deck.locator("#tab-game").count():
                deck.locator("#tab-game").click()
            wait(lambda: "Preset 5" in deck.locator(".gd-name").inner_text(), 10, "the phone to show the current preset")
            shot(board, "board")
            check(deck, "phone Play")
            tabs = deck.locator(".gd-tabs").bounding_box()
            assert tabs and tabs["y"] + tabs["height"] <= 568 + 1, f"the game's tabs are on screen: {tabs}"
            shot(deck, "phone-play")

            # Edit on the board: DS on/off, then a fader of the open module (AMP).
            before = sent(board, 0x83)
            board.locator(".gp-power[data-power='1']").click()
            wait(lambda: sent(board, 0x83) > before, 5, "the pedal to receive the DS switch")
            on = board.evaluate("() => window.__pedal.state.live[1].on")
            assert on is True, "DS should be on after the tap (preset 5 has it off)"
            before = sent(board, 0x84)
            track = board.locator(".gp-f-track").first
            box = track.bounding_box()
            board.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.8)
            board.mouse.down()
            board.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.2, steps=8)
            board.mouse.up()
            wait(lambda: sent(board, 0x84) > before, 5, "the pedal to receive the AMP fader")
            time.sleep(0.3)  # the fader's last write (sends are throttled) has arrived
            amp = board.evaluate("() => window.__pedal.state.live[2].values[0]")
            assert amp > 50, f"the fader moved AMP's first value up, the pedal has {amp}"
            wait(lambda: board.locator(".gp-name").inner_text().endswith("*"), 5, "the board to mark unsaved changes")

            # Save configuration… on quick slot 1 and on the footswitch of 2A.
            board.locator(".gp-tab[data-tab=configs]").click()
            board.locator(".gp-capture").click()
            board.wait_for_selector(".gp-sheet")
            shot(board, "board-capture")
            board.locator(".gp-chip[data-opt=trigger]").click()
            board.locator(".gp-sheet .gp-yes").click()
            wait(lambda: board.locator(".gp-config").count() == 1, 5, "the configuration to appear on the board")
            wait(lambda: deck.locator(".gd-slot:not(.empty)").count() == 1, 5, "quick slot 1 on the phone")
            name = deck.locator(".gd-slot:not(.empty) b").inner_text()
            assert "2A" in name, f"the configuration's name names the preset: {name}"

            # The phone: ▶ selects 2B on the pedal; quick slot 1 recalls the configuration there.
            deck.locator(".gd-next").click()
            wait(lambda: board.evaluate("() => window.__pedal.state.current") == 6, 5, "the pedal to switch to 2B")
            wait(lambda: "Preset 6" in board.locator(".gp-name").inner_text(), 5, "the board to show 2B")
            wait(lambda: "Preset 6" in deck.locator(".gd-name").inner_text(), 5, "the phone to show 2B")
            before = sent(board, 0x83)
            deck.locator(".gd-slot:not(.empty)").click()
            wait(lambda: sent(board, 0x83) > before, 5, "the pedal to receive the recalled configuration")
            assert board.evaluate("() => window.__pedal.state.live[1].on") is True, "the configuration switches DS on"
            assert board.evaluate("() => window.__pedal.state.live[2].values[0]") == amp, "the configuration sets AMP's value"

            # The footswitch selects 2A on the pedal: the configuration triggered by it is applied.
            board.evaluate("() => window.__pedal.press(6)")  # (another preset first: 2B has DS off again)
            time.sleep(0.3)
            before = sent(board, 0x83)
            board.evaluate("() => window.__pedal.press(5)")
            wait(lambda: sent(board, 0x83) > before, 5, "the footswitch to apply the configuration")
            wait(lambda: "Preset 5" in deck.locator(".gd-name").inner_text(), 5, "the phone to follow the footswitch")

            # Rhythm: the pedal's drum machine by name, and the table's click.
            deck.locator(".gd-tab[data-tab=rhythm]").click()
            wait(lambda: "8 BEAT 4" in deck.locator(".gd-pr-style").inner_text(), 5, "the drum machine's style on the phone")
            assert "123 BPM" in deck.locator(".gd-pr-detail").inner_text(), deck.locator(".gd-pr-detail").inner_text()
            deck.locator(".gd-start").click()
            wait(lambda: deck.locator(".gd-start").inner_text() == "Stop", 5, "the click to start")
            stop = deck.evaluate("() => { const b = document.querySelector('.gd-start'); return [b.classList.contains('primary'), getComputedStyle(b).color]; }")
            assert stop[0] is False, f"a running click's Stop is not drawn as the primary action: {stop}"
            check(deck, "phone Rhythm")
            shot(deck, "phone-rhythm")
            deck.locator(".gd-start").click()

            # The Pedal tab, then Finish: it asks first.
            deck.locator(".gd-tab[data-tab=setup]").click()
            tabs_on = deck.evaluate("() => [...document.querySelectorAll('.gd-tab.on')].map((b) => b.dataset.tab)")
            assert tabs_on == ["setup"], f"the Pedal tab is the one marked: {tabs_on}"
            tabs = deck.locator(".gd-tabs").bounding_box()
            assert tabs["y"] + tabs["height"] > 568 - 90, f"the tabs sit at the bottom on a short page: {tabs}"
            check(deck, "phone Pedal")
            shot(deck, "phone-pedal")
            deck.locator(".gd-finish").click()
            assert deck.locator(".gd-confirm").is_visible(), "Finish asks first"
            deck.locator(".gd-keep").click()
            assert deck.locator(".gd-finish").is_visible()
            deck.locator(".gd-finish").click()
            deck.locator(".gd-end").click()
            wait(lambda: a("GET", "/state")["phase"] != "active", 10, "the game to end")
            shot(board, "board-end")

            assert not errors, f"browser errors: {errors}"
            assert not problems, "phone layout problems:\n  " + "\n  ".join(problems)
            print("ge150-pro: ok")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
