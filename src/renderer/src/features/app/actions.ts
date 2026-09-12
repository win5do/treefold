import type { ActionHandlers, AppActionId } from "@/features/actions/model";

export function appActionHandlers(handlers: {
  settings: () => void;
  navigate: (path: string) => void;
  toggleLeftSidebar: () => void;
  toggleRightSidebar: () => void;
  openPalette: () => void;
}): ActionHandlers<AppActionId> {
  return {
    "app.settings.open": { available: () => true, run: handlers.settings },
    "app.projects.open": {
      available: () => true,
      run: () => handlers.navigate("/projects"),
    },
    "app.leftSidebar.toggle": {
      available: () => true,
      run: handlers.toggleLeftSidebar,
    },
    "app.rightSidebar.toggle": {
      available: (context) => !!context.project,
      run: handlers.toggleRightSidebar,
    },
    "app.palette.open": { available: () => true, run: handlers.openPalette },
  };
}
