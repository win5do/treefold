import type { GitStatus, GitWorktree } from '../../../src/renderer/src/domain/types.ts';
import type { FixtureSession, FixtureWorkspaceDetail, SidebarFixture } from '../fixtures/types.ts';
import { FIXTURE_IDS as ids } from '../fixtures/sidebar-core.ts';

export type Locale = 'en-US' | 'zh-CN';
export const showcaseIds = { ...ids, apiFork: 'showcase-api-fork', export: 'showcase-order-export', dev: 'showcase-web-dev', checks: 'showcase-typecheck' };
const timestamp = '2026-10-14T09:30:00.000Z';
const source = '/Users/demo/Projects/atlas';
const root = '/Users/demo/.treefold/git/atlas';

export const commits = [
  ['a7c9e12', 'Add keyboard navigation to search results'],
  ['b3f810a', 'Keep search filters in the URL'],
  ['c6d204b', 'Build the product search interface'],
  ['d91a3e8', 'Add paginated product search endpoint'],
  ['e2b705f', 'Define search query and response types'],
  ['f84c192', 'Create the product catalog'],
].map(([hash, subject], index) => ({ hash: hash.padEnd(40, '0'), short_hash: hash, subject, author: 'Alex Chen', authored_at: `2026-10-14T${String(9 - index).padStart(2, '0')}:20:00Z` }));

export const gitStatus: GitStatus = {
  branch: 'feature/product-search', head: commits[0].hash, snapshot: 'showcase-search-v1', staged_count: 1, unstaged_count: 2,
  files: [
    { path: 'src/search.ts', status: 'modified', staged: false, has_staged_changes: false, has_unstaged_changes: true, additions: 9, deletions: 2, binary: false },
    { path: 'src/search.test.ts', status: 'untracked', staged: false, has_staged_changes: false, has_unstaged_changes: true, additions: 18, deletions: 0, binary: false },
    { path: 'README.md', status: 'modified', staged: true, has_staged_changes: true, has_unstaged_changes: false, additions: 3, deletions: 0, binary: false },
  ],
};
export const searchPatch = `diff --git a/src/search.ts b/src/search.ts
index 1111111..2222222 100644
--- a/src/search.ts
+++ b/src/search.ts
@@ -1,9 +1,16 @@
 import type { Product } from './types';
 
-export function search(products: Product[], query: string) {
-  return products.filter(p => p.name.includes(query));
+export function search(products: Product[], query: string): Product[] {
+  const terms = query.trim().toLocaleLowerCase().split(/\\s+/);
+  if (!terms[0]) return products;
+
+  return products.filter(product => {
+    const text = [product.name, product.category]
+      .join(' ').toLocaleLowerCase();
+    return terms.every(term => text.includes(term));
+  });
 }
 
 export function resultCount(products: Product[]) {
   return products.length;
 }
`;

function session(owner: FixtureWorkspaceDetail, id: string, name: string, kind: FixtureSession['kind'], argv: string[]): FixtureSession {
  return { id, workspace_id: owner.id, name, name_is_custom: true, kind, cwd: owner.checkout_path!, original_cwd: owner.checkout_path!, initial_prompt: '', visibility: 'visible', amux_workspace_name: owner.runtime_name!, amux_process_name: id, status: 'running', argv, io_mode: 'tty', launch_started_at: timestamp, created_at: timestamp, updated_at: timestamp };
}

