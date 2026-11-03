# Experiment-only resource sampler: overall CPU busy cores, memory, per-command RSS/CPU.
import os, sys, time, signal
out = open(sys.argv[1], "w", buffering=1)
interval = float(sys.argv[2]) if len(sys.argv) > 2 else 2.0
ncpu = os.cpu_count()
hz = os.sysconf("SC_CLK_TCK")
def cpu():
    f = open("/proc/stat").readline().split()[1:]
    v = list(map(int, f)); idle = v[3] + v[4]
    return sum(v), idle
def mem():
    d = {}
    for l in open("/proc/meminfo"):
        k, v = l.split(":"); d[k] = int(v.split()[0])
    return (d["MemTotal"] - d["MemAvailable"]) // 1024, (d["SwapTotal"] - d["SwapFree"]) // 1024
def procs():
    r = {}
    for p in os.listdir("/proc"):
        if not p.isdigit(): continue
        try:
            st = open(f"/proc/{p}/stat").read()
            comm = st[st.index("(") + 1 : st.rindex(")")]
            f = st[st.rindex(")") + 2 :].split()
            r[int(p)] = (comm, int(f[11]) + int(f[12]), int(f[21]) * 4096 // 1048576)
        except Exception: pass
    return r
stop = False
def h(*_):
    global stop; stop = True
signal.signal(signal.SIGTERM, h)
pt, pi = cpu(); pp = procs(); t0 = time.time()
busy_sum = 0; n = 0; peak_mem = 0; peak_swap = 0; peak = {}; cpu_by = {}
while not stop:
    time.sleep(interval)
    t, i = cpu(); cur = procs()
    busy = ncpu * (1 - (i - pi) / max(1, t - pt)); pt, pi = t, i
    used, swap = mem(); peak_mem = max(peak_mem, used); peak_swap = max(peak_swap, swap)
    groups = {}
    for pid, (comm, ticks, rss) in cur.items():
        key = comm if comm in ("node", "tsgo", "rg", "git", "pnpm") else None
        if key is None and comm.startswith("tsc"): key = "tsc"
        if key is None: continue
        prev = pp.get(pid)
        d = (ticks - prev[1]) if prev and prev[0] == comm else 0
        g = groups.setdefault(key, [0, 0, 0]); g[0] += d / hz / interval; g[1] += rss; g[2] += 1
        cpu_by[key] = cpu_by.get(key, 0) + d / hz
    for k, g in groups.items(): peak[k] = max(peak.get(k, 0), g[1])
    pp = cur; busy_sum += busy; n += 1
    out.write(f"{time.time()-t0:7.0f}s busy={busy:4.2f}/{ncpu} mem={used}MB swap={swap}MB " + " ".join(f"{k}:cpu={g[0]:.2f},rss={g[1]}MB,n={g[2]}" for k, g in sorted(groups.items())) + "\n")
out.write(f"SUMMARY ncpu={ncpu} avgBusyCores={busy_sum/max(1,n):.2f} peakMemUsedMB={peak_mem} peakSwapMB={peak_swap} peakRssMB={peak} cpuSecondsBy={ {k: round(v) for k, v in cpu_by.items()} } wallS={time.time()-t0:.0f}\n")
