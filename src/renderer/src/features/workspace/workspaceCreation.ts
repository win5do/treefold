import type {
  CreateWorkspaceInput,
  GitBranches,
  GitBranchRef,
  ProjectRepository,
} from "@/domain/types";
import { defaultRepositoryRemote } from "@/features/git/upstream";

type CheckoutDraft = {
  source: GitBranchRef | null;
  branch: string;
  remote: string;
  remoteBranch: string;
  customRemoteBranch: boolean;
};
export type RepositoryDraft = {
  mode: "new" | "existing";
  new: CheckoutDraft;
  existing: CheckoutDraft;
};

export function initialRepositoryDraft(
  repository: ProjectRepository,
  options: GitBranches,
  generated: string,
): RepositoryDraft {
  const remote = defaultRepositoryRemote(
    options,
    repository.preferred_remote_name,
  );
  return {
    mode: "new",
    new: {
      source:
        options.current && options.local.includes(options.current)
          ? { kind: "local", branch: options.current }
          : null,
      branch: generated,
      remote,
      remoteBranch: remote ? generated : "",
      customRemoteBranch: false,
    },
    existing: {
      source: null,
      branch: "",
      remote: "",
      remoteBranch: "",
      customRemoteBranch: false,
    },
  };
}

export function selectExistingBranch(
  ref: GitBranchRef,
  options: GitBranches,
  repository: ProjectRepository,
): CheckoutDraft {
  const upstream =
    ref.kind === "remote"
      ? { remote: ref.remote, branch: ref.branch }
      : options.upstreams?.[ref.branch];
  const remote =
    upstream?.remote ??
    defaultRepositoryRemote(options, repository.preferred_remote_name);
  return {
    source: ref,
    branch: ref.branch,
    remote,
    remoteBranch: remote ? (upstream?.branch ?? ref.branch) : "",
    customRemoteBranch: Boolean(upstream),
  };
}

export function checkoutIssue(
  draft: RepositoryDraft,
  options: GitBranches,
):
  | "chooseBranch"
  | "branchMissing"
  | "branchOccupied"
  | "branchExists"
  | "branchRequired"
  | "upstreamInvalid"
  | null {
  const active = draft[draft.mode];
  const ref = active.source;
  if (!ref) return "chooseBranch";
  if (
    !(ref.kind === "local"
      ? options.local.includes(ref.branch)
      : options.remotes
          .find((remote) => remote.name === ref.remote)
          ?.branches.includes(ref.branch))
  )
    return "branchMissing";
  if (!active.branch.trim()) return "branchRequired";
  const reuse = draft.mode === "existing" && ref.kind === "local";
  if (reuse && options.occupied?.[ref.branch]) return "branchOccupied";
  if (!reuse && options.local.includes(active.branch.trim()))
    return "branchExists";
  if (
    active.remote &&
    (!active.remoteBranch.trim() ||
      !options.remotes.some((remote) => remote.name === active.remote))
  )
    return "upstreamInvalid";
  return null;
}

export function repositoryPayload(
  id: string,
  draft: RepositoryDraft,
): CreateWorkspaceInput["repositories"][number] {
  const active = draft[draft.mode];
  if (!active.source) throw new Error("Select a branch before submitting");
  return {
    repository_id: id,
    checkout:
      draft.mode === "new"
        ? { mode: "new", branch: active.branch.trim(), base: active.source }
        : {
            mode: "existing",
            source: active.source,
            ...(active.source.kind === "remote"
              ? { local_branch: active.branch.trim() }
              : {}),
          },
    upstream: active.remote
      ? { remote: active.remote, branch: active.remoteBranch.trim() }
      : null,
  };
}

export function changeCheckoutMode(
  draft: RepositoryDraft,
  mode: RepositoryDraft["mode"],
  options: GitBranches,
  repository: ProjectRepository,
): RepositoryDraft {
  if (mode === draft.mode) return draft;
  const source = draft[draft.mode].source;
  if (!source) return { ...draft, mode };
  if (mode === "new") return { ...draft, mode, new: { ...draft.new, source } };
  const previous = draft.existing.source;
  const same = previous?.kind === source.kind && previous.branch === source.branch &&
    (source.kind !== "remote" || (previous.kind === "remote" && previous.remote === source.remote));
  return { ...draft, mode, existing: same ? draft.existing : selectExistingBranch(source, options, repository) };
}
