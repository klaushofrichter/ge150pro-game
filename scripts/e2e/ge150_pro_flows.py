"""Browser check for the GE150 Pro flows beyond the first session (scripts/e2e/ge150_pro.py covers that), on a real
games-service Table Host with the simulated pedal (fake_pedal.js):
  - Save… asks first; Cancel sends nothing; Save writes the preset slot (C3) and the unsaved mark goes away;
  - choosing another model in the model window changes the module's model on the pedal;
  - with the board closed, a phone command waits; a new board carries it out once, and a reload does not repeat it;
  - configurations kept on the phone come back in the next game;
  - a browser without WebHID says so on the board, without errors.
  python3 scripts/e2e/ge150_pro_flows.py out/
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
PORT = 8098
BASE = f"http://127.0.0.1:{PORT}"
KEY = "e2ekey"
T = TableCheck(BASE, KEY, OUT, "ge150-pro-flows", CHECK)
a, shot, phone = T.a, T.shot, T.phone
NO_HID = "Object.defineProperty(Navigator.prototype, 'hid', { configurable: true, get: () => undefined }); delete Navigator.prototype.hid;"


def open_board(browser, script=None, label="board"):
    return T.board(browser, label, script)


def start_game(board, deck):
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


def connected(board):
    wait(lambda: board.locator(".gp-dot[data-state=on]").count(), 20, "the board to connect to the pedal")
    wait(lambda: "Preset" in board.locator(".gp-name").inner_text(), 10, "the current preset on the board")


def main():
    proc = start_table(PORT, TABLE_KEY=KEY, GAMES_DIR=os.path.join(ROOT, "games"), PUBLIC_URL=BASE)
    try:
        with sync_playwright() as p:
            # Tables run Google Chrome; E2E_BROWSER=chrome (as in CI) uses it instead of Playwright's Chromium.
            channel = "chrome" if os.environ.get("E2E_BROWSER") == "chrome" else None
            browser = p.chromium.launch(channel=channel, args=["--autoplay-policy=no-user-gesture-required"])
            board = open_board(browser)
            board.wait_for_selector("button.tile")
            deck = phone(browser, "Klaus", 320, 568)
            start_game(board, deck)
            connected(board)

            # Save…: Cancel sends nothing; Save writes the slot and clears the unsaved mark.
            board.locator(".gp-power[data-power='1']").click()
            wait(lambda: board.locator(".gp-name").inner_text().endswith("*"), 5, "the unsaved mark")
            board.locator(".gp-save").click()
            board.wait_for_selector(".gp-sheet .gp-yes")
            assert "2A" in board.locator(".gp-sheet-title").inner_text(), "Save names the slot it overwrites"
            board.locator(".gp-sheet .gp-no").click()
            time.sleep(0.3)
            assert sent(board, 0xC3) == 0, "Cancel must not store"
            board.locator(".gp-save").click()
            board.locator(".gp-sheet .gp-yes").click()
            wait(lambda: sent(board, 0xC3) == 1, 5, "the pedal to receive the store")
            wait(lambda: not board.locator(".gp-name").inner_text().endswith("*"), 5, "the unsaved mark to go")
            stored = board.evaluate("() => window.__pedal.log.filter((m) => m.cmd === 0xc3)[0].payload[0]")
            assert stored == 5, f"Save wrote slot {stored}, not 2A (5)"

            # The model window: another model for the open module (AMP) on the pedal.
            board.locator(".gp-model").click()
            board.wait_for_selector(".gp-model-card")
            board.locator(".gp-model-card[data-type='7']").click()
            wait(lambda: board.evaluate("() => window.__pedal.state.live[2].type") == 7, 5, "the pedal to get the new AMP model")
            assert board.locator(".gp-sheet-wrap").is_hidden(), "the model window closes after a choice"
            shot(board, "board-model")

            # A configuration for the next game, on quick slot 1.
            board.locator(".gp-tab[data-tab=configs]").click()
            board.locator(".gp-capture").click()
            board.locator(".gp-sheet .gp-yes").click()
            wait(lambda: deck.locator(".gd-slot:not(.empty)").count() == 1, 5, "the configuration on the phone")
            config_name = deck.locator(".gd-slot:not(.empty) b").inner_text()

            # The board goes away; the phone's ▶ waits as a command; a new board carries it out once.
            board.context.close()
            deck.locator(".gd-next").click()
            time.sleep(0.5)
            board = open_board(browser, label="board 2")
            connected(board)
            wait(lambda: board.evaluate("() => window.__pedal.state.current") == 6, 10, "the waiting command on the new board's pedal")
            assert sent(board, 0x96) == 1, "the waiting selection is sent exactly once"
            time.sleep(0.5)
            board.reload()
            connected(board)
            time.sleep(1.0)
            assert sent(board, 0x96) == 0, "a reload repeats a command already carried out"

            # Finish; the next game brings the phone's configurations back.
            deck.locator(".gd-tab[data-tab=setup]").click()
            deck.locator(".gd-finish").click()
            deck.locator(".gd-end").click()
            wait(lambda: a("GET", "/state")["phase"] != "active", 10, "the game to end")
            a("POST", "/game/close", {})
            wait(lambda: a("GET", "/state")["phase"] == "idle", 10, "the lobby")
            board.wait_for_selector("button.tile")
            start_game(board, deck)
            connected(board)
            wait(lambda: deck.locator(".gd-slot:not(.empty)").count() == 1, 10, "the stored configuration in the next game")
            assert deck.locator(".gd-slot:not(.empty) b").inner_text() == config_name
            board.locator(".gp-tab[data-tab=configs]").click()
            wait(lambda: board.locator(".gp-config").count() == 1, 5, "the stored configuration on the board")

            # A browser without WebHID: the board says so, without errors.
            board.context.close()
            nohid = open_board(browser, NO_HID, label="board without WebHID")
            wait(lambda: "USB" in nohid.locator(".gp-conn-text").inner_text(), 10, "the board to say it cannot reach USB devices")
            shot(nohid, "board-no-webhid")

            assert not errors, f"browser errors: {errors}"
            print("ge150-pro flows: ok")
    finally:
        proc.terminate()


if __name__ == "__main__":
    main()
