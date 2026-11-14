// GE150 Pro's rules on games-service's own runtime: the board's pedal reports, commands from the phone carried out
// once, configurations (captured, edited, synced from the phone), the footswitch, the click, Finish, exact replay and
// a player exchanged mid-game.
import { describe, expect, it } from "vitest";
import { loadGame, replaysExactly, seats, start } from "./harness.ts";
import { PRESET_COUNT, SLOT_COUNT } from "../src/ge150/preset.ts";

const game = await loadGame("ge150-pro");
const one = () => ({ seats: seats(1) });
const names = Array.from({ length: PRESET_COUNT }, (_, i) => `Preset ${i + 1}`);
const chain = Array.from({ length: SLOT_COUNT }, (_, s) => ({ on: s % 2 === 0, type: s }));
const snap = (on: boolean, type: number, first = 50) => ({ on, type, values: [first, 50, 50, 0, 0, 0, 0, 0, 0, 0] });
const config = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: `Config ${id}`, slot: null, trigger: null, preset: null, modules: { "2": snap(true, 6, 77) }, ...extra });
const wait = (clock: { setTimeout(fn: () => void, ms: number): unknown; advance(): boolean }, ms: number) => {
  clock.setTimeout(() => {}, ms);
  clock.advance();
};

function connected() {
  const g = start(game, 1, {}, 1, one());
  expect(g.rt.submit(0, { name: "pedal", payload: { connected: true, text: "Connected", current: 5, names, chain, modified: false } }, "board")).toEqual({ ok: true });
  return g;
}

