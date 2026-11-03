import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, it } from "vitest";
import { coldFixture, describePosix, expectSeed } from "./pr-worktree-provision.test-support.js";

describePosix("native PR source provisioning", () => {
  it.each([
    "default",
    "absolute",
    "relative",
    "command-scoped",
    "parameter-scoped",
    "branch",
  ] as const)("executes the %s checkout hook once and preserves its tracked edit", (policy) => {
    const f = coldFixture(false);
    const hooks =
      policy === "default" ? join(f.canonical, ".git", "hooks") : join(f.root, "configured-hooks");
    const receipt = join(f.root, "configured-hook.txt");
    if (policy !== "default") {
      mkdirSync(hooks);
    }
    const hook = join(hooks, "post-checkout");
    const edit =
      policy === "default"
        ? "hook-owned edit"
        : policy === "branch"
          ? "branch hook edit"
          : "configured hook edit";
    const record =
      policy === "default"
        ? 'printf \'%s\\t%s\\t%s\\t%s\\n\' "$PWD" "$1" "$2" "$3"'
        : "printf '%s\\n' \"$PWD\"";
    writeFileSync(
      hook,
      `#!/bin/sh
${record} >> "${receipt}"
printf '${edit}\\n' > src/subject.ts
`,
    );
    chmodSync(hook, 0o755);
    if (policy === "default") {
      f.git(f.canonical, "config", "--unset", "core.hooksPath");
    } else if (policy === "branch") {
      const config = join(f.root, "branch.gitconfig");
      writeFileSync(config, `[core]\n\thooksPath = ${JSON.stringify(hooks)}\n`);
      f.git(f.canonical, "config", "includeIf.onbranch:temp/pr-*.path", config);
      // Detached canonical HEAD cannot reveal the destination's branch-only policy.
      expect(f.git(f.canonical, "config", "--get", "core.hooksPath")).toBe("/dev/null");
    } else if (policy === "command-scoped") {
      f.env.GIT_CONFIG_COUNT = "1";
      f.env.GIT_CONFIG_KEY_0 = "core.hooksPath";
      f.env.GIT_CONFIG_VALUE_0 = hooks;
    } else if (policy === "parameter-scoped") {
      f.env.GIT_CONFIG_PARAMETERS = `'core.hooksPath=${hooks}'`;
    } else {
      // Relative hooks resolve from the checkout in which the hook runs,
      // not from the canonical repository where provisioning begins.
      f.git(
        f.canonical,
        "config",
        "core.hooksPath",
        policy === "relative" ? relative(f.worktree, hooks) : hooks,
      );
    }
    const result = f.run("review-init");
    expect(result.status).not.toBe(0);
    // Relative and branch-only policy activates after entering the new checkout.
    expect(result.stderr).toContain(
      policy === "relative" || policy === "branch"
        ? "the journaled transition did not complete cleanly"
        : "foreign state blocks a new transition",
    );
    expectSeed(f);
    if (policy === "default") {
      const calls = readFileSync(receipt, "utf8").trim().split("\n");
      expect(calls).toHaveLength(1);
      expect(calls[0]!.split("\t")).toEqual([f.worktree, "0".repeat(40), f.main, "1"]);
    } else {
      expect(readFileSync(receipt, "utf8")).toBe(`${f.worktree}\n`);
    }
    expect(readFileSync(join(f.worktree, "src", "subject.ts"), "utf8")).toBe(`${edit}\n`);
    expect(existsSync(join(f.canonical, ".worktrees", ".templates"))).toBe(false);
    expect(f.git(f.canonical, "status", "--porcelain")).toBe("");
    // The failed hook run drained, so the supervisor released the lock; the checkout keeps the evidence.
    expect(f.git(f.canonical, "for-each-ref", "refs/openclaw/pr-operation-locks")).toBe("");
  });

});
