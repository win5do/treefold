export function formatRepositoryRelativePath(path?: string) {
  return !path || path === "." ? "Root" : path;
}
