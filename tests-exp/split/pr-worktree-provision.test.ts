import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { detectWorktreeFilesystemBackend } from "../../src/agents/worktrees/filesystem-backend.js";
import { listTemplatesAsync } from "../../src/agents/worktrees/template-registry-async.js";
import { coldFixture, describePosix, expectSeed } from "./pr-worktree-provision.test-support.js";

function nextPr(f: ReturnType<typeof coldFixture>, pr: number) {
  f.configure({
    metadata: {
      ...f.metadata,
      number: pr,
      url: `https://github.com/fixture/repo/pull/${pr}`,
    },
  });
  const result = f.run(["review-init", String(pr)]);
  expect(result.status, result.stderr).toBe(0);
  return { worktree: join(f.canonical, ".worktrees", `pr-${pr}`), stderr: result.stderr };
}

describePosix("native PR source provisioning", () => {
  it("keeps disabled-acceleration seed, private checkpoint, and cleanup custody", () => {
    const f = coldFixture(false);
    writeFileSync(f.env.OPENCLAW_CONFIG_PATH!, '{"worktreeAcceleration":false}\n');
    const shared = f.git(f.canonical, "rev-parse", "refs/remotes/origin/main");
    const result = f.run("review-init");
    expect(result.status, result.stderr).toBe(0);
    expectSeed(f);
    expect(f.git(f.worktree, "rev-parse", "FETCH_HEAD")).toBe(f.main);
    expect(f.git(f.canonical, "rev-parse", "refs/remotes/origin/main")).toBe(shared);
    expect(f.git(f.canonical, "for-each-ref", "refs/openclaw/pr-operation-locks")).toBe("");
    expect(existsSync(join(f.canonical, ".worktrees", ".templates"))).toBe(false);
  });

  it("preserves a symlinked parent through native Git with acceleration enabled", () => {
    const f = coldFixture(false);
    writeFileSync(f.env.OPENCLAW_CONFIG_PATH!, JSON.stringify({ worktreeAcceleration: true }));
    const preload = join(f.root, "native-provision-imports.mjs");
    const guardReceipt = join(f.root, "native-provision-imports.txt");
    writeFileSync(
      preload,
      `import { appendFileSync } from "node:fs";
import { registerHooks } from "node:module";
if (process.argv[1]?.endsWith("/worktree-provision.mts")) {
  registerHooks({ load(url, context, nextLoad) {
    if (url.endsWith("/src/config/config.ts")) {
      throw new Error("Native Git provisioning must not load acceleration configuration.");
    }
    return nextLoad(url, context);
  } });
  appendFileSync(${JSON.stringify(guardReceipt)}, String(process.pid) + "\\n");
}
`,
    );
    // Keep both guards: reject config startup and verify each private store.
    f.env.NODE_OPTIONS = `--import=${pathToFileURL(preload).href} ${f.env.NODE_OPTIONS}`;
    const parent = join(f.canonical, ".worktrees");
    const physicalParent = join(f.root, "pr-worktrees");
    rmdirSync(parent);
    mkdirSync(physicalParent);
    symlinkSync(physicalParent, parent, "dir");
    const result = f.run("review-init");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stderr).toContain("PR source checkout: Git checkout.");
    expect(readFileSync(guardReceipt, "utf8")).toMatch(/^[1-9]\d*\n$/);
    expectSeed(f);
    expect(f.git(f.worktree, "rev-parse", "--show-toplevel")).toBe(join(physicalParent, "pr-42"));
    expect(f.git(f.worktree, "rev-parse", "FETCH_HEAD")).toBe(f.main);
    expect(f.git(f.canonical, "for-each-ref", "refs/openclaw/pr-operation-locks")).toBe("");
    expect(existsSync(join(physicalParent, ".templates"))).toBe(false);
  });

  it.runIf(process.platform === "linux")(
    "keeps native Git provisioning on an unsupported source filesystem",
    async (context) => {
      const f = coldFixture(false);
      // Probe the real fixture volume, not a mocked unsupported backend. A
      // clone-capable Linux volume cannot supply this acceptance cell.
      const backend = await detectWorktreeFilesystemBackend(f.canonical, {
        commitGuard() {},
      });
      if (backend) {
        context.skip();
        return;
      }
      const result = f.run("review-init");
      expect(result.status, result.stderr).toBe(0);
      expect(result.stderr).toContain("PR source checkout: Git checkout.");
      expectSeed(f);
      expect(f.git(f.worktree, "write-tree")).toBe(
        f.git(f.canonical, "rev-parse", `${f.main}^{tree}`),
      );
      expect(existsSync(join(f.worktree, "scripts", "pr"))).toBe(true);
      expect(existsSync(join(f.canonical, ".worktrees", ".templates"))).toBe(false);
    },
  );

  it.each(["count", "parameters"] as const)(
    "preserves command-scoped safe.directory through cold provisioning (%s transport)",
    (transport) => {
      const f = coldFixture(false);
      // Local upload-pack drops client command-scope config; trust only its bare remote.
      f.env.GIT_CONFIG_GLOBAL = join(f.root, "gitconfig");
      f.git(f.canonical, "config", "--global", "--add", "safe.directory", f.origin);
      // Git's ownership fixture requires actual command-scope authorization,
      // without changing filesystem ownership or global configuration.
      f.env.GIT_TEST_ASSUME_DIFFERENT_OWNER = "1";
      if (transport === "count") {
        f.env.GIT_CONFIG_COUNT = "1";
        f.env.GIT_CONFIG_KEY_0 = "safe.directory";
        f.env.GIT_CONFIG_VALUE_0 = "*";
      } else {
        f.env.GIT_CONFIG_PARAMETERS = "'safe.directory=*'";
      }
      const result = f.run("review-init");
      expect(result.status, result.stderr).toBe(0);
      expectSeed(f);
      if (transport === "count") {
        expect(result.stderr).toContain("PR source checkout: Git checkout.");
        expect(existsSync(join(f.canonical, ".worktrees", ".templates"))).toBe(false);
      }
      expect(f.git(f.worktree, "rev-parse", "FETCH_HEAD")).toBe(f.main);
      expect(f.git(f.canonical, "for-each-ref", "refs/openclaw/pr-operation-locks")).toBe("");
    },
  );


  // Only an actual accelerated host can prove this cell; a skip is not APFS proof.
  it.skipIf(process.platform !== "darwin")(
    "removes a failed template clone after losing its PR registration, then retries",
    () => {
      const f = coldFixture(false);
      const fault = join(f.root, "lose-registration.mjs");
      const receipt = join(f.root, "lost-registration");
      writeFileSync(
        fault,
        `import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
const marker = ${JSON.stringify(join(f.worktree, ".git"))};
const admin = ${JSON.stringify(join(f.canonical, ".git/worktrees/pr-42"))};
if (process.argv.includes('.git/worktrees/pr-42') && existsSync(marker) &&
    !readFileSync(marker, 'utf8').includes('/pr-42')) {
  writeFileSync(${JSON.stringify(receipt)}, readFileSync(marker));
  rmSync(admin, { recursive: true, force: true });
}
`,
      );
      const gitShim = join(f.root, "bin/git");
      writeFileSync(
        gitShim,
        readFileSync(gitShim, "utf8").replace(
          "#!/bin/sh\n",
          `#!/bin/sh\ncase "$*" in *'.git/worktrees/pr-42 rev-parse HEAD --symbolic-full-name HEAD'*) node '${fault}' "$@" || exit $? ;; esac\n`,
        ),
      );
      const failed = f.run("review-init");
      expect(failed.status).not.toBe(0);
      expect(readFileSync(receipt, "utf8")).toMatch(/worktrees\/[0-9a-f-]{36}\n$/);
      expect(failed.stderr).toContain("not a git repository");
      expect(existsSync(f.worktree)).toBe(false);
      expect(f.git(f.canonical, "rev-parse", "refs/heads/temp/pr-42")).toBe(f.main);
      // The same PR can provision again, without a replacement PR or manual repair.
      writeFileSync(fault, "");
      const retried = f.run("review-init");
      expect(retried.status, retried.stderr).toBe(0);
      expectSeed(f);
    },
  );

  it.skipIf(process.platform !== "darwin")(
    "materializes full cold/warm PR siblings, then preserves native sparse transitions",
    async () => {
      const f = coldFixture(false);
      const first = f.run("review-init");
      expect(first.status, first.stderr).toBe(0);
      const templates = join(f.canonical, ".worktrees", ".templates");
      expect(existsSync(templates), first.stderr).toBe(true);
      const templateNames = readdirSync(templates).toSorted();
      expect(templateNames.length).toBeGreaterThan(0);
      expect(first.stderr).toContain("PR source checkout: filesystem template clone.");
      const template = (
        await listTemplatesAsync({
          ...f.env,
          OPENCLAW_STATE_DIR: join(f.canonical, ".local", "pr-state"),
        })
      ).find((entry) => entry.sourceCommit === f.main);
      expect(template?.backend).toBe("apfs");
      expect(template?.status).toBe("ready");
      const warmResult = nextPr(f, 43);
      expect(warmResult.stderr).toContain("PR source checkout: filesystem template clone.");
      const warm = warmResult.worktree;
      expect(readdirSync(templates).toSorted()).toEqual(templateNames);
      expectSeed(f, 43);
      const firstIndex = f.git(
        f.worktree,
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "index",
      );
      const warmIndex = f.git(warm, "rev-parse", "--path-format=absolute", "--git-path", "index");
      expect(warmIndex).not.toBe(firstIndex);
      writeFileSync(join(f.worktree, "src", "subject.ts"), "first sibling edit\n");
      expect(readFileSync(join(warm, "src", "subject.ts"), "utf8")).toBe(
        "export const subject = 'base';\n",
      );
      writeFileSync(join(warm, "src", "subject.ts"), "warm sibling edit\n");

      // Original order: full cold/warm, sparse sibling, full sibling while sparse,
      // native disable, then another full sibling. Never reset common config.
      const sparse = nextPr(f, 44).worktree;
      f.git(sparse, "sparse-checkout", "set", "--cone", "src");
      const origins = f.git(sparse, "config", "--show-origin", "--show-scope", "--list");
      expect(origins).toContain("extensions.worktreeconfig=true");
      expect(f.git(sparse, "config", "--bool", "core.sparseCheckout")).toBe("true");
      const whileSparseResult = nextPr(f, 45);
      expect(whileSparseResult.stderr).toContain("PR source checkout: Git checkout.");
      const whileSparse = whileSparseResult.worktree;
      expect(existsSync(join(whileSparse, "scripts", "pr"))).toBe(true);
      expect(f.git(sparse, "config", "--bool", "core.sparseCheckout")).toBe("true");
      f.git(sparse, "sparse-checkout", "disable");
      const afterDisableResult = nextPr(f, 46);
      expect(afterDisableResult.stderr).toContain("PR source checkout: Git checkout.");
      const afterDisable = afterDisableResult.worktree;
      expect(existsSync(join(afterDisable, "scripts", "pr"))).toBe(true);
      const laterSparseResult = nextPr(f, 47);
      expect(laterSparseResult.stderr).toContain("PR source checkout: Git checkout.");
      f.git(laterSparseResult.worktree, "sparse-checkout", "set", "--cone", "src");
      expect(f.git(laterSparseResult.worktree, "config", "--bool", "core.sparseCheckout")).toBe(
        "true",
      );
      expect(f.git(sparse, "config", "--bool", "core.sparseCheckout")).toBe("false");
      expect(
        f.git(
          laterSparseResult.worktree,
          "rev-parse",
          "--path-format=absolute",
          "--git-path",
          "index",
        ),
      ).not.toBe(f.git(sparse, "rev-parse", "--path-format=absolute", "--git-path", "index"));
      expect(readdirSync(templates).toSorted()).toEqual(templateNames);
      expect(f.git(f.canonical, "config", "--bool", "extensions.worktreeConfig")).toBe("true");
      expect(readFileSync(join(f.worktree, "src", "subject.ts"), "utf8")).toBe(
        "first sibling edit\n",
      );
      expect(readFileSync(join(warm, "src", "subject.ts"), "utf8")).toBe("warm sibling edit\n");
      expect(readFileSync(join(template!.path, "src", "subject.ts"), "utf8")).toBe(
        "export const subject = 'base';\n",
      );
      for (const pr of [43, 44, 45, 46, 47]) {
        expectSeed(f, pr);
      }
    },
  );
});
