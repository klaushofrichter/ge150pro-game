import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const sdk = (f: string) => fileURLToPath(new URL(`./.games-service/packages/sdk/src/${f}`, import.meta.url));

export default defineConfig({
  // The same mapping the table host makes for `@game-table/sdk` (games-service D-097).
  resolve: { alias: [{ find: /^@game-table\/sdk\/cards$/, replacement: sdk("cards.ts") }, { find: /^@game-table\/sdk$/, replacement: sdk("index.ts") }] },
  server: { fs: { allow: ["."] } },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
