import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect } from "vitest";
import { closeStateDatabaseForTest } from "../../src/test-utils/database-cleanup.js";
import { useAutoCleanupTempDirTracker } from "../helpers/temp-dir.js";
import { createMainRefreshFixture } from "./pr-main-refresh.test-support.js";

const tempDirs = useAutoCleanupTempDirTracker((cleanup) =>
  afterEach(async () => {
    await closeStateDatabaseForTest();
    cleanup();
  }),
);
export const describePosix = process.platform === "win32" ? describe.skip : describe;

export function coldFixture(perWorktreeConfig = true) {
  const f = createMainRefreshFixture(tempDirs.make("openclaw-pr-provision-"), {
    perWorktreeConfig,
    precreateWorktree: false,
  });
  f.env.OPENCLAW_STATE_DIR = join(f.root, "state");
  f.env.OPENCLAW_CONFIG_PATH = join(f.root, "config.json");
  writeFileSync(f.env.OPENCLAW_CONFIG_PATH, "{}\n");
  return {
    ...f,
    run(...args: Parameters<typeof f.run>) {
      const result = f.run(...args);
      f.assertPrivateHandoffVerified();
      return result;
    },
  };
}

export function expectSeed(f: ReturnType<typeof coldFixture>, pr = 42) {
  const worktree = join(f.canonical, ".worktrees", `pr-${pr}`);
  expect(f.git(worktree, "symbolic-ref", "HEAD")).toBe(`refs/heads/temp/pr-${pr}`);
  expect(f.git(worktree, "rev-parse", "HEAD")).toBe(f.main);
  expect(f.git(f.canonical, "rev-parse", `refs/heads/temp/pr-${pr}`)).toBe(f.main);
  return worktree;
}
