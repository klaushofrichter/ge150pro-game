// This repository as the games-service console sees it: packed from a GitHub tarball into a bundle, checked,
// unpacked on a table and loaded by the host with `@game-table/sdk` mapped. If this passes, ticking the repository
// for a table in the console installs these games.
import { mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { packRepoTarball } from "../.games-service/apps/cloud/src/game-repos.ts";
import { decodeBundle, safeBundlePath, BUNDLE_LIMITS } from "../.games-service/packages/protocol/src/bundle.ts";
import { loadGames } from "../.games-service/apps/table-host/src/games.ts";
import { githubTarball } from "../.games-service/tests/tar.ts";
import { renderRules } from "../.games-service/apps/table-host/public/shared/markdown.js";
import { GAMES_DIR, ROOT, manifestSchema } from "./harness.ts";

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/** Every file under games/, by path relative to the repository root, as GitHub's tarball would carry it. */
async function repoFiles() {
  const files: Record<string, Buffer> = {};
  for (const p of await walk(GAMES_DIR)) files[relative(ROOT, p)] = await readFile(p);
  return files;
}

/** The game folders under games/. */
async function gameIds() {
  return (await readdir(GAMES_DIR, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
}

describe("rules for players (games-service D-099)", () => {
  it("every game ships how-to-play.md that renders with a title, its images, and every setting's label", async () => {
    const ids = await gameIds();
    for (const id of ids) {
      const md = await readFile(join(GAMES_DIR, id, "how-to-play.md"), "utf8");
      const m = JSON.parse(await readFile(join(GAMES_DIR, id, "manifest.json"), "utf8"));
      const { title, html } = renderRules(md, `/games/${id}/`);
      expect(title, id).toBe(m.name.replaceAll("'", "&#39;"));
      expect(html, id).not.toMatch(/!\[/); // every image was accepted
      const imgs = [...html.matchAll(/<img src="\/games\/[^/]+\/([^"]+)"/g)].map((x) => x[1]);
      expect(imgs.length, id).toBeGreaterThan(0);
      for (const src of imgs) await stat(join(GAMES_DIR, id, src));
      for (const s of m.settings) expect(md, `${id}: ${s.label}`).toContain(s.label);
    }
  });

  it("every game's rules start with short instructions: an In short section of two to five bullets (D-100)", async () => {
    const ids = await gameIds();
    for (const id of ids) {
      const sections = (await readFile(join(GAMES_DIR, id, "how-to-play.md"), "utf8")).split(/^## /m);
      expect(sections[1]?.startsWith("In short\n"), id).toBe(true);
      const bullets = sections[1].split("\n").filter((l) => l.startsWith("- ")).length;
      expect(bullets, id).toBeGreaterThanOrEqual(2);
      expect(bullets, id).toBeLessThanOrEqual(5);
      expect(sections[1].split(/\s+/).length, id).toBeLessThanOrEqual(90);
    }
  });

  it("illustrations are well-formed SVG with no script or outside references", async () => {
    for (const p of (await walk(GAMES_DIR)).filter((f) => f.endsWith(".svg"))) {
      const svg = await readFile(p, "utf8");
      expect(svg, p).toMatch(/^\s*<svg[\s>]/);
      for (const bad of [/<script/i, /<foreignObject/i, /\son\w+=/i, /href="(?!#)/i, /<image/i]) expect(svg, `${p} ${bad}`).not.toMatch(bad);
    }
  });
});

describe("as a bundle", () => {
  it("every file under games/ has a name a bundle accepts, and the whole stays within the limits", async () => {
    const files = await repoFiles();
    let total = 0;
    for (const [p, data] of Object.entries(files)) {
      expect(safeBundlePath(p), p).toBe(true);
      expect(data.length, p).toBeLessThanOrEqual(BUNDLE_LIMITS.fileBytes);
      total += data.length;
    }
    expect(total).toBeLessThanOrEqual(BUNDLE_LIMITS.totalBytes);
    expect(Object.keys(files).length).toBeLessThanOrEqual(BUNDLE_LIMITS.files);
  });

  it("every game folder has a valid manifest whose id is the folder name, rules, and a board and phone UI", async () => {
    const ids = await gameIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const m = manifestSchema.parse(JSON.parse(await readFile(join(GAMES_DIR, id, "manifest.json"), "utf8")));
      expect(m.id).toBe(id);
      expect(m.test).toBe(false);
      for (const f of ["rules.ts", "board.js", "deck.js"]) await stat(join(GAMES_DIR, id, f));
      // Rules import the SDK by name, never by a path into games-service.
      const rules = await readFile(join(GAMES_DIR, id, "rules.ts"), "utf8");
      expect(rules).not.toMatch(/from\s+["'](\.\.\/)+(packages|apps|\.games-service)/);
      expect(rules).toMatch(/from\s+["']@game-table\/sdk["']/);
    }
  });

  it("packs, unpacks and loads on a table exactly as the console and the table host do", async () => {
    const tar = githubTarball("klaushofrichter/ge150pro-game", "abc1234", await repoFiles());
    const packed = packRepoTarball(tar, "klaushofrichter/ge150pro-game", "main");
    expect(packed.games.map((g) => g.id)).toContain("ge150-pro");
    const b = decodeBundle(packed.payload, packed.hash);
    const dir = await mkdtemp(join(tmpdir(), "ge150-bundle-"));
    try {
      for (const [p, data] of Object.entries(b.files)) {
        await mkdir(dirname(join(dir, p)), { recursive: true });
        await writeFile(join(dir, p), data);
      }
      await writeFile(join(dir, "package.json"), '{"type":"module"}');
      const games = await loadGames(join(dir, "games"), { repo: "klaushofrichter/ge150pro-game@main", commit: "abc1234", hash: packed.hash });
      expect([...games.keys()].sort()).toEqual(packed.games.map((g) => g.id).sort());
      expect(typeof games.get("ge150-pro")!.def.setup).toBe("function");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("nothing outside games/ goes into the bundle", async () => {
    const tar = githubTarball("o/r", "1", { ...(await repoFiles()), "README.md": "x", "tests/x.test.ts": "x", ".github/workflows/x.yml": "x" });
    const packed = packRepoTarball(tar, "o/r", "main");
    const files = Object.keys(decodeBundle(packed.payload, packed.hash).files);
    expect(files.every((f) => f.startsWith("games/"))).toBe(true);
  });
});
