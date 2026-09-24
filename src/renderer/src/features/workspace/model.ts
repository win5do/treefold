import type {
  Directory,
  ProjectDetail,
  Session,
  Workspace,
  WorkspaceDetail,
  WorkspaceDirectory,
  WorkspaceRepository,
} from "@/domain/types";

export function normalizeProject(value: ProjectDetail): ProjectDetail {
  const defaultDirectoryId =
    value.default_directory_id ??
    value.default_location_id ??
    value.primary_directory_id;
  const repositoryById = new Map(
    (value.repositories ?? []).map((repository) => [repository.id, repository]),
  );
  const rawDirectories = (value.directories ?? []) as Directory[];
  const directories = rawDirectories.map((directory) => {
    const repository = directory.repository_id
      ? repositoryById.get(directory.repository_id)
      : undefined;
    return {
      ...directory,
      worktree_setup_command:
        repository?.setup_command ?? directory.worktree_setup_command ?? "",
      repository_url: repository?.repository_url,
      repository_name: repository?.name,
      preferred_remote_name: repository?.preferred_remote_name,

      git_common_dir: repository?.git_common_dir,
      git_status:
        repository?.git_status ??
        directory.status ??
        directory.git_status ??
        "not_git",
      role:
        defaultDirectoryId === directory.id
          ? ("primary" as const)
          : ("attached" as const),
      is_git: Boolean(repository),
      remote_url: repository?.repository_url,
      dirty: directory.dirty ?? false,
    };
  });
  const primary = directories.find(
    (directory) => defaultDirectoryId === directory.id,
  );
  const primaryRepository = primary?.repository_id
    ? repositoryById.get(primary.repository_id)
    : undefined;
  return {
    ...value,
    default_directory_id: defaultDirectoryId,
    default_location_id: defaultDirectoryId,
    primary_directory_id: defaultDirectoryId ?? "",
    git_common_dir: primaryRepository?.git_common_dir ?? "",
    preferred_remote: primaryRepository?.preferred_remote_name,
    directories,
    repositories: value.repositories ?? [],
    sessions: value.sessions ?? [],
    workspaces: value.workspaces ?? [],
    worktrees: value.worktrees ?? [],
  };
}

export function normalizeWorkspace(value: WorkspaceDetail): WorkspaceDetail {
  const repositories = (value.repositories ?? []) as WorkspaceRepository[];
  const rawDirectories = (value.workspace_directories ??
    value.directories ??
    []) as unknown as WorkspaceDirectory[];
  const repositoryById = new Map(
    repositories.map((repository) => [repository.id, repository]),
  );
  const defaultDirectoryId =
    value.project.default_directory_id ?? value.project.default_location_id;
  const directories: Directory[] = rawDirectories.map((directory) => {
    const repository = directory.workspace_repository_id
      ? repositoryById.get(directory.workspace_repository_id)
      : undefined;
    return {
      id: directory.project_directory_id,
      project_id: value.project.id,
      repository_id: repository?.project_repository_id,
      repository_name: repository?.repository_name,
      name: directory.name,
      description: directory.description,
      relative_path: directory.relative_path,
      external_path: directory.external_path,
      status: directory.status,
      worktree_setup_command: "",
      path: directory.path,
      checkout_path: directory.path,
      role:
        defaultDirectoryId === directory.project_directory_id
          ? "primary"
          : "attached",
      is_git: Boolean(repository),
      git_status: repository?.git_status ?? directory.status,
      branch: repository?.branch,
      dirty: false,
    };
  });
  const primaryDirectory =
    rawDirectories.find(
      (directory) => directory.project_directory_id === defaultDirectoryId,
    ) ?? rawDirectories.find((directory) => directory.workspace_repository_id);
  const primary = primaryDirectory?.workspace_repository_id
    ? repositoryById.get(primaryDirectory.workspace_repository_id)
    : repositories[0];
  return {
    ...value,
    checkout_mode: "worktree",
    project_directory_id: primaryDirectory?.project_directory_id ?? "",
    checkout_path:
      primaryDirectory?.path ??
      primary?.checkout_path ??
      primary?.source_root ??
      "",
    target_branch: primary?.base_branch ?? "",
    start_commit: primary?.start_commit ?? "",
    branch: primary?.branch ?? "",
    remote_name: primary?.remote_name,
    remote_branch: primary?.remote_branch,
    branch_ownership: primary?.branch_ownership ?? "managed",
    delivery_status: primary?.delivery_status ?? "active",
    repositories,
    workspace_directories: rawDirectories,
    directories,
    sessions: value.sessions ?? [],
    todos: value.todos ?? [],
    forks: value.forks ?? [],
  };
}

export function upsertSession(
  sessions: Session[],
  session: Session,
): Session[] {
  const index = sessions.findIndex((item) => item.id === session.id);
  if (index === -1) return [...sessions, session];
  return sessions.map((item, itemIndex) =>
    itemIndex === index ? session : item,
  );
}

export function updateProjectWorkspaceSessions(
  projects: ProjectDetail[],
  workspaceId: string,
  sessions: Session[],
): ProjectDetail[] {
  return projects.map((project) => ({
    ...project,
    workspaces: project.workspaces.map((stream) =>
      stream.id === workspaceId ? { ...stream, sessions } : stream,
    ),
  }));
}
