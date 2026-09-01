import type { LanguagePreference } from "@/i18n";

export type Project = {
  id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  default_directory_id?: string;
  default_location_id?: string;
  default_base_branch: string;
  primary_directory_id: string;
  git_common_dir: string;
  preferred_remote?: string;
  default_target_branch: string;
  default_delivery_mode: "push_branch" | "local_merge" | "keep";
  updated_at: string;
};

export type Directory = {
  id: string;
  project_id: string;
  repository_id?: string;
  repository_name?: string;
  name: string;
  description: string;
  relative_path?: string;
  external_path?: string;
  status?: "ready" | "not_git" | "missing" | "broken" | "mismatch";
  worktree_setup_command: string;
  path: string;
  repository_url?: string;
  preferred_remote_name?: string;
  base_branch?: string;
  delivery_mode?: "push_branch" | "local_merge" | "keep";
  git_common_dir?: string;
  git_status:
    | "creating"
    | "ready"
    | "failed"
    | "not_git"
    | "missing"
    | "broken"
    | "mismatch";
  last_checked_at?: string;
  checkout_path?: string;
  role: "primary" | "attached";
  is_git: boolean;
  remote_url?: string;
  branch?: string;
  head_commit?: string;
  head_summary?: string;
  dirty: boolean;
};

export type ProjectRepository = {
  id: string;
  project_id: string;
  name: string;
  source_root: string;
  git_common_dir: string;
  source_ownership: "managed" | "external";
  repository_url?: string;
  preferred_remote_name?: string;
  base_branch?: string;
  delivery_mode?: "push_branch" | "local_merge" | "keep";
  setup_command: string;
  setup_workdir: string;
  git_status: Directory["git_status"];
  last_checked_at?: string;
  created_at: string;
  updated_at: string;
};

export type ProjectDeleteResource = {
  path: string;
  repository_name: string;
  project_repository_id: string;
};

export type ProjectDeletePrecheck = {
  status: "ready" | "blocked";
  managed_sources: ProjectDeleteResource[];
  managed_worktrees: ProjectDeleteResource[];
  blockers: string[];
  warnings: string[];
};

export type Session = {
  id: string;
  workspace_id: string;
  name: string;
  kind: "shell" | "codex" | "command";
  cwd: string;
  original_cwd: string;
  initial_prompt: string;
  codex_session_id?: string;
  visibility: "visible" | "hidden";
  hidden_at?: string;
  evicted_at?: string;
  amux_workspace_name: string;
  amux_process_name: string;
  status: "running" | "stopped" | "exited" | "failed";
  exit_code?: number;
  exit_signal?: string;
  argv: string[];
  io_mode: "pipe" | "tty";
  launch_started_at: string;
  last_attached_at?: string;
  created_at: string;
  updated_at: string;
};

export type SessionMenuState = { id: string; x: number; y: number };

export type RenameTarget =
  | { kind: "project"; value: ProjectDetail }
  | { kind: "workspace" | "fork"; value: Workspace }
  | { kind: "session"; value: Session };

export type Workspace = {
  id: string;
  project_id: string;
  name: string;
  description: string;
  status: "active" | "archived";
  kind: "workspace" | "fork";
  parent_workspace_id?: string;
  checkout_mode: "worktree" | "in_place";
  project_directory_id: string;
  checkout_path: string;
  target_branch: string;
  start_commit: string;
  branch: string;
  forked_from_commit?: string;
  remote_name?: string;
  remote_branch?: string;
  branch_ownership: string;
  delivery_mode: "push_branch" | "local_merge" | "keep";
  delivery_status: string;
  close_outcome?: string;
  integrated_commit?: string;
  closed_at?: string;
  runtime_id: string;
  runtime_name: string;
  updated_at: string;
};

export type WorkspaceRepository = {
  id: string;
  workspace_id: string;
  project_repository_id: string;
  repository_name: string;
  source_root: string;
  access_mode: "read_write" | "read_only";
  git_status:
    | "creating"
    | "ready"
    | "failed"
    | "not_git"
    | "missing"
    | "broken"
    | "mismatch";
  creation_error?: string;
  checkout_path?: string;
  branch?: string;
  base_branch?: string;
  start_commit?: string;
  remote_name?: string;
  remote_branch?: string;
  delivery_mode: string;
  delivery_status: string;
  close_outcome?: string;
};

