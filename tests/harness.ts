// Runs this repository's games on games-service's own runtime (in .games-service, see scripts/games-service.sh),
// so the tests exercise exactly the code a table runs: the runtime, replay, the simulation loop and the host.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { manifestSchema, seatEdges, type Manifest, type SeatLayout } from "../.games-service/packages/protocol/src/index.ts";
import type { GameDefinition, SeatInfo } from "../.games-service/packages/sdk/src/index.ts";
import { GameRuntime, replay, VirtualClock } from "../.games-service/apps/table-host/src/runtime.ts";
import { settingsWithDefaults } from "../.games-service/apps/table-host/src/games.ts";

export { replay, GameRuntime, VirtualClock, manifestSchema, settingsWithDefaults };
export type { Manifest, SeatInfo, GameDefinition };

export const ROOT = join(import.meta.dirname, "..");
export const GAMES_DIR = join(ROOT, "games");

export interface Game {
  manifest: Manifest;
  def: GameDefinition<any>;
}

export async function loadGame(id: string): Promise<Game> {
  const dir = join(GAMES_DIR, id);
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")));
  const def = (await import(join(dir, "rules.ts"))).default;
  return { manifest, def };
}

const NAMES = ["Ann", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus", "Hal"];

/** n seats in the smallest layout that fits, with the edges a table would give them. */
export function seats(n: number, kind: "human" | "ai" = "human", layout?: SeatLayout): SeatInfo[] {
  const edges = seatEdges(layout ?? ((n <= 2 ? 2 : n <= 4 ? 4 : n <= 6 ? 6 : 8) as SeatLayout));
  return Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `p${i}`, name: NAMES[i], kind, edge: edges[i] }));
}

/** A running game with virtual time. */
export function start(game: Game, n: number, settings: Record<string, unknown> = {}, seed = 1, o: { aiOptions?: Record<number, Record<string, unknown>>; seats?: SeatInfo[] } = {}) {
  const clock = new VirtualClock();
  const rt = new GameRuntime(game.manifest, game.def, seed, settingsWithDefaults(game.manifest, settings), o.seats ?? seats(n), clock, { aiOptions: o.aiOptions ?? {} });
  return { rt, clock, state: () => rt.state as any };
}

/**
 * Play AI moves with `choose` (from the seat's view) until the game ends, firing timers whenever the phase is not
 * `playing` (between rounds).
 */
export function playOut(rt: GameRuntime, clock: VirtualClock, choose: (view: any) => unknown, cap = 40000) {
  for (let guard = 0; !rt.over && guard < cap; guard++) {
    const st = rt.state as { phase: string; turn: number };
    if (st.phase !== "playing") {
      clock.advance();
      continue;
    }
    const m = choose(rt.view(st.turn));
    if (!m) throw new Error("the AI found no move");
    const r = rt.submit(st.turn, m as any, "ai");
    if (r && r.ok === false) throw new Error(`the AI's move was refused: ${r.reason}`);
  }
}

/** The game's last log record replays to the same state hash. */
export function replaysExactly(game: Game, rt: GameRuntime) {
  const end = rt.log.at(-1) as { t: string; stateHash?: string };
  if (end.t !== "end") throw new Error("game did not end");
  return replay(game.manifest, game.def, rt.log) === end.stateHash;
}
