# Git worktrees

BB plugin that adds a **Git worktrees** environment provider. It lists paths
from `git worktree list` for the selected project and attaches one without
creating or deleting worktrees.

## Install

```bash
bb plugin install /home/fabricioereche/getbb.app/bb-plugin-git-worktrees
```

## Develop

```bash
bb plugin install .
bb plugin dev
```

## Use

In New Thread, choose a project, open the environment picker, select
**Git worktrees**, then pick a worktree from the **Worktree:** chip.
