// Imports the model catalog from the GE150PRO repository (klaushofrichter/GE150PRO, private: the protocol research
// and the web editor) into src/ge150/catalog.json: model names and parameter specs with their value positions, without
// the manual's model descriptions. Usage: node scripts/import-catalog.mjs ../GE150PRO/src/lib/catalog.json
// (build it there first with `npm run catalog`). Commit the result, then `npm run build:assets`.
import { readFileSync, writeFileSync } from "node:fs";

const src = process.argv[2];
if (!src) throw new Error("usage: node scripts/import-catalog.mjs <GE150PRO>/src/lib/catalog.json");
const full = JSON.parse(readFileSync(src, "utf8"));
const slots = full.slots.map((s) => ({
  name: s.name,
  models: s.models.map((m) => ({ index: m.index, name: m.name, params: m.params })),
}));
const out = { source: full.source, slots };
writeFileSync(new URL("../src/ge150/catalog.json", import.meta.url), JSON.stringify(out) + "\n");
console.log(`catalog: ${slots.map((s) => `${s.name}=${s.models.length}`).join(" ")}`);
