// The connect check (src/ge150/compat.ts, E-013): the game controls only a pedal whose answers to the connect sequence
// are those of the supported firmware (V2.1.2, and V2.1.4 with the same command set). Run against the simulated pedal
// as the supported firmware and as one that answers differently, and on hand-made answers.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConnectCheck, MIN_FIRMWARE, type CompatResult } from "../src/ge150/compat.ts";
import { GE150Pro } from "../src/ge150/device.ts";
import { ROOT } from "./harness.ts";

const fakeSource = readFileSync(`${ROOT}/scripts/e2e/fake_pedal.js`, "utf8");

/** Connects the library to a fresh simulated pedal and returns the device and its connect check's outcome. */
async function connectTo(options: Record<string, unknown>) {
  const g = globalThis as unknown as { window: unknown; __fakePedalOptions: unknown };
  g.window = globalThis;
  g.__fakePedalOptions = options;
  new Function(fakeSource)();
  const dev = (await GE150Pro.previouslyGranted())!;
  const checked = new Promise<CompatResult>((r) => dev.on("checked", r));
  await dev.open();
  return { dev, result: await checked };
}

describe("the connect check", () => {
  it("names the oldest supported firmware", () => {
    expect(MIN_FIRMWARE).toBe("V2.1.2");
  });

  it("accepts the supported firmware's answers, and then allows writes", async () => {
    const { dev, result } = await connectTo({});
    expect(result).toEqual({ ok: true, missing: [], wrong: [] });
    expect(dev.supported).toBe(true);
    await expect(dev.selectPreset(6)).resolves.toBeUndefined();
  });

  it("refuses a firmware that answers with other sizes, naming what differs, and refuses every write", async () => {
    const { dev, result } = await connectTo({ firmware: "other" });
    expect(result.ok).toBe(false);
    expect(result.wrong).toEqual(["drum machine: 7 bytes, expected 6"]);
    expect(dev.supported).toBe(false);
    const sent = () => (globalThis as unknown as { __pedal: { log: { cmd: number }[] } }).__pedal.log.length;
    const before = sent();
    await expect(dev.selectPreset(6)).rejects.toThrow(/not supported/);
    await expect(dev.setModule(0, { on: true, type: 0, values: Array(10).fill(0) })).rejects.toThrow(/not supported/);
    expect(sent()).toBe(before);
  });

  it("lists what is missing while answers are still out (or never come)", () => {
    const c = new ConnectCheck();
    c.push({ cmd: 0x32, payload: new Uint8Array(12) });
    for (let i = 0; i < 199; i++) c.push({ cmd: 0x20, payload: new Uint8Array(245) });
    c.push({ cmd: 0x34, payload: new Uint8Array(1) }); // pages are not part of the check
    const r = c.result();
    expect(r.ok).toBe(false);
    expect(r.wrong).toEqual([]);
    expect(r.missing).toContain("preset dump (199 of 200)");
    expect(r.missing).toContain("drum machine");
    expect(r.missing).not.toContain("system settings");
  });
});

describe("the stated requirement (E-015)", () => {
  const read = (f: string) => readFileSync(`${ROOT}/games/ge150-pro/${f}`, "utf8");
  const needs = `${MIN_FIRMWARE} or newer`;

  it("every place that names the required firmware names the library's minimum", () => {
    const manifest = JSON.parse(read("manifest.json"));
    expect(manifest.description).toContain("GE150 Pro");
    expect(manifest.description).toContain(`firmware ${needs}`);
    expect(read("how-to-play.md")).toContain(needs);
    expect(read("deck.js")).toContain(needs);
    expect(read("board.js")).toContain(`const MIN_FIRMWARE = "${MIN_FIRMWARE}";`);
  });
});