export type WorkspaceDirectory = {
  id: string;
  workspace_id: string;
  project_directory_id: string;
  workspace_repository_id?: string;
  name: string;
  description: string;
  relative_path?: string;
  external_path?: string;
  path: string;
  access_mode: "read_write" | "read_only";
  status: "ready" | "not_git" | "missing" | "broken" | "mismatch";
  created_at: string;
  updated_at: string;
};

export type ProjectDetail = Project & {
  repositories: ProjectRepository[];
  directories: Directory[];
  sessions: Session[];
  workspaces: Workspace[];
  worktrees: GitWorktree[];
};

export type ProjectSummary = Pick<
  Project,
  "id" | "name" | "description" | "status" | "updated_at"
> & {
  location_count: number;
  git_location_count: number;
  context_location_count: number;
  missing_location_count: number;
  abnormal_location_count: number;
  active_workspace_count: number;
};

export type SidebarWorkspace = Workspace & {
  sessions: Session[];
  repositories: WorkspaceRepository[];
  directories: WorkspaceDirectory[];
};
export type SidebarProject = Project & {
  repositories: ProjectRepository[];
  directories: Directory[];
  sessions: Session[];
  workspaces: SidebarWorkspace[];
};
export type SidebarData = { projects: SidebarProject[] };

export type Todo = {
  id: string;
  workspace_id: string;
  content: string;
  status: "pending" | "in_progress" | "blocked" | "done";
  fork_id?: string;
  blocked_reason?: string;
};

export type GitWorktree = {
  project_repository_id: string;
  repository_name: string;
  path: string;
  branch: string;
  head_commit: string;
  is_main: boolean;
  workspace_id?: string;
  workspace_name?: string;
};

export type WorktreeDeletePrecheck = {
  status: "ready" | "blocked" | "stale";
  directory_exists: boolean;
  tracked_changes: number;
  untracked_files: number;
  blockers: string[];
  warnings: string[];
};

export type WorktreeDeleteOperation = {
  id: string;
  repository_id: string;
  path: string;
  status: "deleting" | "completed" | "failed";
  error?: string;
};

export type GitCommit = {
  hash: string;
  short_hash: string;
  subject: string;
  author: string;
  authored_at: string;
};

export type GitHistory = { branch: string; commits: GitCommit[] };

export type GitSyncItemResult = {
  project_repository_id: string;
  workspace_repository_id?: string;
  repository_name: string;
  status: "success" | "failed" | "skipped";
  error?: string;
};

export type GitDiffComparison = {
  repository: string;
  resolved_base: string;
  resolved_head: string;
  commit_count: number;
  patch: string;
};

export type GitChangeFile = {
  path: string;
  old_path?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
  staged: boolean;
  has_staged_changes: boolean;
  has_unstaged_changes: boolean;
  additions: number;
  deletions: number;
  binary: boolean;
};

export type GitStatus = {
  branch: string;
  head?: string;
  files: GitChangeFile[];
  staged_count: number;
  unstaged_count: number;
  snapshot: string;
};

export type GitDiffRequest =
  | { scope: "staged" | "unstaged"; path?: string }
  | { scope: "commit"; start_commit: string; end_commit: string; commit_count: number; path?: string };

export type GitCommitResult = { hash: string; status: GitStatus };

export type GitDiffLaunchPayload = {
  repositoryKind: "project" | "workspace";
  repositoryId: string;
  repositoryName: string;
  startCommit: string;
  endCommit: string;
  commitCount: number;
};

export type DeliveryPreflight = {
  id: string;
  source_head: string;
  target_head: string;
  target_branch: string;
  source_dirty: boolean;
  target_dirty: boolean;
  ahead: number;
  behind: number;
  changed_files: string[];
  commits: GitCommit[];
  diff_stat: string;
  blockers: string[];
  warnings: string[];
};

export type ParentOperationDirection = "update" | "integrate";
export type ParentOperationStrategy = "rebase" | "merge";

