import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type {
  Directory,
  ProjectDetail,
  Session,
  WorkspaceDetail,
} from "@/domain/types";
import { keymapQuery } from "@/features/keymap/api";
import { keyboardChord, shortcutOverlayOpen } from "@/features/keymap/keyboard";
import { NewSessionDialog } from "@/features/terminal/NewSessionDialog";
import { sessionActions } from "@/features/terminal/sessionActions";
import { toast } from "@/lib/toast";
import { CommandPalette } from "./CommandPalette";
import type { ActionContext, ActionInvocation, AppAction } from "./model";

type Scope = {
  project: ProjectDetail | null;
  workspace: WorkspaceDetail | null;
  session: Session | null;
  pathname: string;
  busy: boolean;
  actions: {
    navigate: (path: string) => void;
    session: {
      close: () => void;
      create: (kind: "shell" | "codex", directory: Directory) => void;
    };
    global: {
      settings: () => void;
      toggleLeftSidebar: () => void;
      toggleRightSidebar: () => void;
    };
  };
};
export function useAppActions(scope: Scope) {
  const query = useQuery(keymapQuery());
  const [palette, setPalette] = useState<ActionInvocation | null>(null);
  const [creating, setCreating] = useState<{
    context: ActionContext;
    create: Scope["actions"]["session"]["create"];
  } | null>(null);
  const [lastKind, setLastKind] = useState<"shell" | "codex">("codex");
  const latest = useRef(scope);
  latest.current = scope;
  useEffect(() => {
    if (query.error) toast.error(query.error.message);
  }, [query.error]);
  useEffect(() => {
    function capture(): ActionInvocation {
      const source = latest.current;
      const { project, workspace, session, actions, pathname } = source;
      const context: ActionContext = Object.freeze({
        project,
        workspace,
        session,
        pathname,
        directory:
          (workspace ?? project)?.directories.find(
            (directory) => directory.path === session?.cwd,
          ) ?? null,
        scope: session
          ? "session"
          : workspace?.parent_workspace_id
            ? "fork"
            : workspace
              ? "workspace"
              : project
                ? "project"
                : "global",
      });
      const globalActions: AppAction[] = [
        {
          id: "app.settings.open",
          name: "Open Settings",
          scope: "global",
          available: () => true,
          run: actions.global.settings,
        },
        {
          id: "app.projects.open",
          name: "Open Projects",
          scope: "global",
          available: () => true,
          run: () => actions.navigate("/projects"),
        },
        {
          id: "app.leftSidebar.toggle",
          name: "Toggle Left Sidebar",
          scope: "global",
          available: () => true,
          run: actions.global.toggleLeftSidebar,
        },
        {
          id: "app.rightSidebar.toggle",
          name: "Toggle Right Sidebar",
          scope: "global",
          available: (context) => !!context.project,
          run: actions.global.toggleRightSidebar,
        },
      ];
      return {
        context,
        returnFocus:
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null,
        actions: [
          ...globalActions,
          ...sessionActions(
            {
              navigate: actions.navigate,
              close: actions.session.close,
              create: (captured) =>
                setCreating({ context: captured, create: actions.session.create }),
            },
            source.busy,
          ),
        ],
      };
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || shortcutOverlayOpen()) return;
      const chord = keyboardChord(event);
      const paletteBinding = query.data?.commands.find(
        (command) => command.id === "app.palette.open",
      )?.binding;
      if (!query.error && paletteBinding && chord === paletteBinding) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) setPalette(capture());
        return;
      }
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.closest('input, textarea, [contenteditable="true"]') &&
        !target.classList.contains("xterm-helper-textarea")
      )
        return;
      if (!query.data || query.error) return;
      const command = query.data.commands.find(
        (candidate) => candidate.binding === chord,
      );
      if (!command) return;
      const invocation = capture();
      const action = invocation.actions.find(
        (candidate) =>
          candidate.keymapId === command.id &&
          candidate.available(invocation.context),
      );
      if (!action) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) action.run(invocation.context);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [query.data, query.error]);
  const owner = creating?.context.workspace ?? creating?.context.project;
  return (
    <>
      {palette && (
        <CommandPalette
          invocation={palette}
          keymap={query.error ? undefined : query.data}
          onClose={() => setPalette(null)}
        />
      )}
      {creating && owner && (
        <NewSessionDialog
          key={owner.id}
          name={owner.name}
          directories={owner.directories}
          preferredDirectory={
            creating.context.directory?.id ??
            creating.context.project?.default_directory_id
          }
          initialKind={
            creating.context.session?.kind === "shell"
              ? "shell"
              : creating.context.session?.kind === "codex"
                ? "codex"
                : lastKind
          }
          onClose={() => setCreating(null)}
          onCreate={(kind, directory) => {
            setLastKind(kind);
            setCreating(null);
            creating.create(kind, directory);
          }}
        />
      )}
    </>
  );
}
