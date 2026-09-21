import {
  definePluginApp,
  experimental_Icon as Icon,
  useRpc,
  type PluginEnvironmentProviderInputsProps,
} from "@get-bb/plugin-sdk/app";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "./components/ui/button.js";
import { cn } from "./lib/utils.js";
import type { gitWorktreesRpcContract, GitWorktreeEntry } from "./contract.js";
import { GIT_WORKTREES_ENVIRONMENT_PROVIDER_ID } from "./provider-id.js";

function parseSelectedPath(value: unknown): string | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const path = (value as { path?: unknown }).path;
  return typeof path === "string" && path.length > 0 ? path : null;
}

function worktreeLabel(entry: GitWorktreeEntry): string {
  if (entry.branch !== null) return entry.branch;
  if (entry.detached && entry.head !== null) {
    return `detached ${entry.head.slice(0, 7)}`;
  }
  const parts = entry.path.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] ?? entry.path;
}

function WorktreeInputs({
  projectId,
  target,
  value,
  onChange,
}: PluginEnvironmentProviderInputsProps) {
  const rpc = useRpc<typeof gitWorktreesRpcContract>();
  const hostId = target.kind === "existing-host" ? target.hostId : null;
  const selectedPath = parseSelectedPath(value);
  const [worktrees, setWorktrees] = useState<GitWorktreeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (projectId === null || hostId === null) {
      setWorktrees(null);
      setError(null);
      onChangeRef.current({
        status: "blocked",
        reason: "Select a connected machine first.",
      });
      return;
    }

    let cancelled = false;
    setWorktrees(null);
    setError(null);
    onChangeRef.current({
      status: "blocked",
      reason: "Loading git worktrees…",
    });

    void rpc
      .call("listWorktrees", { projectId, hostId })
      .then((result) => {
        if (cancelled) return;
        setWorktrees(result.worktrees);
        setError(null);
        if (result.worktrees.length === 0) {
          onChangeRef.current({
            status: "blocked",
            reason: "No external git worktrees for this project.",
          });
          return;
        }
        const stillValid =
          selectedPath !== null &&
          result.worktrees.some((entry) => entry.path === selectedPath);
        const nextPath = stillValid
          ? selectedPath
          : result.worktrees[0]!.path;
        onChangeRef.current({
          status: "ready",
          value: { path: nextPath },
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : "Failed to list git worktrees.";
        setWorktrees([]);
        setError(message);
        onChangeRef.current({ status: "blocked", reason: message });
      });

    return () => {
      cancelled = true;
    };
    // Re-load when project/host change; selectedPath is applied after fetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, hostId, rpc]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const selected = useMemo(() => {
    if (worktrees === null || selectedPath === null) return null;
    return worktrees.find((entry) => entry.path === selectedPath) ?? null;
  }, [worktrees, selectedPath]);

  const label =
    worktrees === null
      ? "Loading…"
      : error !== null
        ? "Unavailable"
        : selected !== null
          ? worktreeLabel(selected)
          : worktrees.length === 0
            ? "None"
            : "Pick worktree";

  return (
    <div ref={rootRef} className="relative">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={worktrees === null || worktrees.length === 0}
        aria-label="Git worktree"
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          "border-none bg-transparent shadow-none",
          "text-muted-foreground hover:text-foreground",
        )}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="min-w-0 truncate">
          <span className="text-muted-foreground">Worktree:</span>{" "}
          <span className="text-foreground">{label}</span>
        </span>
        <Icon name="ChevronDown" className="size-3.5 shrink-0 opacity-70" />
      </Button>
      {open && worktrees !== null && worktrees.length > 0 ? (
        <div
          role="listbox"
          className="absolute bottom-full left-0 z-50 mb-1 max-h-64 w-80 overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {worktrees.map((entry) => {
            const isSelected = entry.path === selectedPath;
            return (
              <button
                key={entry.path}
                type="button"
                role="option"
                aria-selected={isSelected}
                className={cn(
                  "flex w-full flex-col items-stretch gap-0.5 rounded-sm px-2 py-1.5 text-left text-xs",
                  "hover:bg-state-hover",
                  isSelected && "bg-state-active",
                )}
                onClick={() => {
                  onChange({ status: "ready", value: { path: entry.path } });
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Icon
                    name="FolderGit"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                  <span className="min-w-0 truncate font-medium">
                    {worktreeLabel(entry)}
                  </span>
                  {isSelected ? (
                    <Icon name="Check" className="ml-auto size-3.5 shrink-0" />
                  ) : null}
                </span>
                <span className="truncate pl-5 text-muted-foreground">
                  {entry.path}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_environmentProviderInputs({
    environmentProviderId: GIT_WORKTREES_ENVIRONMENT_PROVIDER_ID,
    component: WorktreeInputs,
  });
});
