import { FolderPlus, Folders } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RecordActionMenu } from "@/features/app/RecordActions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import type { ProjectSummary } from "@/domain/types";
import { cn } from "@/lib/utils";

export function Overview({
  projects,
  busy,
  onOpen,
  onCreate,
  onRestore,
  onDelete,
  onDeleteBlocked,
}: {
  projects: ProjectSummary[];
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onRestore: (project: ProjectSummary) => void;
  onDelete: (project: ProjectSummary) => void;
  onDeleteBlocked: (project: ProjectSummary) => void;
}) {
  const { t, i18n } = useTranslation();
  const nameCollator = new Intl.Collator(i18n.resolvedLanguage, {
    numeric: true,
    sensitivity: "base",
  });
  const rows = [...projects].sort((left, right) => {
    if (left.status !== right.status) return left.status === "active" ? -1 : 1;
    return nameCollator.compare(left.name, right.name);
  });
  return (
    <div
      data-testid="page-scroll"
      className="h-full overflow-y-auto p-5 [scrollbar-gutter:stable] sm:p-8 lg:p-12"
    >
      <div data-testid="page-content" className="mx-auto max-w-[96rem]">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs text-muted-foreground">
              {t("overview.eyebrow")}
            </p>
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">
              {t("overview.title")}
            </h1>
          </div>
          <Button data-testid="new-project-action" onClick={onCreate}>
            <FolderPlus data-icon="inline-start" />
            {t("overview.newProject")}
          </Button>
        </div>
        {projects.length === 0 ? (
          <Empty className="mt-8 min-h-64">
            <EmptyHeader>
              <EmptyTitle>{t("overview.empty")}</EmptyTitle>
              <EmptyDescription>
                {t("overview.emptyDescription")}
              </EmptyDescription>
              <EmptyDescription>{t("overview.emptyHint")}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[760px] table-fixed text-left">
              <thead>
                <tr className="border-b border-border/60 bg-muted/50 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="w-[32%] px-4 py-3">
                    {t("overview.columns.project")}
                  </th>
                  <th className="w-[27%] px-4 py-3">
                    {t("overview.columns.locations")}
                  </th>
                  <th className="w-[18%] px-4 py-3">
                    {t("overview.columns.health")}
                  </th>
                  <th className="w-[13%] px-4 py-3">
                    {t("overview.columns.activeWorkspaces")}
                  </th>
                  <th className="w-[10%] px-4 py-3">
                    <span className="sr-only">
                      {t("overview.columns.actions")}
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {rows.map((project) => {
                  const gitLocations = project.git_location_count;
                  const contextLocations = project.context_location_count;
                  const missingLocations = project.missing_location_count;
                  const abnormalLocations = project.abnormal_location_count;
                  const health =
                    project.location_count === 0
                      ? t("overview.health.noLocations")
                      : [
                          missingLocations > 0
                            ? t("overview.health.missing", {
                                count: missingLocations,
                              })
                            : "",
                          abnormalLocations > 0
                            ? t("overview.health.abnormal", {
                                count: abnormalLocations,
                              })
                            : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || t("overview.health.healthy");
                  const activeWorkspaces = project.active_workspace_count;
                  return (
                    <tr
                      key={project.id}
                      data-testid="project-overview-row"
                      data-project-id={project.id}
                      data-project-status={project.status}
                      role="link"
                      tabIndex={0}
                      className={cn(
                        "cursor-pointer outline-none hover:bg-muted/50 focus-visible:bg-muted/50",
                        project.status === "archived" &&
                          "bg-muted/60 text-muted-foreground",
                      )}
                      onClick={() => onOpen(project.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          onOpen(project.id);
                        }
                      }}
                    >
                      <td className="px-4 py-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted">
                            <Folders className="size-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex min-w-0 items-center gap-2">
                              <p className="truncate text-sm font-semibold">
                                {project.name}
                              </p>
                              {project.status === "archived" && (
                                <Badge>{t("overview.archived")}</Badge>
                              )}
                            </div>
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              {project.description ||
                                t("overview.localProject")}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td
                        data-testid="project-overview-locations"
                        className="px-4 py-4 text-xs text-foreground"
                      >
                        {t("overview.locationSummary", {
                          locations: project.location_count,
                          git: gitLocations,
                          contextLocations,
                        })}
                      </td>
                      <td className="px-4 py-4">
                        <Badge
                          variant={
                            abnormalLocations > 0
                              ? "destructive"
                              : missingLocations > 0
                                ? "warning"
                                : project.location_count === 0
                                  ? "neutral"
                                  : "success"
                          }
                        >
                          {health}
                        </Badge>
                      </td>
                      <td
                        data-testid="project-overview-active-workspaces"
                        className="px-4 py-4 text-xs text-foreground"
                      >
                        {activeWorkspaces}
                      </td>
                      <td
                        className="px-4 py-4"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <div className="flex justify-end">
                          <RecordActionMenu
                            kind="project"
                            name={project.name}
                            status={project.status}
                            busy={busy}
                            onRestore={() => onRestore(project)}
                            onDelete={() => onDelete(project)}
                            onDeleteBlocked={() => onDeleteBlocked(project)}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
