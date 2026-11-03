// Replays the "Run Node test shard" step env captured from an upstream job log.
import { readFileSync, appendFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
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
if (out.OPENCLAW_NODE_TEST_GROUPS_GZIP_BASE64) {
  const b64 = out.OPENCLAW_NODE_TEST_GROUPS_GZIP_BASE64.replace(/\s+/g, "");
  let groups = JSON.parse(gunzipSync(Buffer.from(b64, "base64")).toString("utf8"));
  if (process.env.EXP_UNPIN === "1") {
    groups = groups.map((g) => {
      if (!g.env) return g;
      const { OPENCLAW_VITEST_MAX_WORKERS: _w, ...rest } = g.env;
      const { fallbackMaxWorkers: _f, minTotalMemoryBytes: _m, ...g2 } = g;
      return { ...g2, env: rest };
    });
  }
  out.OPENCLAW_NODE_TEST_GROUPS_GZIP_BASE64 = gzipSync(Buffer.from(JSON.stringify(groups))).toString("base64");
}
if (process.env.EXP_PLAN_CONCURRENCY) out.OPENCLAW_NODE_TEST_PLAN_CONCURRENCY = process.env.EXP_PLAN_CONCURRENCY;
for (const [k, v] of Object.entries(out)) {
  appendFileSync(process.env.GITHUB_ENV, `${k}<<__EXP_EOF__\n${v}\n__EXP_EOF__\n`);
}
console.log(Object.keys(out).join(" "));
