// Replays the "Run Node test shard" step env captured from an upstream job log.
import { appendFileSync, readFileSync } from "node:fs";
const [file] = process.argv.slice(2);
const env = JSON.parse(readFileSync(file, "utf8"));
const keep = (k) =>
  k === "NODE_OPTIONS" ||
  k === "OPENCLAW_CI_TEST_RUNTIME_POLICY" ||
  k === "FROZEN_TARGET" ||
  k === "OPENCLAW_VITEST_SHARD_NAME" ||
  k === "OPENCLAW_VITEST_NO_OUTPUT_TIMEOUT_MS" ||
  k.startsWith("OPENCLAW_NODE_TEST_");
const out = {};
for (const [k, v] of Object.entries(env)) if (keep(k)) out[k] = v;
if (process.env.EXP_TARGETS) out.OPENCLAW_NODE_TEST_TARGETS_JSON = process.env.EXP_TARGETS;
for (const [k, v] of Object.entries(out)) {
  appendFileSync(process.env.GITHUB_ENV, `${k}<<__EXP_EOF__\n${v}\n__EXP_EOF__\n`);
}
console.log(JSON.stringify(out.OPENCLAW_NODE_TEST_TARGETS_JSON));