export type ParentOperation = {
  id: string;
  workspace_repository_id: string;
  workspace_id: string;
  direction: ParentOperationDirection;
  strategy: ParentOperationStrategy;
  origin: "standalone" | "finish" | "legacy";
  source_repository_id: string;
  source_path: string;
  source_branch: string;
  target_scope: "workspace" | "fork" | "parent_workspace" | "project" | "legacy";
  target_workspace_id?: string;
  target_path: string;
  target_branch: string;
  source_head: string;
  parent_head: string;
  before_head: string;
  result_head?: string;
  recovery_ref: string;
  status:
    | "active"
    | "conflicted"
    | "resolving"
    | "completed"
    | "aborted"
    | "undone"
    | "failed"
    | "recovery_required";
  phase: string;
  resolver_session_id?: string;
  delivery_operation_id?: string;
  undo_available: boolean;
  error: string;
  started_at: string;
  updated_at: string;
  completed_at?: string;
};

export type ParentOperationPreview = {
  direction: ParentOperationDirection;
  repository_name: string;
  source_path: string;
  source_branch: string;
  target_scope: ParentOperation["target_scope"];
  target_path: string;
  target_branch: string;
  source_head: string;
  parent_head: string;
  outcome: "up_to_date" | "fast_forward" | "merge_commit";
  blockers: string[];
  operation?: ParentOperation;
};

export type FinishProgress = {
  status: "finished" | "paused" | "awaiting_resume";
  repository: WorkspaceRepository;
  operation?: ParentOperation;
};
export type ProjectDirectoryInspection = {
  path: string;
  name: string;
  directory_type: "git_scope" | "external";
  git_status: "ready" | "not_git";
  source_root?: string;
  git_common_dir?: string;
  relative_path?: string;
  repository_id?: string;
  repository_url?: string;
  preferred_remote_name?: string;
  base_branch?: string;
};

export type LocationDraft = {
  key: string;
  source: "local" | "url";
  path: string;
  description: string;
  worktree_setup_command: string;
  inspection?: ProjectDirectoryInspection;
  inspectionError?: string;
};

export type GitBranches = {
  current: string;
  local: string[];
  remotes: { name: string; branches: string[] }[];
};

export type WorkspaceDetail = Workspace & {
  project: Project;
  directories: Directory[];
  repositories: WorkspaceRepository[];
  workspace_directories: WorkspaceDirectory[];
  sessions: Session[];
  todos: Todo[];
  forks: Workspace[];
};

export type SystemStatus = {
  platform: string;
  treefold_home: string;
  codex_available: boolean;
  codex_version?: string;
};

export type ThemePreference = "system" | "light" | "dark";

export type AppSettings = {
  schema_version: number;
  language: LanguagePreference;
  theme: ThemePreference;
  agents: {
    codex: {
      extra_args: string[];
    };
  };
  amux: {
    keep_daemon_running_on_exit: boolean;
  };
};

export type AmuxStatus = {
  name: string;
  running: boolean;
  started_at?: string;
  active_groups: number;
  active_processes: number;
};

export type AgentIntegrationState =
  | "ready"
  | "not_installed"
  | "outdated"
  | "partial"
  | "conflict"
  | "unavailable";

export type AgentIntegrationComponent = {
  id: "treefold_cli" | "amux_cli" | "treefold_skill" | "amux_skill";
  version: string;
  source_path: string;
  install_path?: string;
  state: AgentIntegrationState;
  detail?: string;
};

export type AgentIntegrationStatus = {
  state: AgentIntegrationState;
  app_version: string;
  bundle_version: string;
  protocol_version: string;
  bundle_path: string;
  components: AgentIntegrationComponent[];
};

export type BackgroundProcess = {
  id: string;
  workspace_id: string;
  group_id: string;
  parent_process_id?: string;
  session_id?: string;
  session_root: boolean;
  name: string;
  command: string[];
  cwd: string;
  state:
    | "created"
    | "starting"
    | "running"
    | "stopping"
    | "exited"
    | "failed"
    | "unknown";
  pid: number;
  execution: number;
  created_at: string;
  started_at?: string;
  finished_at?: string;
};
