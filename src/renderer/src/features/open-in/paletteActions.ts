import type { TFunction } from "i18next";
import type { ActionContext, ActionHandlers, PaletteEntry } from "@/features/actions/model";
import { ownerScope } from "@/features/actions/model/context";
import { toast } from "@/lib/toast";

export function openInPaletteActions(t: TFunction): ActionHandlers<"directory.open.with"> {
  const desktop = window.treefoldDesktop;
  const directories = (context: ActionContext) =>
    context.workspace?.directories ?? context.project?.directories ?? [];

  async function applications(context: ActionContext, path: string): Promise<PaletteEntry[]> {
    const apps = await desktop!.listOpenInApps();
    return apps.map((app) => ({
      id: `directory.open.with:${app.id}`,
      actionId: "directory.open.with",
      name: app.label,
      label: app.label,
      scope: ownerScope(context),
      run: () => {
        void desktop!.openInApp(app.id, path).catch((cause: unknown) => {
          toast.errorFrom(cause, t("sidebar.openInFailed"));
        });
      },
    }));
  }

  return {
    "directory.open.with": {
      paletteScope: ownerScope,
      available: (context) => Boolean(desktop) && directories(context).length > 0,
      children: (context) => {
        const choices = directories(context);
        if (choices.length === 1) return applications(context, choices[0].path);
        return choices.map((directory) => ({
          id: `directory.open.with:${directory.id}`,
          actionId: "directory.open.with",
          name: directory.name,
          label: choices.filter((choice) => choice.name === directory.name).length > 1
            ? `${directory.name} · ${directory.relative_path ?? directory.path}`
            : directory.name,
          scope: ownerScope(context),
          children: () => applications(context, directory.path),
        }));
      },
    },
  };
}
