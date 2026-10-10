import type { Locale } from './config';
interface PreviewCopy {
  label: string; views: string; scenes: readonly [string, string, string];
  captions: readonly [string, string, string];
  task: string; create: string; isolation: string; running: string;
  validation: string; tests: string; review: string; passed: string;
  merge: string; retained: string; illustration: string; shared: string;
}
export const productPreviewCopy = {
  'zh-cn': {
    label: 'Treefold 工作流交互示意', views: '选择工作流阶段',
    scenes: ['展开任务', '并行推进', '检查并收敛'],
    captions: ['从 Todo 展开 Fork，为子任务创建独立的分支与 worktree。', '两个 Fork 各自运行 Agent，代码改动互相隔离。', '检查改动与测试结果，将 Fork 成果合回父 Workspace。'],
    task: '完善登录功能', create: '从 Todo 创建 Fork', isolation: '独立分支 · 独立 worktree',
    running: '进行中', validation: '处理认证边界情况', tests: '补充 API 集成测试',
    review: '检查改动', passed: '测试通过 · 等待检查', merge: '合回父 Workspace',
    retained: '完成后归档，保留 worktree 与工作记录', illustration: '工作流示意 · 示例数据',
    shared: '同一 Fork 中的 Session 共享 checkout',
  },
  en: {
    label: 'Interactive Treefold workflow illustration', views: 'Choose a workflow stage',
    scenes: ['Split the work', 'Run in parallel', 'Review & deliver'],
    captions: ['Turn a Todo into a Fork with its own branch and worktree.', 'Run an agent in each Fork, with code changes isolated from one another.', 'Review changes and test results, then merge the Fork into its parent Workspace.'],
    task: 'Complete the sign-in feature', create: 'Create a Fork from a Todo', isolation: 'Own branch · Own worktree',
    running: 'Running', validation: 'Validate auth edge cases', tests: 'Add API integration tests',
    review: 'Review changes', passed: 'Tests passed · Awaiting review', merge: 'Merge into parent Workspace',
    retained: 'Archive when finished; keep the worktree and work records', illustration: 'Workflow illustration · Sample data',
    shared: 'Sessions in the same Fork share a checkout',
  },
} satisfies Record<Locale, PreviewCopy>;
