export function createGitDiffRoutes({ fixture, readJson, sendJson }) {
  const requests = [];
  const statuses = new Map();

  function statusFor(repositoryId) {
    if (!statuses.has(repositoryId)) statuses.set(repositoryId, {
      branch: repositoryId.includes("secondary") ? "develop" : "main",
      head: "1111111111111111111111111111111111111111",
      snapshot: "fixture-snapshot-1",
      files: [
        { path: "src/alpha.ts", status: "modified", staged: false, has_staged_changes: false, has_unstaged_changes: true, additions: 1, deletions: 1, binary: false },
        { path: "README.md", status: "modified", staged: true, has_staged_changes: true, has_unstaged_changes: false, additions: 1, deletions: 0, binary: false },
      ],
      staged_count: 1,
      unstaged_count: 1,
    });
    return statuses.get(repositoryId);
  }

  function refreshCounts(status) {
    status.staged_count = status.files.filter((file) => file.has_staged_changes).length;
    status.unstaged_count = status.files.filter((file) => file.has_unstaged_changes).length;
    status.snapshot = `fixture-snapshot-${requests.length + 1}`;
  }

  return {
    requests,
    async handle(request, response, pathname) {
      const match = pathname.match(/^\/api\/(project|workspace)-repositories\/([^/]+)\/(compare|git-status|git-diff|git\/(stage|unstage|commit))$/);
      if (!match) return false;
      const repositoryId = match[2];
      const action = match[3];
      if (action === "git-status" && request.method === "GET") {
        sendJson(response, 200, statusFor(repositoryId)); return true;
      }
      if (request.method !== "POST") return false;
      const input = await readJson(request);
      requests.push({ repositoryId, action, ...input });
      if (action === "compare" || action === "git-diff") {
        const comparison = fixture.gitComparisons[repositoryId];
        if (!comparison) { sendJson(response, 404, { error: { code: "NOT_FOUND", message: "Comparison fixture not found" } }); return true; }
        sendJson(response, 200, { ...comparison, resolved_head: input.end_commit ?? input.scope?.toUpperCase() ?? "WORKTREE", commit_count: input.commit_count ?? 1 }); return true;
      }
      const status = statusFor(repositoryId);
      if (action === "git/stage" || action === "git/unstage") {
        const staged = action === "git/stage";
        for (const file of status.files) if (input.paths.includes(file.path)) { file.staged = staged; file.has_staged_changes = staged; file.has_unstaged_changes = !staged; }
        refreshCounts(status); sendJson(response, 200, status); return true;
      }
      if (action === "git/commit") {
        if (!input.message || input.expected_snapshot !== status.snapshot) { sendJson(response, 409, { error: { code: "GIT_STATE_STALE", message: "Git state changed" } }); return true; }
        status.files = status.files.filter((file) => !file.has_staged_changes);
        refreshCounts(status);
        sendJson(response, 200, { hash: "cccccccccccccccccccccccccccccccccccccccc", status }); return true;
      }
      return false;
    },
  };
}
