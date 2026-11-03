// Experiment-only: per-method RPC breakdown for the native TypeScript sync API.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
const require = createRequire(path.join(process.cwd(), "package.json"));
const pkg = fs.realpathSync(require.resolve("typescript/package.json"));
const timing = await import(pathToFileURL(path.join(path.dirname(pkg), "dist/api/timing.js")).href);
const stats = new Map();
const record = timing.TimingCollector.prototype.record;
timing.TimingCollector.prototype.record = function (sample) {
  const s = stats.get(sample.method) ?? { count: 0, rtMs: 0, recv: 0, sent: 0 };
  s.count++;
  s.rtMs += sample.roundTripMs;
  s.recv += sample.bytesReceived;
  s.sent += sample.bytesSent;
  stats.set(sample.method, s);
  return record.call(this, sample);
};
process.on("exit", () => {
  const cpu = process.cpuUsage();
  const rows = [...stats].toSorted((a, b) => b[1].rtMs - a[1].rtMs);
  const out = [
    `[zz-prof] pid=${process.pid} nodeCpuUserS=${(cpu.user / 1e6).toFixed(1)} nodeCpuSysS=${(cpu.system / 1e6).toFixed(1)} maxRssMB=${(process.resourceUsage().maxRSS / 1024).toFixed(0)} argv=${process.argv.slice(1).join(" ")}`,
    ...rows.map(
      ([m, s]) =>
        `[zz-prof] ${m.padEnd(36)} n=${String(s.count).padStart(8)} rtS=${(s.rtMs / 1000).toFixed(1).padStart(7)} recvMB=${(s.recv / 1e6).toFixed(0).padStart(6)} sentMB=${(s.sent / 1e6).toFixed(0).padStart(5)}`,
    ),
  ];
  fs.appendFileSync(process.env.ZZ_PROF_OUT ?? "/tmp/zz-prof.txt", out.join("\n") + "\n");
});
