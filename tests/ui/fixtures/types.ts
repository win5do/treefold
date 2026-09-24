import type {
  AgentIntegrationStatus, AmuxStatus, AppSettings, BackgroundProcess, DeliveryPreflight,
  Directory, GitDiffComparison, GitHistory, GitWorktree, Project, ProjectRepository,
  Session, SystemStatus, Todo, Workspace, WorkspaceDirectory, WorkspaceRepository,
} from "../../../src/renderer/src/domain/types.ts";

// Fixtures retain legacy response fields and intentionally model partially created resources.
export type FixtureProject = Omit<Project, "primary_directory_id" | "git_common_dir"> &
  Partial<Pick<Project, "primary_directory_id" | "git_common_dir">> & { created_at: string };
export type FixtureDirectory = Directory & { created_at?: string; updated_at?: string };
export type FixtureRepository = Omit<ProjectRepository, "source_ownership"> & { source_ownership?: ProjectRepository["source_ownership"] };
export type FixtureSession = Session & { additional_directories?: string[] };
type NullableOptional<T> = { [K in keyof T]: undefined extends T[K] ? T[K] | null : T[K] };
export type FixtureWorkspace = NullableOptional<Omit<Workspace, "kind">> & { kind: Workspace["kind"] | "base"; worktree_id?: string | null; created_at: string };
export type FixtureProjectDetail = FixtureProject & {
  directories: FixtureDirectory[]; locations?: FixtureDirectory[]; repositories: FixtureRepository[];
  sessions: FixtureSession[]; workspaces: FixtureWorkspace[]; worktrees: GitWorktree[];
};
export type FixtureWorkspaceDetail = FixtureWorkspace & {
  project: FixtureProject; directories: FixtureDirectory[]; repositories: WorkspaceRepository[];
  workspace_directories: WorkspaceDirectory[]; sessions: FixtureSession[]; todos: Todo[]; forks: FixtureWorkspace[];
};
export type FixturePreflight = DeliveryPreflight & {
  workspace_id: string; workspace_repository_id: string; code_action: string; source_status: string; created_at: string;
};
export interface SidebarFixture {
  settings: AppSettings;
  amux: AmuxStatus;
  agentIntegration: AgentIntegrationStatus;
  processes: BackgroundProcess[];
  system: SystemStatus;
  projects: FixtureProject[];
  projectDetails: Record<string, FixtureProjectDetail>;
  workspaceDetails: Record<string, FixtureWorkspaceDetail>;
  gitHistories: Record<string, Omit<GitHistory, "commits"> & { commits: readonly GitHistory["commits"][number][] }>;
  gitComparisons: Record<string, Pick<GitDiffComparison, "repository" | "resolved_base" | "patch">>;
  deliveryPreflights: Record<string, FixturePreflight>;
}
