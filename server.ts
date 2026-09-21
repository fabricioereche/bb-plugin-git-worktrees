import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  gitWorktreesHostContract,
  gitWorktreesInputsSchema,
  gitWorktreesRpcContract,
} from "./contract.js";
import { GIT_WORKTREES_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";

const ATTACH_TIMEOUT_MS = 60_000;
const LIST_TIMEOUT_MS = 30_000;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function resolveProjectSourcePath(args: {
  sources: Array<{ hostId: string; path: string; isDefault: boolean }>;
  hostId: string;
}): string | null {
  const onHost = args.sources.find((source) => source.hostId === args.hostId);
  if (onHost !== undefined) return onHost.path;
  const defaults = args.sources.filter((source) => source.isDefault);
  return defaults[0]?.path ?? args.sources[0]?.path ?? null;
}

function isSamePath(left: string, right: string): boolean {
  const normalize = (value: string): string =>
    value.replace(/\\/g, "/").replace(/\/+$/u, "");
  return normalize(left) === normalize(right);
}

/** Builtin Worktree provider id — those rows already appear in Reuse. */
const BB_GIT_WORKTREE_PROVIDER_ID = "git-worktree";

/**
 * Paths created by the builtin Worktree plugin live under its host-data
 * worktrees root, e.g.
 * `.../environment-git-worktree/host-data/worktrees/<key>/<repo>`.
 */
function isBbManagedWorktreePath(worktreePath: string): boolean {
  const normalized = worktreePath.replace(/\\/g, "/");
  return (
    normalized.includes("/environment-git-worktree/host-data/worktrees/") ||
    /\/plugins\/environment-git-worktree\/[^/]+\/worktrees\//u.test(normalized)
  );
}

export default async function gitWorktreesPlugin(
  bb: BbPluginApi,
): Promise<void> {
  const host = bb.hosts.experimental_client({
    contract: gitWorktreesHostContract,
  });

  async function bbManagedWorktreePaths(args: {
    projectId: string;
    hostId: string;
  }): Promise<Set<string>> {
    const paths = new Set<string>();
    const environments = await bb.sdk.environments.list({
      projectId: args.projectId,
      hostId: args.hostId,
      environmentProviderId: BB_GIT_WORKTREE_PROVIDER_ID,
    });
    for (const environment of environments) {
      if (typeof environment.path === "string" && environment.path.length > 0) {
        paths.add(environment.path.replace(/\\/g, "/").replace(/\/+$/u, ""));
      }
    }
    return paths;
  }

  function isSelectableExternalWorktree(args: {
    entry: { path: string; prunable: boolean };
    sourcePath: string;
    bbManagedPaths: Set<string>;
  }): boolean {
    const { entry, sourcePath, bbManagedPaths } = args;
    if (entry.prunable) return false;
    if (isSamePath(entry.path, sourcePath)) return false;
    if (isBbManagedWorktreePath(entry.path)) return false;
    const normalized = entry.path.replace(/\\/g, "/").replace(/\/+$/u, "");
    if (bbManagedPaths.has(normalized)) return false;
    return true;
  }

  bb.rpc.register(gitWorktreesRpcContract, {
    async listWorktrees({ projectId, hostId }) {
      const project = await bb.sdk.projects.get({ projectId });
      const sourcePath = resolveProjectSourcePath({
        sources: project.sources,
        hostId,
      });
      if (sourcePath === null) {
        throw new Error("This project has no checkout on the selected machine.");
      }
      const [result, bbManagedPaths] = await Promise.all([
        host.call(
          "listWorktrees",
          { sourcePath },
          { hostId, timeoutMs: LIST_TIMEOUT_MS },
        ),
        bbManagedWorktreePaths({ projectId, hostId }),
      ]);
      const worktrees = result.worktrees.filter((entry) =>
        isSelectableExternalWorktree({ entry, sourcePath, bbManagedPaths }),
      );
      return { sourcePath, worktrees };
    },
  });

  bb.experimental_environments.register({
    id: GIT_WORKTREES_ENVIRONMENT_PROVIDER_ID,
    displayName: "Git worktrees",
    description:
      "Attach an existing non-BB git worktree from this project's `git worktree list`.",
    icon: "FolderGit",
    requires: { gitCheckout: true },
    inputs: gitWorktreesInputsSchema,
    policy: { retireGraceMs: null },
    async availability(context) {
      if (context.projectCheckout === null) {
        return {
          status: "unavailable",
          message: "Project checkout is required on this machine.",
        };
      }
      try {
        const sourcePath = context.projectCheckout.path;
        const [result, bbManagedPaths] = await Promise.all([
          host.call(
            "listWorktrees",
            { sourcePath },
            { hostId: context.host.id, timeoutMs: LIST_TIMEOUT_MS },
          ),
          bbManagedWorktreePaths({
            projectId: context.project.id,
            hostId: context.host.id,
          }),
        ]);
        const selectable = result.worktrees.filter((entry) =>
          isSelectableExternalWorktree({ entry, sourcePath, bbManagedPaths }),
        );
        if (selectable.length === 0) {
          return {
            status: "unavailable",
            message: "No external git worktrees for this project.",
          };
        }
        return { status: "available" };
      } catch (error) {
        return {
          status: "unavailable",
          message: errorMessage(error),
        };
      }
    },
    async validate(context) {
      const sourcePath = context.projectCheckout.path;
      const selectedPath = context.inputs.path;
      if (isSamePath(selectedPath, sourcePath)) {
        return {
          action: "refuse",
          message:
            "Use Project checkout for the project's main directory. Pick another git worktree.",
        };
      }
      if (isBbManagedWorktreePath(selectedPath)) {
        return {
          action: "refuse",
          message:
            "That worktree was created by BB. Reuse it from the environment picker instead.",
        };
      }
      const bbManagedPaths = await bbManagedWorktreePaths({
        projectId: context.project.id,
        hostId: context.host.id,
      });
      const normalizedSelected = selectedPath
        .replace(/\\/g, "/")
        .replace(/\/+$/u, "");
      if (bbManagedPaths.has(normalizedSelected)) {
        return {
          action: "refuse",
          message:
            "That worktree was created by BB. Reuse it from the environment picker instead.",
        };
      }
      try {
        const result = await host.call(
          "attach",
          { sourcePath, path: selectedPath },
          { hostId: context.host.id, timeoutMs: ATTACH_TIMEOUT_MS },
        );
        if (result.status === "failed") {
          return { action: "refuse", message: result.message };
        }
        return { action: "accept" };
      } catch (error) {
        return { action: "refuse", message: errorMessage(error) };
      }
    },
    async create(context) {
      const sourcePath = context.projectCheckout.path;
      const selectedPath = context.inputs.path;
      if (!(await context.experimental_claimPath(selectedPath))) {
        return {
          status: "failed",
          message:
            "Another live thread is already using this worktree. Reuse that environment instead.",
        };
      }
      context.report.step("Attaching existing git worktree…");
      try {
        const result = await host.call(
          "attach",
          { sourcePath, path: selectedPath },
          {
            hostId: context.host.id,
            signal: context.signal,
            timeoutMs: ATTACH_TIMEOUT_MS,
          },
        );
        if (result.status === "failed") {
          return { status: "failed", message: result.message };
        }
        return {
          status: "created",
          path: result.path,
          ownsPath: false,
        };
      } catch (error) {
        if (context.signal.aborted) throw error;
        return { status: "failed", message: errorMessage(error) };
      }
    },
    async remove() {
      // Attached paths are not owned by bb; never delete the worktree.
      return { status: "removed" };
    },
  });
}
