// Replays a captured "Run Node test shard" step env into GITHUB_ENV.
import { appendFileSync, readFileSync } from "node:fs";
const env = JSON.parse(readFileSync(process.argv[2], "utf8"));
const keep = (k) =>
  ["OPENCLAW_CI_TEST_RUNTIME_POLICY", "FROZEN_TARGET", "OPENCLAW_VITEST_SHARD_NAME", "OPENCLAW_VITEST_NO_OUTPUT_TIMEOUT_MS"].includes(k) ||
  k.startsWith("OPENCLAW_NODE_TEST_");
for (const [k, v] of Object.entries(env)) {
  if (!keep(k)) continue;
  const value = k === "OPENCLAW_NODE_TEST_GROUPS_GZIP_BASE64" ? v.replace(/\s+/g, "") : v;
  appendFileSync(process.env.GITHUB_ENV, `${k}<<__EXP_EOF__\n${value}\n__EXP_EOF__\n`);
}
console.log(`plan_concurrency=${env.OPENCLAW_NODE_TEST_PLAN_CONCURRENCY}`);
