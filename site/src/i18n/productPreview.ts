import type { Locale } from './config';

interface PreviewCopy {
  label: string;
  views: string;
  captions: readonly [string, string, string];
  scrollHint: string;
  repositories: string;
  directories: string;
  worktrees: string;
  ready: string;
  mainCheckout: string;
  ahead: string;
  active: string;
  pending: string;
  done: string;
  forkDescription: string;
  tasks: readonly [string, string, string];
}

export const productPreviewCopy = {
  'zh-cn': {
    label: 'Treefold 交互示意',
    views: '切换展示场景',
    captions: ['一个 Project，多个仓库；每项改动都有独立的 worktree。', '用 Todo 跟进任务，在独立的 Fork 中推进子任务。', '在各自的开发环境中运行 Shell、Codex 和 Claude Code。'],
    scrollHint: '左右滑动查看完整 App 布局',
    repositories: '仓库', directories: '目录', worktrees: '工作树',
    ready: '就绪', mainCheckout: '主检出目录', ahead: '领先 2 · 落后 0',
    active: '进行中', pending: '待处理', done: '已完成',
    forkDescription: '将子任务放进独立的分支与工作树。',
    tasks: ['处理认证流程边界情况', '补充 API 集成测试', '检查登录错误提示'],
  },
  en: {
    label: 'Interactive Treefold illustration',
    views: 'Choose a preview scene',
    captions: ['One Project, multiple repositories. An isolated worktree for every change.', 'Track work with Todos and move subtasks forward in isolated Forks.', 'Run Shell, Codex, and Claude Code in their own development environments.'],
    scrollHint: 'Scroll sideways to explore the full app layout',
    repositories: 'Repositories', directories: 'Directories', worktrees: 'Worktrees',
    ready: 'Ready', mainCheckout: 'Main checkout', ahead: 'Ahead 2 · Behind 0',
    active: 'Active', pending: 'Pending', done: 'Completed',
    forkDescription: 'Give each subtask its own branch and worktree.',
    tasks: ['Validate auth edge cases', 'Add API integration tests', 'Review sign-in errors'],
  },
} satisfies Record<Locale, PreviewCopy>;
