import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  Directory,
  ProjectDetail,
  Session,
  WorkspaceDetail,
} from "@/domain/types";
import { keymapQuery, type CommandId } from "@/features/keymap/api";
import { keyboardChord, shortcutOverlayOpen } from "@/features/keymap/keyboard";
import { NewSessionDialog } from "./NewSessionDialog";
import { toast } from "@/lib/toast";

type Scope = {
  project: ProjectDetail | null;
  workspace: WorkspaceDetail | null;
  session: Session | null;
  busy: boolean;
  actions: {
    close: () => void;
    create: (kind: "shell" | "codex", directory: Directory) => void;
    navigate: (path: string) => void;
  };
};
export function useSessionShortcuts(scope: Scope) {
  const query = useQuery(keymapQuery());
  const [creating, setCreating] = useState(false);
  const [lastKind, setLastKind] = useState<"shell" | "codex">("codex");
  const latest = useRef(scope);
  latest.current = scope;
  useEffect(() => {
    if (query.error) toast.error(query.error.message);
  }, [query.error]);
  useEffect(() => {
    if (!query.data || query.error) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || shortcutOverlayOpen()) return;
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable="true"]') &&
        !target.classList.contains("xterm-helper-textarea")
      )
        return;
      const chord = keyboardChord(event);
      const command = query.data.commands.find(
        (candidate) => candidate.binding === chord,
      );
      if (!command) return;
      const { project, workspace, session, busy, actions } = latest.current;
      if (
        busy ||
        !project ||
        project.status !== "active" ||
        (workspace && workspace.status !== "active")
      )
        return;
      const sessions = (workspace?.sessions ?? project.sessions).filter(
        (candidate) =>
          candidate.visibility === "visible" && candidate.status === "running",
      );
      const actionsById: Record<CommandId, (() => void) | undefined> = {
        "session.new": () => setCreating(true),
        "session.close": session ? actions.close : undefined,
        "session.next": sessions.length ? () => switchSession(1) : undefined,
        "session.previous": sessions.length
          ? () => switchSession(-1)
          : undefined,
      };
      function switchSession(direction: number) {
        const index = sessions.findIndex(
          (candidate) => candidate.id === session?.id,
        );
        const next =
          sessions[
            index < 0
              ? direction > 0
                ? 0
                : sessions.length - 1
              : (index + direction + sessions.length) % sessions.length
          ];
        actions.navigate(
          `${workspace ? `/workspaces/${workspace.id}` : `/projects/${project!.id}`}/sessions/${next.id}`,
        );
      }
      const action = actionsById[command.id];
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) action();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [query.data, query.error]);
  const owner = scope.workspace ?? scope.project;
  if (!creating || !owner) return null;
  const directories = owner.directories;
  return (
    <NewSessionDialog
      key={owner.id}
      name={owner.name}
      directories={directories}
      preferredDirectory={
        directories.find((directory) => scope.session?.cwd === directory.path)
          ?.id ?? scope.project?.default_directory_id
      }
      initialKind={
        scope.session?.kind === "shell"
          ? "shell"
          : scope.session?.kind === "codex"
            ? "codex"
            : lastKind
      }
      onClose={() => setCreating(false)}
      onCreate={(kind, directory) => {
        setLastKind(kind);
        setCreating(false);
        scope.actions.create(kind, directory);
      }}
    />
  );
}
