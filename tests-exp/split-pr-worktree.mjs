// Splits test/scripts/pr-worktree-provision.test.ts into N files by top-level it blocks.
import { readFileSync, writeFileSync } from "node:fs";
const n = Number(process.argv[2] || 3);
const src = "test/scripts/pr-worktree-provision.test.ts";
const lines = readFileSync(src, "utf8").split("\n");
const d = lines.findIndex((l) => l.startsWith("describePosix("));
const end = lines.lastIndexOf("});");
const starts = [];
for (let i = d + 1; i < end; i++) if (/^  it[.(]/.test(lines[i])) starts.push(i);
const blocks = starts.map((s, k) => lines.slice(s, k + 1 < starts.length ? starts[k + 1] : end));
// weight: it.each blocks count their cases roughly by line count
const weight = (b) => b.length;
const bins = Array.from({ length: n }, () => ({ w: 0, b: [] }));
for (const b of [...blocks].sort((a, c) => weight(c) - weight(a))) {
  const bin = bins.reduce((m, x) => (x.w < m.w ? x : m));
  bin.w += weight(b);
  bin.b.push(b);
}
const files = [];
bins.forEach((bin, k) => {
  const f = `test/scripts/pr-worktree-provision.part${k + 1}.test.ts`;
  writeFileSync(f, [...lines.slice(0, d + 1), ...bin.b.flat(), ...lines.slice(end)].join("\n"));
  files.push(f);
});
const paths = "test/vitest/vitest.database-worker-core-paths.mjs";
writeFileSync(
  paths,
  readFileSync(paths, "utf8").replace(
    '  "test/scripts/pr-worktree-provision.test.ts",\n',
    files.map((f) => `  "${f}",\n`).join("") + '  "test/scripts/pr-worktree-provision.test.ts",\n',
  ),
);
console.log(files.join(" "));
