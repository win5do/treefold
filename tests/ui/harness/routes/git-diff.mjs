export function createGitDiffRoutes({ fixture, readJson, sendJson }) {
  const requests = [];

  return {
    requests,
    async handle(request, response, pathname) {
      const match = pathname.match(
        /^\/api\/(project|workspace)-repositories\/([^/]+)\/compare$/,
      );
      if (request.method !== "POST" || !match) return false;

      const input = await readJson(request);
      const repositoryId = match[2];
      const comparison = fixture.gitComparisons[repositoryId];
      requests.push({ repositoryId, ...input });
      if (!comparison) {
        sendJson(response, 404, {
          error: {
            code: "NOT_FOUND",
            message: "Comparison fixture not found",
          },
        });
        return true;
      }
      sendJson(response, 200, {
        ...comparison,
        resolved_head: input.end_commit,
        commit_count: input.commit_count,
      });
      return true;
    },
  };
}
