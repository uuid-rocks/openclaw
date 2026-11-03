import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { coldFixture, describePosix, expectSeed } from "./pr-worktree-provision.test-support.js";

describePosix("native PR source provisioning", () => {
  it("preserves a caller fsmonitor hook without enabling it in managed Git", () => {
    const f = coldFixture(false);
    const monitor = join(f.root, "fsmonitor's hook");
    const monitorCommand = `'${monitor.replace(/'/gu, `'\\''`)}'`;
    const receipt = join(f.root, "fsmonitor.txt");
    // Git treats a nonzero monitor exit as a request for an ordinary scan.
    // This records invocation without faking a clean index or monitor token.
    writeFileSync(monitor, `#!/bin/sh\nprintf '%s\\n' "$PWD" >> "${receipt}"\nexit 1\n`);
    chmodSync(monitor, 0o755);
    f.git(f.canonical, "config", "core.fsmonitor", monitorCommand);
    const result = f.run("review-init");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("PR source checkout: Git checkout.");
    expect(readFileSync(receipt, "utf8").trim().split("\n")).toContain(f.worktree);
    expectSeed(f);
    expect(f.git(f.worktree, "config", "--get", "core.fsmonitor")).toBe(monitorCommand);
    expect(existsSync(join(f.canonical, ".worktrees", ".templates"))).toBe(false);
  });

  it("preserves the caller branch and initialized checkout after a nonzero hook exit", () => {
    const f = coldFixture(false);
    f.git(f.canonical, "config", "--unset", "core.hooksPath");
    const hook = join(f.canonical, ".git", "hooks", "post-checkout");
    writeFileSync(
      hook,
      "#!/bin/sh\nprintf 'retained hook evidence\\n' > hook-evidence.txt\nexit 31\n",
    );
    chmodSync(hook, 0o755);
    const result = f.run("review-init");
    expect(result.status).not.toBe(0);
    expectSeed(f);
    expect(readFileSync(join(f.worktree, "hook-evidence.txt"), "utf8")).toBe(
      "retained hook evidence\n",
    );
    // The failed hook run drained, so the supervisor released the lock; the checkout keeps the evidence.
    expect(f.git(f.canonical, "for-each-ref", "refs/openclaw/pr-operation-locks")).toBe("");
  });

  it("does not repair a caller seed moved by a checkout hook", () => {
    const f = coldFixture(false);
    f.git(f.canonical, "config", "--unset", "core.hooksPath");
    const hook = join(f.canonical, ".git", "hooks", "post-checkout");
    writeFileSync(hook, `#!/bin/sh\ngit update-ref refs/heads/temp/pr-42 ${f.head} ${f.main}\n`);
    chmodSync(hook, 0o755);
    const result = f.run("review-init");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/identity changed|seed branch moved/);
    expect(f.git(f.canonical, "rev-parse", "refs/heads/temp/pr-42")).toBe(f.head);
    expect(f.git(f.worktree, "symbolic-ref", "HEAD")).toBe("refs/heads/temp/pr-42");
    expect(f.git(f.worktree, "write-tree")).toBe(
      f.git(f.canonical, "rev-parse", `${f.main}^{tree}`),
    );
  });

  it.each(["replaced", "deleted"] as const)(
    "retains native checkout evidence when a hook leaves the PR lock %s",
    (change) => {
      const f = coldFixture(false);
      f.git(f.canonical, "config", "--unset", "core.hooksPath");
      const lockRef = "refs/openclaw/pr-operation-locks/42";
      const receipt = join(f.root, "hook-lock-change.txt");
      const hook = join(f.canonical, ".git", "hooks", "post-checkout");
      const changeLock =
        change === "replaced"
          ? `replacement=$(printf 'successor-owned lock evidence\\n' | git hash-object -w --stdin) || exit 32
git update-ref --no-deref "${lockRef}" "$replacement" "$previous" || exit 33
printf '%s\\n' "$replacement" > "${receipt}"`
          : `git update-ref --no-deref -d "${lockRef}" "$previous" || exit 34
printf 'deleted\\n' > "${receipt}"`;
      writeFileSync(
        hook,
        `#!/bin/sh
previous=$(git rev-parse --verify "${lockRef}") || exit 31
printf 'hook-owned state after lock loss\\n' > src/subject.ts
${changeLock}
`,
      );
      chmodSync(hook, 0o755);

      const result = f.run("review-init");
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("PR operation lock check failed (status=1, signal=null)");
      expectSeed(f);
      expect(readFileSync(join(f.worktree, "src", "subject.ts"), "utf8")).toBe(
        "hook-owned state after lock loss\n",
      );
      expect(f.git(f.worktree, "write-tree")).toBe(
        f.git(f.canonical, "rev-parse", `${f.main}^{tree}`),
      );
      expect(f.git(f.canonical, "worktree", "list", "--porcelain")).toContain(f.worktree);
      expect(f.git(f.canonical, "status", "--porcelain")).toBe("");
      expect(existsSync(join(f.canonical, ".worktrees", ".templates"))).toBe(false);
      const observed = readFileSync(receipt, "utf8").trim();
      if (change === "replaced") {
        expect(observed).toMatch(/^[0-9a-f]{40}$/);
        expect(f.git(f.canonical, "rev-parse", "--verify", lockRef)).toBe(observed);
        expect(f.git(f.canonical, "cat-file", "blob", observed)).toBe(
          "successor-owned lock evidence",
        );
      } else {
        expect(observed).toBe("deleted");
        expect(f.git(f.canonical, "for-each-ref", "--format=%(refname)", lockRef)).toBe("");
      }
    },
  );
});
