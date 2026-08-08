import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

/*
 * Integration tests, separated from the unit suite on purpose.
 *
 * They talk to a real database, so they must never run by accident: `npm test`
 * uses vitest.config.ts and cannot reach this file. Running them takes an
 * explicit `npm run test:db` AND URIVO_INTEGRATION_DB=1 — the harness skips
 * every case without it, so a CI job that forgets the flag reports skipped
 * rather than passing on nothing.
 *
 * Serial, single-fork: the cases share one store and assert exact table
 * counts before and after. Parallel workers would see each other's fixtures
 * and the reconciliation would fail for the wrong reason.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["test/integration/**/*.test.ts"],
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    sequence: { concurrent: false },
    // A real database over the network is slower than a unit test, and a
    // timeout here would read as a failing rule rather than a slow link.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
