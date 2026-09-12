import type { AppAction, ActionContext } from "@/features/actions/model";

export function sessionActions(
  handlers: {
    create: (context: ActionContext) => void;
    close: () => void;
    navigate: (path: string) => void;
  },
  busy: boolean,
): AppAction[] {
  const active = (context: ActionContext) =>
    !busy &&
    context.project?.status === "active" &&
    (!context.workspace || context.workspace.status === "active");
  const sessions = (context: ActionContext) =>
    (context.workspace?.sessions ?? context.project?.sessions ?? []).filter(
      (session) =>
        session.visibility === "visible" && session.status === "running",
    );
  function cycle(context: ActionContext, direction: number) {
    const candidates = sessions(context);
    const index = candidates.findIndex(
      (session) => session.id === context.session?.id,
    );
    const next =
      candidates[
        index < 0
          ? direction > 0
            ? 0
            : candidates.length - 1
          : (index + direction + candidates.length) % candidates.length
      ];
    if (!next) return;
    handlers.navigate(
      `${context.workspace ? `/workspaces/${context.workspace.id}` : `/projects/${context.project!.id}`}/sessions/${next.id}`,
    );
  }
  return [
    {
      id: "session.create.new",
      name: "New Session",
      scope: "session",
      keymapId: "session.new",
      available: active,
      run: handlers.create,
    },
    {
      id: "session.lifecycle.close",
      name: "Close Session",
      scope: "session",
      keymapId: "session.close",
      available: (context) => active(context) && !!context.session,
      run: handlers.close,
    },
    {
      id: "session.navigate.next",
      name: "Next Session",
      scope: "session",
      keymapId: "session.next",
      available: (context) => active(context) && sessions(context).length > 0,
      run: (context) => cycle(context, 1),
    },
    {
      id: "session.navigate.previous",
      name: "Previous Session",
      scope: "session",
      keymapId: "session.previous",
      available: (context) => active(context) && sessions(context).length > 0,
      run: (context) => cycle(context, -1),
    },
  ];
}
