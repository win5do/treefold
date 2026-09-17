import i18n from "@/i18n";
export function formatRepositoryRelativePath(path?: string) {
  return !path || path === "." ? i18n.t("feedback.root") : path;
}
