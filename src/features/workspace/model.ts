import type { ProjectDetail, Session, Workspace, WorkspaceDetail } from "@/domain/types";

export function normalizeProject(value: ProjectDetail): ProjectDetail {
  const locations = value.locations ?? value.directories ?? [];
  const directories = locations.map((location) => ({ ...location, git_status: location.git_status ?? (location.is_git ? "ready" : "not_git"), role: (value.default_location_id ?? value.primary_directory_id) === location.id ? "primary" as const : "attached" as const, is_git: location.git_status ? location.git_status === "ready" : location.is_git, remote_url: location.repository_url ?? location.remote_url }));
  const primary = directories.find((location) => value.default_location_id === location.id);
  return { ...value, default_base_branch: value.default_base_branch ?? value.default_target_branch ?? "main", default_target_branch: value.default_base_branch ?? value.default_target_branch ?? "main", primary_directory_id: value.default_location_id ?? "", git_common_dir: primary?.git_common_dir ?? "", preferred_remote: primary?.preferred_remote_name, locations: directories, directories, sessions: value.sessions ?? [], workspaces: value.workspaces ?? [], worktrees: value.worktrees ?? [] };
}

export function normalizeWorkspace(value: WorkspaceDetail): WorkspaceDetail {
  const locations = value.locations ?? (value.directories ?? []).map((directory) => ({ id: `workspace-location-${directory.id}`, workspace_id: value.id, project_location_id: directory.id, location_name: directory.name, source_path: directory.path, access_mode: directory.is_git ? "read_write" as const : "read_only" as const, git_status: directory.git_status ?? (directory.is_git ? "ready" as const : "not_git" as const), checkout_path: directory.checkout_path, branch: value.branch, base_branch: value.target_branch, start_commit: value.start_commit, remote_name: value.remote_name, remote_branch: value.remote_branch, delivery_mode: value.delivery_mode, delivery_status: value.delivery_status }));
  const primary = locations.find((location) => value.project.default_location_id === location.project_location_id && location.git_status === "ready") ?? locations.find((location) => location.access_mode === "read_write" && location.git_status === "ready") ?? locations.find((location) => value.project.default_location_id === location.project_location_id) ?? locations.find((location) => location.access_mode === "read_write");
  const directories = locations.map((location) => ({ id: location.project_location_id, project_id: value.project.id, name: location.location_name, description: "", worktree_setup_command: "", path: location.source_path, checkout_path: location.checkout_path, role: value.project.default_location_id === location.project_location_id ? "primary" as const : "attached" as const, is_git: location.access_mode === "read_write", git_status: location.git_status, dirty: false }));
  return {
    ...value,
    checkout_mode: "worktree",
    project_directory_id: primary?.project_location_id ?? "",
    checkout_path: primary?.checkout_path ?? primary?.source_path ?? value.checkout_path ?? "",
    target_branch: primary?.base_branch ?? value.target_branch ?? "",
    start_commit: primary?.start_commit ?? value.start_commit ?? "",
    branch: primary?.branch ?? value.branch ?? "",
    remote_name: primary?.remote_name,
    remote_branch: primary?.remote_branch,
    branch_ownership: "managed",
    delivery_mode: (primary?.delivery_mode as Workspace["delivery_mode"]) ?? "remote_review",
    delivery_status: primary?.delivery_status ?? "active",
    locations,
    directories,
    sessions: value.sessions ?? [],
    todos: value.todos ?? [],
    forks: value.forks ?? [],
  };
}

export function upsertSession(sessions: Session[], session: Session): Session[] {
  const index = sessions.findIndex((item) => item.id === session.id);
  if (index === -1) return [...sessions, session];
  return sessions.map((item, itemIndex) => itemIndex === index ? session : item);
}

export function updateProjectWorkspaceSessions(projects: ProjectDetail[], workspaceId: string, sessions: Session[]): ProjectDetail[] {
  return projects.map((project) => ({
    ...project,
    workspaces: project.workspaces.map((stream) => stream.id === workspaceId ? { ...stream, sessions } : stream),
  }));
}
