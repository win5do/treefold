import type { GitBranches, WorkspaceRepository } from "@/domain/types";

export function defaultRepositoryRemote(branches: GitBranches, preferred?: string) {
  const names = branches.remotes.map((remote) => remote.name);
  return [branches.current_remote, preferred, "origin", names[0]]
    .find((name): name is string => Boolean(name && names.includes(name))) ?? "";
}

export function hasWorkspaceUpstream(repository: WorkspaceRepository) {
  return Boolean(repository.remote_name && repository.remote_branch);
}
