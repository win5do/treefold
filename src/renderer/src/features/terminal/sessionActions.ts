import type {
  ActionHandlers,
  SessionActionId,
  ActionContext,
} from "@/features/actions/model";

export function sessionActionHandlers(
  handlers: {
    create: (context: ActionContext) => void;
    close: () => void;
    navigate: (path: string) => void;
  },
  busy: boolean,
): ActionHandlers<SessionActionId> {
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
  return {
    "session.create.new": {
      available: active,
      run: handlers.create,
    },
    "session.lifecycle.close": {
      available: (context) => active(context) && !!context.session,
      run: handlers.close,
    },
    "session.navigate.next": {
      available: (context) => active(context) && sessions(context).length > 0,
      run: (context) => cycle(context, 1),
    },
    "session.navigate.previous": {
      available: (context) => active(context) && sessions(context).length > 0,
      run: (context) => cycle(context, -1),
    },
  };
}
