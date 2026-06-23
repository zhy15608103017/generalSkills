import { performance } from "node:perf_hooks";
import { collectReviewContext } from "./collect-context.mjs";
import { loadReviewerAssets } from "./call-model.mjs";

async function measure(name, runs, fn) {
  const durations = [];
  for (let index = 0; index < runs; index += 1) {
    const startedAt = performance.now();
    await fn();
    durations.push(performance.now() - startedAt);
  }
  const total = durations.reduce((sum, value) => sum + value, 0);
  return {
    name,
    runs,
    minMs: Math.min(...durations),
    maxMs: Math.max(...durations),
    avgMs: total / durations.length,
  };
}

async function main() {
  const contextStats = await measure("collectReviewContext", 3, async () => {
    await collectReviewContext({ verifications: [] });
  });
  const assetsStats = await measure("loadReviewerAssets", 5, async () => {
    await loadReviewerAssets();
  });

  process.stdout.write(`${JSON.stringify({ contextStats, assetsStats }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error}\n`);
  process.exitCode = 1;
});
