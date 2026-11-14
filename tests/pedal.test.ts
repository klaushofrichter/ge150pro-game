// The protocol library's WebHID device (src/ge150/device.ts) against the simulated pedal of the browser check
// (scripts/e2e/fake_pedal.js), in Node: the full connect sequence, a selection, module writes, the live-state read-back,
// a store and the footswitch. This keeps the simulation and the library honest with each other without a browser,
// so a protocol change that breaks either fails here first.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { GE150Pro } from "../src/ge150/device.ts";
import { PRESET_COUNT, type ModuleState, type Preset } from "../src/ge150/preset.ts";
import { ROOT } from "./harness.ts";

interface Fake {
  log: { cmd: number; payload: number[] }[];
  state: { current: number; live: ModuleState[] };
  press(index: number): void;
}

const g = globalThis as unknown as { window: unknown; __pedal: Fake };
const until = async (ok: () => boolean, ms = 2000) => {
  const end = Date.now() + ms;
  while (!ok()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

let dev: GE150Pro;
const presets = new Map<number, Preset>();
const currents: number[] = [];
const switched: number[] = [];
const stored: number[] = [];
const modules = new Map<number, ModuleState>();
let rhythmBpm = 0;
let expSeen = 0;

beforeAll(async () => {
  g.window = globalThis;
  new Function(readFileSync(`${ROOT}/scripts/e2e/fake_pedal.js`, "utf8"))();
  const d = await GE150Pro.previouslyGranted();
  if (!d) throw new Error("the simulated pedal was not offered");
  dev = d;
  dev.on("preset", (p) => presets.set(p.index, p));
  dev.on("current", (i) => currents.push(i));
  dev.on("switched", (i) => switched.push(i));
  dev.on("stored", (i) => stored.push(i));
  dev.on("module", (s, m) => modules.set(s, m));
  dev.on("rhythm", (r) => (rhythmBpm = r.bpm));
  dev.on("exp", () => expSeen++);
  dev.on("error", (e) => {
    throw e;
  });
  await dev.open();
  await until(() => presets.size === PRESET_COUNT && currents.length > 0);
});

const fake = () => g.__pedal;

describe("the library against the simulated pedal", () => {
  it("runs the editor's connect sequence and decodes every answer", () => {
    expect(fake().log.slice(0, 5).map((m) => m.cmd)).toEqual([0x31, 0xa0, 0xc1, 0x8c, 0xb0]);
    expect(presets.size).toBe(200);
    expect(presets.get(5)!.name.trim()).toBe("Preset 5");
    expect(presets.get(200)!.modules).toHaveLength(9);
    expect(currents.at(-1)).toBe(5);
    expect(rhythmBpm).toBe(123);
    expect(expSeen).toBeGreaterThanOrEqual(2);
    expect(modules.size).toBe(9);
  });

  it("selects a preset: the pedal switches and answers nothing, like the hardware", async () => {
    const before = currents.length;
    await dev.selectPreset(6);
    await new Promise((r) => setTimeout(r, 30));
    expect(fake().state.current).toBe(6);
    expect(currents.length).toBe(before); // no 16 and no 30 for a host selection
    expect(switched).toEqual([]);
  });

  it("writes a module and reads the live state back with B0", async () => {
    const m: ModuleState = { on: true, type: 2, values: [77, 1, 2, 3, 4, 5, 6, 7, 8, 9] };
    await dev.setModule(3, m);
    modules.clear();
    await dev.requestCurrent();
    await until(() => modules.size === 9);
    expect(modules.get(3)).toEqual(m);
    expect(fake().state.live[3]).toEqual(m);
  });

  it("stores a preset and gets the acknowledgement", async () => {
    const p = structuredClone(presets.get(6)!);
    p.modules[0] = { on: true, type: 1, values: [11, 22, 33, 0, 0, 0, 0, 0, 0, 0] };
    await dev.storePreset(p);
    await until(() => stored.includes(6));
    expect(fake().log.at(-1)!.cmd).toBe(0xc3);
  });

  it("reports a footswitch selection as switched (16), the board's trigger for configurations", async () => {
    fake().press(9);
    await until(() => switched.includes(9));
    expect(currents.at(-1)).toBe(9);
  });

  it("never sends a command outside the editor's observed set", () => {
    const observed = new Set([0x31, 0xa0, 0xc1, 0x8c, 0xb0, 0x96, 0x97, 0xc3, 0xb4, 0x98, 0xb3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8, 0xd1, 0xd2,
      ...Array.from({ length: 9 }, (_, s) => 0x82 + s)]);
    const sent = [...new Set(fake().log.map((m) => m.cmd))];
    expect(sent.filter((c) => !observed.has(c))).toEqual([]);
  });
});

describe("waiting for the pedal's answer", () => {
  it("readCurrent waits for its own answer, not one to an earlier request", async () => {
    let answers = 0;
    dev.on("module", (s) => s === 8 && answers++);
    dev.requestCurrent(); // unawaited, like the board after the connect check
    await dev.readCurrent();
    expect(answers).toBe(2);
  });
});
