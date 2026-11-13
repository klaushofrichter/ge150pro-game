# Guidance for Claude

This repository is the Game Table game `games/ge150-pro`: remote control for a Mooer GE150 Pro guitar pedal connected
to the table by USB, plus the protocol library it uses (`src/ge150/`). The protocol research, the web editor the
library comes from, and the full protocol specification live in the GE150PRO repository
(`klaushofrichter/GE150PRO`, private: `docs/protocol/README.md`, `AGENTS.md`).

## The game

- It follows games-service's developer guide,
  [`docs/developers/game-development.md`](https://github.com/klaushofrichter/games-service/blob/main/docs/developers/game-development.md)
  (also `https://games.skylar.technology/llms.txt`). Read it before changing the game: the platform owns the lobby,
  seats, joining, leaving, away phones and exchanging players; a game only reacts (`onSeatChanged`).
- Record decisions in `docs/decisions.md` (E-nnn) in the same pull request.
- Rules stay deterministic (`ctx.now()` is the only clock). The pedal is driven by the board only (E-002); the rules
  keep what the table shares and a command queue (E-003).
- A change in the game's folder takes a new calendar version:
  `node .games-service/scripts/check-game-versions.ts --base origin/main --fix`.
- After changing `src/ge150/` or its catalog, run `npm run build:assets` and commit
  `games/ge150-pro/assets/ge150.js`; `tests/assets.test.ts` fails until you do. A newer catalog comes from GE150PRO:
  `node scripts/import-catalog.mjs ../GE150PRO/src/lib/catalog.json`.
- Platform changes go to games-service (its session, or Slack #games-application), stay generic, and are avoided
  where the game can do without.

## The pedal

- Send only commands observed from Mooer's editor (GE150PRO's protocol spec lists them with evidence). Never send
  factory reset, firmware, `8B` or `BA` (they erase flash), and never try unknown command bytes or arguments.
- Writing a preset slot (`C3`) asks first in the UI. Keep it that way.
- The browser check uses a simulated pedal (`scripts/e2e/fake_pedal.js`); keep it answering like the hardware when the
  protocol use changes.

## Commands

```sh
npm ci && scripts/games-service.sh     # dependencies, games-service checkout (.games-service)
npm test && npm run typecheck          # unit tests (rules, library, bundle), types
python3 -m venv .venv && .venv/bin/pip install -r scripts/e2e/requirements.txt && .venv/bin/python -m playwright install chromium
PATH=$PWD/.venv/bin:$PATH scripts/e2e/run-all.sh e2e-out    # browser check with the simulated pedal
```

Node 26 (`engines`). Commits: Conventional Commits, ending with the Co-Authored-By and Claude-Session lines, no model
names. Branching: feature branch → PR into `main` → release PR `main` → `production` (tables use `production`).
