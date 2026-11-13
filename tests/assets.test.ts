// The protocol library the board and phone import (games/ge150-pro/assets/ge150.js) is the bundle of src/ge150/ as it
// is now: run `npm run build:assets` and commit the result after changing the library or its catalog.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bundle } from "../scripts/build-assets.mjs";
import { ROOT } from "./harness.ts";

describe("assets", () => {
  it("assets/ge150.js is the current build of src/ge150/", async () => {
    const committed = readFileSync(`${ROOT}/games/ge150-pro/assets/ge150.js`, "utf8");
    expect(committed === (await bundle()), "run npm run build:assets and commit games/ge150-pro/assets/ge150.js").toBe(true);
  });

  it("the bundle is a plain browser module: no imports left, the library's API exported", async () => {
    const js = readFileSync(`${ROOT}/games/ge150-pro/assets/ge150.js`, "utf8");
    expect(js).not.toMatch(/^\s*import\s/m);
    for (const name of ["GE150Pro", "catalog", "presetLabel", "styleName", "expLabel", "rawRange", "formatValue"]) expect(js).toMatch(new RegExp(`\\b${name}\\b`));
  });
});
