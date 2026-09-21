---
name: git-worktrees
description: Attach an existing git worktree from the project's git worktree list when starting a BB thread.
---

# Git worktrees

Use the **Git worktrees** environment provider in the New Thread composer when
the worktree already exists on disk (for example one created by Herdr, another
tool, or `git worktree add` outside bb).

## When to use it

- Prefer **Worktree** when bb should create a fresh isolated worktree.
- Prefer **Project checkout** for the project's main directory.
- Prefer **Git worktrees** to attach an external path from `git worktree list`
  (Herdr, manual `git worktree add`, etc.). BB-created worktrees are omitted;
  reuse those from the default environment / Reuse picker.

## How to use it

1. Choose a project that has a git checkout on the selected machine.
2. In the environment picker, choose **Git worktrees**.
3. Use the **Worktree:** chip to pick a branch/path from the project's git
   worktree list (the main checkout and BB-managed worktrees are omitted).
4. Start the thread. bb attaches the path and does **not** delete it when the
   environment is retired.

## Notes

- bb only lists worktrees that belong to the project's checkout on that machine.
- BB-managed worktrees (builtin Worktree provider) are never listed here.
- If another live thread already holds the path, reuse that environment instead.
