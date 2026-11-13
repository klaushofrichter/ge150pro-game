// Robustness of the rules for unattended releases: seeded random sessions of valid and broken intents from the board
// and the phone never throw, keep the game's limits, show the board and the phone the same view, and replay exactly.
// And the UIs only send intents the rules know (the board only ones its manifest allows), so a renamed intent fails
// here, not on a table.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createRng } from "../.games-service/packages/sdk/src/index.ts";
import { loadGame, replaysExactly, ROOT, seats, start } from "./harness.ts";

const game = await loadGame("ge150-pro");
const names = Array.from({ length: 200 }, (_, i) => `P${i + 1}`);

/** One random intent: mostly well-formed, some broken, from the board or the phone. */
function randomIntent(r: () => number, ids: string[]) {
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const junk = () => pick<unknown>([null, -1, 1e9, "x", {}, [], 3.5, true]);
  const snap = () => ({ on: r() < 0.5, type: int(0, 20), values: Array.from({ length: 10 }, () => int(0, 300)) });
  const config = () => ({
    id: pick([`c${int(0, 40)}`, "../bad", ""]),
    name: pick(["Solo", "Clean", "x".repeat(60), "\u0000ctl"]),
    slot: pick([null, int(0, 7), int(8, 9)]),
    trigger: pick([null, int(1, 200), 0, 201]),
    preset: pick([null, int(1, 200)]),
    modules: r() < 0.9 ? { [String(int(0, 8))]: snap(), [String(int(0, 8))]: snap() } : { "12": snap() },
  });
  const id = () => (ids.length && r() < 0.8 ? pick(ids) : `c${int(0, 40)}`);
  const choices: [string, () => unknown, "board" | "human"][] = [
    ["pedal", () => ({ connected: r() < 0.9, current: int(1, 200), chain: Array.from({ length: 9 }, () => ({ on: r() < 0.5, type: int(0, 30) })), modified: r() < 0.5 }), "board"],
    ["pedal", () => ({ names }), "board"],
    ["pedal", () => ({ rhythm: { playing: r() < 0.5, mode: int(0, 1), style: int(0, 39), volume: int(0, 10), bpm: int(40, 260) }, exp: { label: "REV · P", value: String(int(0, 500)) } }), "board"],
    ["pedal", () => ({ current: junk(), chain: junk() }), "board"],
    ["capture", () => ({ config: config() }), "board"],
    ["edit", () => pick([{ id: id(), name: "N" }, { id: id(), slot: int(0, 7) }, { id: id(), trigger: int(1, 200) }, { id: id(), remove: true }, { id: id(), slot: junk() }]), pick(["board", "human"])],
    ["apply", () => ({ id: id() }), pick(["board", "human"])],
    ["select", () => pick([{ step: int(-3, 3) }, { index: int(1, 200) }, { index: junk() }]), pick(["board", "human"])],
    ["done", () => ({ n: pick([int(1, 60), junk()]) }), "board"],
    ["switched", () => ({ index: int(1, 200), config: id() }), "board"],
    ["click", () => pick([{ on: r() < 0.5 }, { bpm: int(20, 320) }, { beats: int(0, 13) }, { follow: r() < 0.5 }]), "human"],
    ["configs", () => ({ list: Array.from({ length: int(0, 40) }, config) }), "human"],
    [pick(["dance", "", "pedal "]), () => junk(), "human"],
  ];
  const [name, payload, by] = pick(choices);
  return { intent: { name, payload: payload() }, by };
}

function invariants(st: any) {
  expect(() => JSON.parse(JSON.stringify(st))).not.toThrow();
  expect(st.configs.length).toBeLessThanOrEqual(32);
  expect(st.commands.length).toBeLessThanOrEqual(16);
  const slots = st.configs.map((c: any) => c.slot).filter((s: any) => s !== null);
  const triggers = st.configs.map((c: any) => c.trigger).filter((t: any) => t !== null);
  expect(new Set(slots).size).toBe(slots.length);
  expect(new Set(triggers).size).toBe(triggers.length);
  expect(new Set(st.configs.map((c: any) => c.id)).size).toBe(st.configs.length);
  for (const c of st.configs) {
    expect(c.name.length).toBeLessThanOrEqual(24);
    for (const m of Object.values(c.modules) as any[]) expect(m.values).toHaveLength(10);
  }
  expect(st.pedal.names).toHaveLength(200);
  expect(st.click.bpm).toBeGreaterThanOrEqual(30);
  expect(st.click.bpm).toBeLessThanOrEqual(300);
  const ns = st.commands.map((c: any) => c.n);
  expect([...ns].sort((a: number, b: number) => a - b)).toEqual(ns);
}

describe("random sessions", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`seed ${seed}: 400 random intents keep the limits and replay exactly`, () => {
      const { rt, clock } = start(game, 1, {}, seed, { seats: seats(1) });
      const rng = createRng(seed * 7919);
      for (let i = 0; i < 400; i++) {
        const ids = (rt.state as any).configs.map((c: any) => c.id);
        const { intent, by } = randomIntent(rng, ids);
        const res = rt.submit(0, intent as any, by);
        if (!res.ok) expect(res.reason, JSON.stringify(intent)).toMatch(/^[A-Z]/);
        if (i % 50 === 0) {
          clock.setTimeout(() => {}, 30_000);
          clock.advance();
        }
        invariants(rt.state);
        expect(rt.view(0)).toEqual(rt.boardView());
      }
      expect(rt.submit(0, { name: "finish", payload: {} }, "human")).toEqual({ ok: true });
      expect(rt.over).toBe(true);
      expect(typeof (game.def.isOver(rt.state) as any).text).toBe("string");
      expect(replaysExactly(game, rt)).toBe(true);
    });
  }
});

describe("the UIs send only intents the rules know", () => {
  const read = (f: string) => readFileSync(`${ROOT}/games/ge150-pro/${f}`, "utf8");
  const sentBy = (src: string, fn: RegExp) => [...new Set([...src.matchAll(fn)].map((m) => m[1]))].sort();
  const board = sentBy(read("board.js"), /ctx\.act\(\s*[^,]+,\s*"([a-z-]+)"/g);
  const deck = sentBy(read("deck.js"), /(?:ctx\.send|\bsend)\(\s*"([a-z-]+)"/g);

  it("finds the intents in the source (the scan works)", () => {
    expect(board).toEqual(expect.arrayContaining(["pedal", "done", "capture", "switched", "edit"]));
    expect(deck).toEqual(expect.arrayContaining(["select", "apply", "click", "configs", "finish", "edit"]));
  });

  it("the board sends only intents its manifest lists in boardIntents", () => {
    for (const n of board) expect(game.manifest.boardIntents, n).toContain(n);
  });

  it("the rules know every intent the board and the phone send", () => {
    for (const n of [...board, ...deck]) {
      const { rt } = start(game, 1, {}, 1, { seats: seats(1) });
      const r = rt.submit(0, { name: n, payload: {} }, game.manifest.boardIntents.includes(n) ? "board" : "human");
      if (!r.ok) expect(r.reason, n).not.toBe("Not something this game knows");
    }
  });
});
