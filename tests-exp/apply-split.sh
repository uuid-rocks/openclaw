#!/usr/bin/env bash
set -euo pipefail
cp tests-exp/split/*.ts test/scripts/
python3 - <<'PY'
p = "test/vitest/vitest.database-worker-core-paths.mjs"
s = open(p).read()
old = '  "test/scripts/pr-worktree-provision.test.ts",\n'
assert old in s
s = s.replace(old, old + '  "test/scripts/pr-worktree-provision.hook-policy.test.ts",\n  "test/scripts/pr-worktree-provision.hook-faults.test.ts",\n')
open(p, "w").write(s)
PY