// Showcase content is separate from regression-test stress cases. Only the
// shared response shapes and inert API implementation come from the UI harness.
export function configureShowcase(fixture: SidebarFixture, locale: Locale) {
  fixture.settings.language = locale;
  fixture.settings.theme = 'dark';
  for (const kind of ['codex', 'claude_code', 'opencode', 'pi'] as const) fixture.settings.agents[kind].command = '';
  for (const agent of fixture.system.agents) Object.assign(agent, { available: true, executable: `/usr/local/bin/${agent.kind === 'claude_code' ? 'claude' : agent.kind}`, version: undefined });
  fixture.system.treefold_home = '/Users/demo/.treefold';
  fixture.system.platform = 'darwin';
  const project = { ...fixture.projects[0], name: 'Atlas', description: 'A thoughtful storefront, built together.', created_at: timestamp, updated_at: timestamp, git_common_dir: `${source}/.git` };
  const previous = fixture.projectDetails[project.id];
  const directory = { ...previous.directories[0], name: 'atlas', description: 'Product storefront', path: source, git_common_dir: `${source}/.git`, repository_url: 'https://example.com/atlas.git', remote_url: 'https://example.com/atlas.git', head_commit: commits.at(-1)!.hash, head_summary: commits.at(-1)!.subject };
  const repository = { ...previous.repositories[0], name: 'atlas', source_root: source, git_common_dir: `${source}/.git`, repository_url: 'https://example.com/atlas.git' };
  const template = fixture.workspaceDetails[ids.workspace];
  function workspace(id: string, name: string, slug: string, description: string, parent?: string): FixtureWorkspaceDetail {
    const checkout = `${root}/${slug}`;
    const repoId = id === ids.workspace ? ids.workspacePrimaryLocation : id === ids.fork ? ids.forkPrimaryLocation : `${id}-repository`;
    const branch = `${parent ? 'fork' : 'feature'}/${slug}`;
    return {
      ...template, id, name, description, kind: parent ? 'fork' : 'workspace', parent_workspace_id: parent, project, checkout_path: checkout, branch,
      target_branch: parent ? 'feature/product-search' : 'main', remote_name: undefined, remote_branch: undefined,
      delivery_status: 'active', runtime_id: id, runtime_name: `treefold-${id}`, created_at: timestamp, updated_at: timestamp,
      directories: [{ ...directory, checkout_path: checkout }],
      repositories: [{ ...template.repositories[0], id: repoId, workspace_id: id, repository_name: 'atlas', source_root: source, checkout_path: checkout, branch, base_branch: parent ? 'feature/product-search' : 'main', remote_name: undefined, remote_branch: undefined }],
      workspace_directories: [{ ...template.workspace_directories[0], id: `${id}-directory`, workspace_id: id, workspace_repository_id: repoId, name: 'atlas', description: 'Product storefront', path: checkout }],
      sessions: [], todos: [], forks: [],
    };
  }
  const feature = workspace(ids.workspace, 'Product search', 'product-search', 'Help customers find the right product. Split API and interface work into Forks, then review and deliver together.');
  const ui = workspace(ids.fork, 'Search interface', 'search-interface', 'Build fast, keyboard-friendly search with shareable filters.', feature.id);
  const api = workspace(showcaseIds.apiFork, 'Search API', 'search-api', 'Add paginated search with category filters.', feature.id);
  const exports = workspace(showcaseIds.export, 'Order export', 'order-export', 'Export orders as CSV for the operations team.');
  feature.forks = [ui, api];
  feature.sessions = [session(feature, '019a00e712347abcd123456789abc0001', 'Codex', 'codex', ['codex']), session(feature, '019a00e712347abcd123456789abc0002', 'Tests', 'command', ['npm', 'test'])];
  feature.todos = [
    { id: 'showcase-todo-model', workspace_id: feature.id, content: 'Define search query and response types', status: 'done' },
    { id: 'showcase-todo-ui', workspace_id: feature.id, content: 'Build the search interface', status: 'in_progress', fork_id: ui.id },
    { id: 'showcase-todo-api', workspace_id: feature.id, content: 'Implement paginated search API', status: 'in_progress', fork_id: api.id },
    { id: 'showcase-todo-review', workspace_id: feature.id, content: 'Review and ship the complete search flow', status: 'pending' },
  ];
  ui.sessions = [
    session(ui, '019a00e712347abcd123456789abc0003', 'Codex', 'codex', ['codex']),
    session(ui, '019a00e712347abcd123456789abc0004', 'Claude Code', 'claude_code', ['claude']),
    session(ui, '019a00e712347abcd123456789abc0005', 'Pi', 'pi', ['pi']),
    session(ui, showcaseIds.dev, 'web-dev', 'command', ['npm', 'run', 'dev']),
    session(ui, showcaseIds.checks, 'typecheck', 'command', ['npm', 'run', 'typecheck', '--', '--watch']),
  ];
  api.sessions = [session(api, 'showcase-api-claude', 'Claude Code', 'claude_code', ['claude'])];
  exports.sessions = [session(exports, 'showcase-export-pi', 'Pi', 'pi', ['pi'])];
  const workspaces = [feature, ui, api, exports];
  const clean: NonNullable<GitWorktree['status']> = { prunable_reason: null, locked_reason: null, detached: false, available: true, dirty: false, conflicted: false, comparison: 'same', target_branch: 'main', ahead: 0, behind: 0, has_ignored_files: false, operation_in_progress: false, cleanup_candidate: false };
  const worktrees: GitWorktree[] = [
    { project_repository_id: repository.id, repository_name: 'atlas', path: source, branch: 'main', head_commit: commits.at(-1)!.hash, is_main: true, status: clean },
    ...workspaces.map((item, index) => ({ project_repository_id: repository.id, repository_name: 'atlas', path: item.checkout_path!, branch: item.branch, head_commit: commits[index].hash, is_main: false, workspace_id: item.id, workspace_name: item.name, status: { ...clean, dirty: index < 2, comparison: 'uncontained' as const, target_branch: item.target_branch, ahead: [5, 3, 2, 1][index] } })),
  ];
  fixture.projects = [project];
  fixture.projectDetails = { [project.id]: { ...project, directories: [directory], repositories: [repository], sessions: [], workspaces, worktrees } };
  fixture.workspaceDetails = Object.fromEntries(workspaces.map(item => [item.id, item]));
  fixture.gitHistories = {};
  fixture.gitComparisons = {};
  for (const [id, branch] of [[repository.id, 'main'], ...workspaces.map(item => [item.repositories[0].id, item.branch])]) {
    fixture.gitHistories[id] = { branch, commits };
    fixture.gitComparisons[id] = { repository: 'atlas', resolved_base: commits.at(-1)!.hash, patch: searchPatch };
  }
  fixture.processes = workspaces.flatMap(owner => owner.sessions.map((item, index) => ({ id: item.id, workspace_id: owner.runtime_id!, group_id: owner.runtime_id!, session_id: item.id, session_root: item.kind !== 'command', name: item.name, command: item.argv, cwd: item.cwd, state: 'running' as const, pid: 42000 + index, execution: 1, created_at: timestamp, started_at: timestamp })));
  fixture.amux.active_groups = workspaces.length;
  fixture.amux.active_processes = fixture.processes.length;
}