describe("GE150 Pro", () => {
  it("starts without a pedal, the same view for the board and the phone", () => {
    const { rt } = start(game, 1, {}, 1, one());
    expect(rt.boardView()).toMatchObject({ seat: 0, done: false, pedal: { connected: false, current: 0 }, configs: [], commands: [] });
    expect(rt.view(0)).toEqual(rt.boardView());
  });

  it("counts presets and modules as the library does (the rules keep their own copy of the numbers)", () => {
    // the board sends what the library decodes: a list of PRESET_COUNT names and a chain of SLOT_COUNT modules
    const { rt } = connected();
    expect((rt.boardView() as any).pedal.names).toHaveLength(PRESET_COUNT);
    expect((rt.boardView() as any).pedal.chain).toHaveLength(SLOT_COUNT);
    expect(rt.submit(0, { name: "pedal", payload: { names: [...names, "one more"] } }, "board")).toMatchObject({ ok: false });
    expect(rt.submit(0, { name: "pedal", payload: { chain: chain.slice(1) } }, "board")).toMatchObject({ ok: false });
  });

  it("takes the board's reports about the pedal, field by field, and refuses broken ones", () => {
    const { rt } = connected();
    expect(rt.boardView()).toMatchObject({ pedal: { connected: true, current: 5, chain } });
    expect((rt.boardView() as any).pedal.names[4]).toBe("Preset 5");
    rt.submit(0, { name: "pedal", payload: { rhythm: { playing: true, mode: 0, style: 3, volume: 8, bpm: 123 }, exp: { label: "REV · PRE DELAY", value: "144" } } }, "board");
    expect(rt.boardView()).toMatchObject({ pedal: { rhythm: { bpm: 123, style: 3 }, exp: { value: "144" }, current: 5 } });
    rt.submit(0, { name: "pedal", payload: { name: "Lead" } }, "board");
    expect((rt.boardView() as any).pedal.names[4]).toBe("Lead");
    for (const payload of [{ current: 0 }, { current: 201 }, { names: ["x"] }, { chain: [{ on: true }] }, { connected: "yes" }]) {
      const r = rt.submit(0, { name: "pedal", payload }, "board");
      expect(r.ok, JSON.stringify(payload)).toBe(false);
    }
  });

  it("queues the phone's commands for the board, which acknowledges them once done", () => {
    const { rt } = connected();
    expect(rt.submit(0, { name: "select", payload: { step: 1 } }, "human")).toEqual({ ok: true });
    expect(rt.submit(0, { name: "select", payload: { step: -6 } }, "human")).toEqual({ ok: true });
    expect(rt.submit(0, { name: "select", payload: { index: 200 } }, "human")).toEqual({ ok: true });
    const v = rt.boardView() as any;
    expect(v.commands.map((c: any) => [c.n, c.index])).toEqual([[1, 6], [2, 200], [3, 200]]);
    expect(v.pedal.current).toBe(200);
    expect(rt.submit(0, { name: "done", payload: { n: 2 } }, "board")).toEqual({ ok: true });
    expect((rt.boardView() as any).commands.map((c: any) => c.n)).toEqual([3]);
  });

  it("wraps around the 200 presets", () => {
    const { rt } = connected();
    rt.submit(0, { name: "select", payload: { index: 200 } }, "human");
    rt.submit(0, { name: "select", payload: { step: 1 } }, "human");
    expect((rt.boardView() as any).pedal.current).toBe(1);
  });

  it("refuses commands while the pedal is not connected", () => {
    const { rt } = start(game, 1, {}, 1, one());
    const r = rt.submit(0, { name: "select", payload: { step: 1 } }, "human");
    expect(r).toEqual({ ok: false, reason: "The pedal is not connected" });
  });

  it("keeps configurations: captured on the board, recalled from the phone, one per quick slot and trigger", () => {
    const { rt } = connected();
    expect(rt.submit(0, { name: "capture", payload: { config: config("a", { slot: 0, trigger: 5 }) } }, "board")).toEqual({ ok: true });
    expect(rt.submit(0, { name: "capture", payload: { config: config("b", { slot: 0 }) } }, "board")).toEqual({ ok: true });
    let v = rt.boardView() as any;
    // b took quick slot 1 from a; a keeps its trigger
    expect(v.configs.map((c: any) => [c.id, c.slot, c.trigger])).toEqual([["a", null, 5], ["b", 0, null]]);
    expect(rt.submit(0, { name: "edit", payload: { id: "a", name: "Solo", slot: 1 } }, "human")).toEqual({ ok: true });
    expect(rt.submit(0, { name: "apply", payload: { id: "a" } }, "human")).toEqual({ ok: true });
    v = rt.boardView() as any;
    expect(v.configs[0]).toMatchObject({ id: "a", name: "Solo", slot: 1 });
    expect(v.commands.at(-1)).toMatchObject({ kind: "apply", config: { id: "a", name: "Solo" } });
    expect(rt.submit(0, { name: "edit", payload: { id: "b", remove: true } }, "human")).toEqual({ ok: true });
    expect((rt.boardView() as any).configs.map((c: any) => c.id)).toEqual(["a"]);
  });

  it("refuses malformed configurations and edits with words for people", () => {
    const { rt } = connected();
    for (const intent of [
      { name: "capture", payload: { config: { id: "../x", modules: {} } } },
      { name: "capture", payload: { config: config("c", { modules: { "9": snap(true, 1) } }) } },
      { name: "capture", payload: { config: config("c", { modules: { "1": { on: true, type: 1, values: [1] } } }) } },
      { name: "capture", payload: { config: config("c", { slot: 8 }) } },
      { name: "edit", payload: { id: "nope" } },
      { name: "apply", payload: { id: "nope" } },
      { name: "click", payload: { bpm: 1000 } },
      { name: "dance", payload: null },
    ]) {
      const r = rt.submit(0, intent, "human");
      expect(r.ok, JSON.stringify(intent)).toBe(false);
      if (!r.ok) expect(r.reason).toMatch(/^[A-Z]/);
    }
  });

  it("takes the phone's stored configurations once, keeping the ones made before", () => {
    const { rt } = connected();
    rt.submit(0, { name: "capture", payload: { config: config("new", { slot: 2 }) } }, "board");
    expect(rt.submit(0, { name: "configs", payload: { list: [config("old", { slot: 2, trigger: 7 }), config("new"), { bad: true }] } }, "human")).toEqual({ ok: true });
    const v = rt.boardView() as any;
    expect(v.synced).toBe(true);
    expect(v.configs.map((c: any) => [c.id, c.slot, c.trigger])).toEqual([["new", 2, null], ["old", null, 7]]);
    rt.submit(0, { name: "configs", payload: { list: [config("late")] } }, "human");
    expect((rt.boardView() as any).configs).toHaveLength(2);
  });

  it("counts footswitch selections and the configurations they applied", () => {
    const { rt } = connected();
    rt.submit(0, { name: "capture", payload: { config: config("a", { trigger: 9 }) } }, "board");
    expect(rt.submit(0, { name: "switched", payload: { index: 9, config: "a" } }, "board")).toEqual({ ok: true });
    expect(rt.submit(0, { name: "switched", payload: { index: 10 } }, "board")).toEqual({ ok: true });
    expect((rt.boardView() as any).pedal.current).toBe(10);
    expect((rt.state as any).stats).toMatchObject({ switched: 2, applied: 1 });
  });

  it("runs the table's click: start counts a run, tempo and beats in range", () => {
    const { rt } = connected();
    expect(rt.submit(0, { name: "click", payload: { on: true, bpm: 96, beats: 3, follow: false } }, "human")).toEqual({ ok: true });
    expect((rt.boardView() as any).click).toEqual({ on: true, bpm: 96, beats: 3, follow: false, run: 1 });
    rt.submit(0, { name: "click", payload: { bpm: 120 } }, "human");
    expect((rt.boardView() as any).click).toMatchObject({ on: true, bpm: 120, run: 1 });
    rt.submit(0, { name: "click", payload: { on: false } }, "human");
    rt.submit(0, { name: "click", payload: { on: true } }, "human");
    expect((rt.boardView() as any).click.run).toBe(2);
  });

  it("ends on Finish with a summary, stops the click, and replays exactly", () => {
    const { rt, clock } = connected();
    rt.submit(0, { name: "capture", payload: { config: config("a", { slot: 0 }) } }, "board");
    rt.submit(0, { name: "click", payload: { on: true } }, "human");
    wait(clock, 4 * 60_000);
    rt.submit(0, { name: "apply", payload: { id: "a" } }, "human");
    rt.submit(0, { name: "apply", payload: { id: "a" } }, "human");
    wait(clock, 60_000);
    expect(rt.submit(0, { name: "finish", payload: {} }, "human")).toEqual({ ok: true });
    expect(rt.over).toBe(true);
    const over = game.def.isOver(rt.state) as any;
    expect(over.text).toBe("Ann played for five minutes and recalled two configurations from the phone, saved one new configuration.");
    expect((rt.boardView() as any).click.on).toBe(false);
    expect(replaysExactly(game, rt)).toBe(true);
  });

  it("starts over with the new player's own configurations when the seat changes hands", () => {
    const { rt } = connected();
    rt.submit(0, { name: "capture", payload: { config: config("a") } }, "board");
    rt.seatChanged({ seat: 0, playerId: "p9", name: "Zoe", kind: "human", edge: "south" });
    const st = rt.state as any;
    expect(st.player).toBe("Zoe");
    expect(st.configs).toEqual([]);
    expect(st.synced).toBe(false);
  });
});

describe("what the rules share with the protocol library", () => {
  it("labels presets as the library does (the rules cannot import it: tables get only games/)", async () => {
    const { presetLabel: rulesLabel } = await import("../games/ge150-pro/rules.ts");
    const { presetLabel } = await import("../src/ge150/preset.ts");
    for (let i = 1; i <= 200; i++) expect(rulesLabel(i)).toBe(presetLabel(i));
  });

  it("gives board and phone the click's tempo: the drum machine's when following it, else its own", () => {
    const { rt } = connected();
    rt.submit(0, { name: "pedal", payload: { rhythm: { playing: true, mode: 0, style: 3, volume: 8, bpm: 123 } } }, "board");
    rt.submit(0, { name: "click", payload: { bpm: 96, follow: true } }, "human");
    expect((rt.boardView() as any).tempo).toBe(123);
    rt.submit(0, { name: "click", payload: { follow: false } }, "human");
    expect((rt.boardView() as any).tempo).toBe(96);
    expect((rt.view(0) as any).quickSlots).toBe(8);
  });
});
