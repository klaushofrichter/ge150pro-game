// The connect check (src/ge150/compat.ts, E-013): the game controls only a pedal whose answers to the connect sequence
// are those of the supported firmware (V2.1.2, and V2.1.4 with the same command set). Run against the simulated pedal
// as the supported firmware and as one that answers differently, and on hand-made answers.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConnectCheck, MIN_FIRMWARE } from "../src/ge150/compat.ts";
import { GE150Pro } from "../src/ge150/device.ts";
import { ROOT } from "./harness.ts";

const fakeSource = readFileSync(`${ROOT}/scripts/e2e/fake_pedal.js`, "utf8");

/** Connects the library to a fresh simulated pedal and returns the check's result once it decides. */
async function connectTo(options: Record<string, unknown>) {
  const g = globalThis as unknown as { window: unknown; __fakePedalOptions: unknown };
  g.window = globalThis;
  g.__fakePedalOptions = options;
  new Function(fakeSource)();
  const dev = (await GE150Pro.previouslyGranted())!;
  const check = new ConnectCheck();
  let decided: ReturnType<ConnectCheck["result"]> | null = null;
  dev.on("message", (m, dir) => {
    if (dir !== "in" || decided) return;
    check.push(m);
    const r = check.result();
    if (r.ok || r.wrong.length) decided = r;
  });
  await dev.open();
  const end = Date.now() + 3000;
  while (!decided && Date.now() < end) await new Promise((r) => setTimeout(r, 5));
  return decided ?? check.result();
}

describe("the connect check", () => {
  it("names the oldest supported firmware", () => {
    expect(MIN_FIRMWARE).toBe("V2.1.2");
  });

  it("accepts the supported firmware's answers", async () => {
    const r = await connectTo({});
    expect(r).toEqual({ ok: true, missing: [], wrong: [] });
  });

  it("refuses a firmware that answers with other sizes, naming what differs", async () => {
    const r = await connectTo({ firmware: "other" });
    expect(r.ok).toBe(false);
    expect(r.wrong).toEqual(["drum machine: 7 bytes, expected 6"]);
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
