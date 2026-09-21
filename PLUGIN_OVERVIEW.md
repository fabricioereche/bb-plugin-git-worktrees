Attach existing git worktrees from `git worktree list` when starting a thread.

## What you get

- A **Git worktrees** row in the New Thread environment picker (after Project
  checkout and Worktree).
- A **Worktree:** chip that lists external worktrees for the selected project's
  checkout on the selected machine (BB-created worktrees are omitted — use
  Reuse / the default Worktree row for those).
- Attach-only environments: bb never deletes the chosen worktree on cleanup.

## How it works

On the selected machine the plugin runs `git worktree list --porcelain` against
the project's source checkout, hides the main checkout and any BB-managed
worktree paths, and attaches the path you pick with `ownsPath: false`.
