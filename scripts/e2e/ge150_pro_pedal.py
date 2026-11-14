"""Browser check for the pedal's states (E-013) on a real games-service Table Host with the simulated pedal:
  - no pedal at the start: board and phone say how to connect it; plugged in later, the board connects by itself;
  - a pedal in use by another program: the board says to close Mooer's editor;
  - a pedal with an unsupported firmware: the board and the phone say so, nothing is written to it, the board's
    controls stay off and the phone's commands are refused;
  - unplugged during the game: the board and the phone say so, the phone's commands are refused, and plugged in again
    the board connects by itself and the game goes on.
  python3 scripts/e2e/ge150_pro_pedal.py out/
"""
import os, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, ".games-service", "scripts", "e2e"))
from playwright.sync_api import sync_playwright  # noqa: E402
from common import errors, pick_game, start_table, wait  # noqa: E402
from game_check import CHECK, TableCheck  # noqa: E402

OUT = sys.argv[1] if len(sys.argv) > 1 else "e2e-out"
os.makedirs(OUT, exist_ok=True)
PORT = 8099
BASE = f"http://127.0.0.1:{PORT}"
KEY = "e2ekey"
T = TableCheck(BASE, KEY, OUT, "ge150-pro-pedal", CHECK)
a, shot, phone = T.a, T.shot, T.phone
# Writes to the pedal: anything but the connect sequence's read-only requests.
WRITES = "() => window.__pedal.log.filter((m) => ![0x31, 0xa0, 0xc1, 0x8c, 0xb0].includes(m.cmd)).length"


def board_with(browser, label, **options):
    page = T.board(browser, label, **options)
    page.wait_for_selector(".gp-root, button.tile")
    return page


def conn(board):
    """What the board says about the pedal: the notice panel's full text while it is not ready."""
    n = board.locator(".gp-notice")
    return n.inner_text() if n.is_visible() else board.locator(".gp-conn-text").inner_text()


def phone_status(deck):
    deck.locator(".gd-tab[data-tab=setup]").click()
    return deck.locator(".gd-status-text").inner_text()


def main():
    proc = start_table(PORT, TABLE_KEY=KEY, GAMES_DIR=os.path.join(ROOT, "games"), PUBLIC_URL=BASE)
    try:
        with sync_playwright() as p:
            channel = "chrome" if os.environ.get("E2E_BROWSER") == "chrome" else None
            browser = p.chromium.launch(channel=channel, args=["--autoplay-policy=no-user-gesture-required"])

            # No pedal at the start.
            board = board_with(browser, "board (no pedal)", absent=True)
            deck = phone(browser, "Klaus", 320, 568)
            pick_game(board, "ge150-pro")
            if board.locator(".dialog [data-x=yes]").count():
                board.locator(".dialog [data-x=yes]").click()
            time.sleep(0.4)
            deck.click("#ready")
            time.sleep(0.4)
            a("POST", "/game/start")
            board.wait_for_selector(".gp-root")
            if deck.locator("#tab-game").count():
                deck.locator("#tab-game").click()
            wait(lambda: "No pedal" in conn(board), 10, "the board to say there is no pedal")
            assert board.locator(".gp-connect").is_visible(), "Connect pedal is offered in the bar"
            assert board.locator(".gp-notice-connect").is_visible(), "and in the notice panel"
            req = board.locator(".gp-req").inner_text()
            assert "GE150 Pro" in req and "V2.1.2 or newer" in req, f"the notice names the required device and firmware: {req}"
            deck.locator(".gd-tab[data-tab=setup]").click()
            assert "V2.1.2 or newer" in deck.locator(".gd-req").inner_text(), "the phone names the required firmware"
            wait(lambda: "No pedal" in phone_status(deck), 5, "the phone to say there is no pedal")
            shot(board, "no-pedal")
            # plugged in: the board connects by itself
            board.evaluate("() => window.__pedal.plug()")
            wait(lambda: board.locator(".gp-dot[data-state=on]").count(), 20, "the board to connect when the pedal is plugged in")
            wait(lambda: phone_status(deck).startswith("Connected"), 5, "the phone to see the pedal")

            # Unplugged during the game, then plugged in again.
            board.evaluate("() => window.__pedal.unplug()")
            wait(lambda: "disconnected" in conn(board), 5, "the board to say the pedal was disconnected")
            wait(lambda: "disconnected" in phone_status(deck), 5, "the phone to say the pedal was disconnected")
            deck.locator(".gd-tab[data-tab=play]").click()
            assert deck.locator(".gd-next").is_disabled(), "the phone's ◀ ▶ are off without a pedal"
            assert board.locator(".gp-power[data-power='0']").is_disabled(), "the board's controls are off without a pedal"
            board.evaluate("() => window.__pedal.plug()")
            wait(lambda: board.locator(".gp-dot[data-state=on]").count(), 20, "the board to reconnect by itself")
            deck.locator(".gd-next").click()
            wait(lambda: board.evaluate("() => window.__pedal.state.current") == 6, 5, "the game to go on after reconnecting")
            board.context.close()

            # An unsupported firmware: said on board and phone, nothing written, controls off.
            board = board_with(browser, "board (other firmware)", firmware="other")
            wait(lambda: "not supported" in conn(board), 15, "the board to refuse the firmware")
            assert "V2.1.2 or newer" in conn(board), conn(board)
            assert board.locator(".gp-notice-title").inner_text() == "Firmware not supported"
            assert board.locator(".gp-notice-connect").is_hidden(), "no Connect pedal for a pedal that is connected but unsupported"
            assert board.locator(".gp-faders").is_hidden(), "no faders for an unsupported pedal"
            assert board.locator(".gp-req").is_visible(), "the requirements are shown with the refusal"
            wait(lambda: "not supported" in phone_status(deck), 5, "the phone to say the firmware is not supported")
            deck.locator(".gd-tab[data-tab=play]").click()
            assert deck.locator(".gd-next").is_disabled(), "the phone's ◀ ▶ are off for an unsupported pedal"
            board.locator(".gp-power[data-power='0']").click(force=True)
            time.sleep(0.5)
            assert board.evaluate(WRITES) == 0, "nothing may be written to an unsupported pedal"
            shot(board, "unsupported")
            board.context.close()

            # A pedal in use by another program.
            board = board_with(browser, "board (busy)", busy=True)
            wait(lambda: "Pedal in use" in conn(board) and "Mooer's editor" in conn(board), 15, "the board to say the pedal is busy")
            shot(board, "busy")

            assert not errors, f"browser errors: {errors}"
            print("ge150-pro pedal states: ok")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
