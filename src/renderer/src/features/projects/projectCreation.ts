import { request, ApiError } from "@/api/client";
import type { Project, ProjectSource, ProjectCreation } from "@/domain/types";
import i18n from "@/i18n";

export const projectCreationApi = {
  validate: (name: string, source: ProjectSource, signal?: AbortSignal) =>
    request<{ path: string | null }>("/api/projects/validate-source", { method: "POST", json: { name, source }, signal }),
  create: (json: ProjectCreation) => request<Project>("/api/projects", { method: "POST", json }),
};

export function projectCreationError(cause: unknown): string {
  if (cause instanceof ApiError) {
    switch (cause.code) {
      case "PROJECT_NAME_REQUIRED": return i18n.t("projectsUi.creation.nameRequired");
      case "INVALID_GIT_URL": return i18n.t("projectsUi.creation.invalidUrl");
      case "GIT_REMOTE_TIMEOUT": return i18n.t("projectsUi.creation.remoteTimeout");
      case "GIT_REMOTE_UNAVAILABLE": return i18n.t("projectsUi.creation.remoteUnavailable");
      case "INVALID_PROJECT_FOLDER_NAME": return i18n.t("projectsUi.creation.invalidFolderName");
      case "INVALID_PROJECT_PARENT": return i18n.t("projectsUi.creation.invalidParent");
      case "PROJECT_PARENT_NOT_WRITABLE": return i18n.t("projectsUi.creation.parentNotWritable");
      case "PROJECT_DESTINATION_EXISTS": return i18n.t("projectsUi.creation.destinationExists");
    }
  }
  return cause instanceof Error ? cause.message : i18n.t("projectsUi.creation.failed");
}

export function suggestedRepositoryName(url: string): string {
  return url.trim().split(/[?#]/)[0].replace(/\/+$/, "").split(/[/:]/).at(-1)?.replace(/\.git$/, "") ?? "";
}
