import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { gitWorktreesHostContract } from "./contract.js";
import { attachExistingWorktree, listGitWorktrees } from "./host/git.js";

export function createGitWorktreesHostEntry() {
  return experimental_defineHostEntry({
    contract: gitWorktreesHostContract,
    handlers: {
      async listWorktrees(input, context) {
        const worktrees = await listGitWorktrees({
          sourcePath: input.sourcePath,
          signal: context.signal,
        });
        return { worktrees };
      },
      async attach(input, context) {
        try {
          return await attachExistingWorktree({
            sourcePath: input.sourcePath,
            path: input.path,
            signal: context.signal,
          });
        } catch (error) {
          if (context.signal.aborted) throw error;
          return {
            status: "failed" as const,
            message: error instanceof Error ? error.message : String(error),
          };
        }
      },
    },
  });
}

export default createGitWorktreesHostEntry();
