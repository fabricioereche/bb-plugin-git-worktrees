import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const gitWorktreeEntrySchema = z
  .object({
    path: z.string().min(1),
    branch: z.string().min(1).nullable(),
    head: z.string().min(1).nullable(),
    detached: z.boolean(),
    locked: z.boolean(),
    prunable: z.boolean(),
  })
  .strict();

export type GitWorktreeEntry = z.infer<typeof gitWorktreeEntrySchema>;

export const gitWorktreesInputsSchema = z
  .object({
    path: z.string().min(1),
  })
  .strict();

export type GitWorktreesInputs = z.infer<typeof gitWorktreesInputsSchema>;

export const gitWorktreesHostContract = defineRpcContract({
  listWorktrees: {
    input: z
      .object({
        sourcePath: z.string().min(1),
      })
      .strict(),
    output: z
      .object({
        worktrees: z.array(gitWorktreeEntrySchema),
      })
      .strict(),
  },
  attach: {
    input: z
      .object({
        sourcePath: z.string().min(1),
        path: z.string().min(1),
      })
      .strict(),
    output: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("attached"),
          path: z.string().min(1),
          branch: z.string().min(1).nullable(),
        })
        .strict(),
      z
        .object({
          status: z.literal("failed"),
          message: z.string().min(1),
        })
        .strict(),
    ]),
  },
});

export const gitWorktreesRpcContract = defineRpcContract({
  listWorktrees: {
    input: z
      .object({
        projectId: z.string().min(1),
        hostId: z.string().min(1),
      })
      .strict(),
    output: z
      .object({
        sourcePath: z.string().min(1),
        worktrees: z.array(gitWorktreeEntrySchema),
      })
      .strict(),
  },
});
