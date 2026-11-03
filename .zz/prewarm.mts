// Experiment-only: compute the base inventory into the checkout-local build-step cache.
import { baseInventory } from "../scripts/lib/database-worker-inventory-cache.mts";
const started = performance.now();
const rows = baseInventory(process.cwd(), process.argv[2]!, undefined, (phase, facts) =>
  console.log("[prewarm-phase] " + JSON.stringify({ phase, ...facts, sinceMainMs: performance.now() - started })),
);
console.log(`[prewarm] rows=${rows.length} ms=${(performance.now() - started).toFixed(0)}`);
