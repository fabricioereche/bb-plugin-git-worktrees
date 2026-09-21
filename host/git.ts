import {
  experimental_sanitizeInheritedChildProcessEnv as sanitizeInheritedChildProcessEnv,
  experimental_spawnPortableOutputProcess as spawnPortableOutputProcess,
} from "@get-bb/plugin-sdk/host";
import path from "node:path";
import type { GitWorktreeEntry } from "../contract.js";

const MAX_OUTPUT_BYTES = 1024 * 1024;
const GIT_TIMEOUT_MS = 30_000;

function trimOutput(value: string): string {
  return value.trim().replace(/\n+$/u, "");
}

function createOutputBuffer(): {
  append: (chunk: Buffer) => boolean;
  read: () => string;
} {
  const chunks: Buffer[] = [];
  let size = 0;
  return {
    append(chunk) {
      size += chunk.length;
      if (size > MAX_OUTPUT_BYTES) return false;
      chunks.push(chunk);
      return true;
    },
    read() {
      return Buffer.concat(chunks).toString("utf8");
    },
  };
}

async function runGit(
  args: string[],
  options: { cwd: string; signal?: AbortSignal; allowFailure?: boolean },
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (options.signal?.aborted) {
    throw new Error(`git ${args.join(" ")} was cancelled`);
  }

  return await new Promise((resolve, reject) => {
    const stdout = createOutputBuffer();
    const stderr = createOutputBuffer();
    let settled = false;
    let timedOut = false;
    let overflowed = false;

    const env = {
      ...sanitizeInheritedChildProcessEnv({ env: process.env }),
    };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_COMMON_DIR;

    const child = spawnPortableOutputProcess({
      command: "git",
      args,
      cwd: options.cwd,
      env,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, GIT_TIMEOUT_MS);

    const onAbort = (): void => {
      child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (
      err: Error | null,
      result?: { stdout: string; stderr: string; exitCode: number },
    ): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      if (err) {
        reject(err);
        return;
      }
      resolve(result!);
    };

    child.stdout.on("data", (chunk: Buffer) => {
      if (!stdout.append(chunk)) {
        overflowed = true;
        child.kill("SIGTERM");
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (!stderr.append(chunk)) {
        overflowed = true;
        child.kill("SIGTERM");
      }
    });
    child.on("error", (error) => {
      finish(error instanceof Error ? error : new Error(String(error)));
    });
    child.on("close", (code) => {
      if (timedOut) {
        finish(new Error(`git ${args.join(" ")} timed out`));
        return;
      }
      if (overflowed) {
        finish(new Error(`git ${args.join(" ")} produced too much output`));
        return;
      }
      if (options.signal?.aborted) {
        finish(new Error(`git ${args.join(" ")} was cancelled`));
        return;
      }
      const exitCode = code ?? 1;
      const result = {
        stdout: stdout.read(),
        stderr: stderr.read(),
        exitCode,
      };
      if (exitCode !== 0 && !options.allowFailure) {
        const detail = trimOutput(result.stderr) || trimOutput(result.stdout);
        finish(
          new Error(
            detail.length > 0
              ? `git ${args.join(" ")} failed: ${detail}`
              : `git ${args.join(" ")} failed with exit code ${exitCode}`,
          ),
        );
        return;
      }
      finish(null, result);
    });
  });
}

function parsePorcelainWorktrees(stdout: string): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: Partial<GitWorktreeEntry> | null = null;

  const pushCurrent = (): void => {
    if (current?.path) {
      entries.push({
        path: current.path,
        branch: current.branch ?? null,
        head: current.head ?? null,
        detached: current.detached ?? false,
        locked: current.locked ?? false,
        prunable: current.prunable ?? false,
      });
    }
    current = null;
  };

  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trimEnd();
    if (line.length === 0) {
      pushCurrent();
      continue;
    }
    if (line.startsWith("worktree ")) {
      pushCurrent();
      current = {
        path: line.slice("worktree ".length),
        branch: null,
        head: null,
        detached: false,
        locked: false,
        prunable: false,
      };
      continue;
    }
    if (current === null) continue;
    if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      current.branch = ref.startsWith("refs/heads/")
        ? ref.slice("refs/heads/".length)
        : ref;
      current.detached = false;
    } else if (line === "detached") {
      current.detached = true;
      current.branch = null;
    } else if (line.startsWith("locked")) {
      current.locked = true;
    } else if (line.startsWith("prunable")) {
      current.prunable = true;
    }
  }
  pushCurrent();
  return entries;
}

export function pathsEqual(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

export async function listGitWorktrees(args: {
  sourcePath: string;
  signal?: AbortSignal;
}): Promise<GitWorktreeEntry[]> {
  const result = await runGit(["worktree", "list", "--porcelain"], {
    cwd: args.sourcePath,
    signal: args.signal,
  });
  return parsePorcelainWorktrees(result.stdout);
}

export async function attachExistingWorktree(args: {
  sourcePath: string;
  path: string;
  signal?: AbortSignal;
}): Promise<
  | { status: "attached"; path: string; branch: string | null }
  | { status: "failed"; message: string }
> {
  const worktrees = await listGitWorktrees({
    sourcePath: args.sourcePath,
    signal: args.signal,
  });
  const match = worktrees.find((entry) => pathsEqual(entry.path, args.path));
  if (match === undefined) {
    return {
      status: "failed",
      message: `Not a git worktree of this project: ${args.path}`,
    };
  }
  if (pathsEqual(match.path, args.sourcePath)) {
    return {
      status: "failed",
      message:
        "Use Project checkout for the project's main directory. Pick another git worktree.",
    };
  }
  if (match.prunable) {
    return {
      status: "failed",
      message: `Worktree is prunable and may be missing on disk: ${match.path}`,
    };
  }
  return {
    status: "attached",
    path: match.path,
    branch: match.branch,
  };
}
