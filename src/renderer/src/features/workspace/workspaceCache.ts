import type { QueryClient } from "@tanstack/react-query";
import type { WorkspaceDetail } from "@/domain/types";
import { workspaceKeys } from "./queries";

export function removeWorkspaceQueries(client: QueryClient, id: string) {
  const workspace = client.getQueryData<WorkspaceDetail>(workspaceKeys.detail(id));
  const repositories = new Set(workspace?.repositories.map(repository => repository.id) ?? []);
  // removeQueries also cancels in-flight reads, preventing a late response from
  // resurrecting data after the record has been deleted.
  client.removeQueries({ predicate: ({ queryKey: key }) =>
    (["workspace", "workspace-sessions", "workspace-worktrees", "agent-review"].includes(String(key[0])) && key[1] === id)
    || (["git-history", "git-status", "git-diff"].includes(String(key[0])) && key[1] === "workspace" && repositories.has(String(key[2]))),
  });
}
