import type { Locale } from './config';

type ModelItem = readonly [number: string, name: string, summary: string, detail: string];
type DetailItem = readonly [name: string, detail: string];
type StepItem = readonly [number: string, title: string, detail: string];
type DeliveryMode = readonly [name: string, detail: string, badge: string];

interface HomeCopy {
  title: string;
  description: string;
  eyebrow: string;
  heroTitle: readonly [string, string];
  heroBody: string;
  download: string;
  source: string;
  privateNote: string;
  proof: readonly string[];
  workflowIllustrationLabel: string;
  todoExample: string;
  forkReady: string;
  runningChecks: string;
  waitingInstruction: string;
  modelKicker: string;
  modelTitle: string;
  modelBody: string;
  model: readonly ModelItem[];
  sessionNote: string;
  gitKicker: string;
  gitTitle: string;
  gitBody: string;
  gitFeatures: readonly DetailItem[];
  gitIllustrationLabel: string;
  gitExample: {
    yesterday: string;
    monday: string;
    files: string;
    commitActions: string;
    selected: string;
  };
  squashKicker: string;
  squashTitle: string;
  historySquashTitle: string;
  historySquashBody: string;
  deliverySquashTitle: string;
  deliverySquashBody: string;
  squashFootnote: string;
  workflowKicker: string;
  workflowTitle: string;
  workflowBody: string;
  steps: readonly StepItem[];
  deliveryTitle: string;
  deliveryModes: readonly DeliveryMode[];
  agentsKicker: string;
  agentsTitle: string;
  agentsBody: string;
  agentPoints: readonly string[];
  processNote: string;
  terminalIllustrationLabel: string;
  agentSessionEnded: string;
  sharedLogs: string;
  scenariosKicker: string;
  scenariosTitle: string;
  scenarios: readonly DetailItem[];
  ctaKicker: string;
  ctaTitle: string;
  ctaBody: string;
  ctaDownload: string;
  ctaSource: string;
}

export const homeCopy = {
  'zh-cn': {
    title: 'Treefold — 并行展开，干净收敛',
    description: 'Treefold 是免费开源的 macOS App，在受管理的 Git worktree 中并行运行 Agent，并通过可视化 Git 历史与 Squash Delivery 干净交付。',
    eyebrow: 'FREE · OPEN SOURCE · MACOS',
    heroTitle: ['让 Agent 并行工作。', '把 Git 干净收敛。'],
    heroBody: 'Treefold 把 Git worktree 变成可持续的 Agent 开发工作流。每项改动在独立环境中推进，再有序完成检查、Squash、交付和归档，需要时可以 reopen 或显式清理。',
    download: '下载 macOS 版',
    source: '查看源码',
    privateNote: '当前为私有预发布，访问 GitHub 和下载资源需要仓库权限。',
    proof: ['受管理的 Git worktree', '持续运行的 Agent 进程', '可视化交付与恢复'],
    workflowIllustrationLabel: 'Treefold 工作流示意',
    todoExample: '处理认证流程边界情况',
    forkReady: 'Fork validation 已就绪',
    runningChecks: '正在独立 worktree 中运行检查',
    waitingInstruction: '等待下一条指令',
    modelKicker: 'THE OPERATING MODEL',
    modelTitle: '每一项工作，都有清楚的归属。',
    modelBody: '代码、上下文、Session 和交付目标沿着同一层级组织。并行工作彼此隔离，同时始终保持可见。',
    model: [
      ['01', 'Project', '仓库上下文', '组织一个或多个 Git 仓库、工作目录，以及只读的 Context Directory。'],
      ['02', 'Workspace', '开发上下文', '为一项 feature 创建独立 branch 与 worktree，承载 Session、Todo 和固定交付目标。'],
      ['03', 'Fork', '并行子任务', '把 Todo 拆进独立的子 worktree，完成后将结果收回父 Workspace。'],
    ],
    sessionNote: 'Session 是执行现场。工作本身持续归属于对应的 Project、Workspace 或 Fork。',
    gitKicker: 'GIT VISIBILITY',
    gitTitle: '看清修改，也看懂历史。',
    gitBody: '不用离开当前工作上下文，就能查看仓库状态。Changes、commit、diff 和高影响的历史操作都处于同一个可见流程。',
    gitFeatures: [
      ['Git Changes', '查看文件修改、增删行数、暂存状态与 diff，再决定 stage、unstage 或 commit。'],
      ['Git History', '浏览 commit、作者、时间与 hash；选择单个 commit 或一段历史查看对应 diff。'],
      ['History actions', '从历史记录使用 View Diff、Copy Commit、Squash Commits…、Revert Commit 和 Reset to Commit。'],
    ],
    gitIllustrationLabel: 'Git History 功能示意',
    gitExample: {
      yesterday: '昨天',
      monday: '周一',
      files: '个文件',
      commitActions: '提交操作',
      selected: '2 个 COMMIT 已选中',
    },
    squashKicker: 'TWO WAYS TO SQUASH',
    squashTitle: '在正确的边界，整理 Git 历史。',
    historySquashTitle: 'Squash 选中的历史',
    historySquashBody: '选择一段连续且未发布的 commit，将它们合并为一个。Treefold 会预览改写范围、阻止不安全的操作，并在结果仍可恢复时提供 Undo。',
    deliverySquashTitle: 'Squash merge 到目标',
    deliverySquashBody: '把 Workspace 交付到本地目标，或把 Fork 交付到父 Workspace，并在目标上生成一个 commit。源 branch 及原始 commit 保持不变。',
    squashFootnote: '两种操作都不会自动 push 或 force-push；Delivery 开始前会同时检查 source 与 target。',
    workflowKicker: 'FROM OPEN TO FINISHED',
    workflowTitle: '并行展开，也有清楚的归途。',
    workflowBody: 'Treefold 让完整生命周期保持可见：创建、工作、检查、交付、归档，后续可以 reopen，或在显式删除时清理。',
    steps: [
      ['01', '创建', '用独立 branch 与 worktree 创建 Workspace。'],
      ['02', '并行', '将 Todo 分配给 Fork，让 Agent 独立推进。'],
      ['03', '检查', '查看修改、历史、进程和交付准备情况。'],
      ['04', 'Finish', '选择交付策略并归档，同时保留 worktree 与 branch。'],
    ],
    deliveryTitle: '按仓库选择 Delivery Mode',
    deliveryModes: [
      ['Squash merge 到目标', '在目标上生成一个 commit，同时保留 source 的完整历史。', '推荐'],
      ['Merge 到目标', '把 branch 的完整历史合并到配置好的本地目标。', ''],
      ['Push feature branch', '推送 Workspace branch，接入团队已有的评审与 CI 流程。', ''],
      ['保留，不交付', '不集成代码而直接归档，并保留 checkout 以便稍后 reopen。', ''],
    ],
    agentsKicker: 'AMUX / MANAGED PROCESSES',
    agentsTitle: '进程托管，跨 Session 接续。',
    agentsBody: 'amux 托管开发服务与长时间运行的进程。你和 Agent 可以同时查看同一份日志；切换或结束 Session 后，仍能继续查看输出、接手排查。',
    agentPoints: ['进程独立于 Agent Session 持续运行', '你与 Agent 同时查看实时日志', '跨 Session 查看日志、交互、重启或停止进程'],
    processNote: '退出 App 后是否保持进程运行，由 amux 设置决定。',
    terminalIllustrationLabel: 'amux 托管进程，人和 Agent 同时查看日志并跨 Session 接续',
    agentSessionEnded: 'Agent Session 已结束 · 进程继续运行',
    sharedLogs: '你与 Agent · 同时查看日志',
    scenariosKicker: 'FITS THE REPOSITORY YOU HAVE',
    scenariosTitle: '不同代码结构，同一套工作流。',
    scenarios: [
      ['单仓库', '让不同 feature 独立推进，避免 Agent 争用同一个工作目录。'],
      ['多仓库', '在多个仓库之间管理对应的 worktree 与交付状态。'],
      ['Monorepo 与多目录', '从正确目录启动 Session，同时保持仓库级 Git 归属。'],
      ['Context Directory', '把规范、笔记或非 Git 目录作为 Agent 的只读上下文。'],
    ],
    ctaKicker: 'FREE AND OPEN SOURCE',
    ctaTitle: '让并行的工作，干净地完成。',
    ctaBody: 'Treefold 面向 Apple Silicon Mac。使用本地优先的编排数据和标准 Git 能力，核心工作流不依赖托管控制面。',
    ctaDownload: '下载 Treefold',
    ctaSource: '查看源代码',
  },
  en: {
    title: 'Treefold — Run agents in parallel. Fold the work back cleanly.',
    description: 'Treefold is a free and open source macOS app for parallel agent development in managed Git worktrees, with visual Git history and clean squash delivery.',
    eyebrow: 'FREE · OPEN SOURCE · MACOS',
    heroTitle: ['Run agents in parallel.', 'Fold the work back cleanly.'],
    heroBody: 'Treefold turns Git worktrees into a durable workflow for agents. Give every change an isolated place to run, then review, squash, deliver, and archive it with intent.',
    download: 'Download for macOS',
    source: 'View source',
    privateNote: 'Private preview. GitHub and download resources currently require repository access.',
    proof: ['Managed Git worktrees', 'Persistent agent processes', 'Visual delivery and recovery'],
    workflowIllustrationLabel: 'Treefold workflow illustration',
    todoExample: 'Validate auth edge cases',
    forkReady: 'Fork validation ready',
    runningChecks: 'Running checks in isolated worktree',
    waitingInstruction: 'Waiting for next instruction',
    modelKicker: 'THE OPERATING MODEL',
    modelTitle: 'A place for every unit of work.',
    modelBody: 'Code, context, sessions, and delivery follow one explicit hierarchy. Parallel work stays isolated without becoming invisible.',
    model: [
      ['01', 'Project', 'Repository context', 'Group one or more repositories, working directories, and read-only Context Directories.'],
      ['02', 'Workspace', 'Development context', 'Give one feature its own branch, worktree, Sessions, Todos, and fixed delivery target.'],
      ['03', 'Fork', 'Parallel subwork', 'Split a Todo into an isolated child worktree, then fold the result back into its parent Workspace.'],
    ],
    sessionNote: 'Sessions are execution contexts. The work stays durable in its Project, Workspace, or Fork.',
    gitKicker: 'GIT VISIBILITY',
    gitTitle: 'See the change. Understand the history.',
    gitBody: 'Review repository state without leaving the work that owns it. Treefold keeps changes, commits, diffs, and high-impact history actions in one visible flow.',
    gitFeatures: [
      ['Git Changes', 'Inspect files, line counts, staged state, and diffs before you stage, unstage, or commit.'],
      ['Git History', 'Browse commits, authors, timestamps, and hashes. Select one commit or a range to inspect its diff.'],
      ['History actions', 'Use View Diff, Copy Commit, Squash Commits…, Revert Commit, and Reset to Commit from history.'],
    ],
    gitIllustrationLabel: 'Git History illustration',
    gitExample: {
      yesterday: 'Yesterday',
      monday: 'Monday',
      files: 'files',
      commitActions: 'COMMIT ACTIONS',
      selected: '2 COMMITS SELECTED',
    },
    squashKicker: 'TWO WAYS TO SQUASH',
    squashTitle: 'Clean history at the right boundary.',
    historySquashTitle: 'Squash selected history',
    historySquashBody: 'Select consecutive, unpublished commits and combine them into one. Treefold previews the rewrite, blocks unsafe ranges, and offers Undo while the result remains recoverable.',
    deliverySquashTitle: 'Squash merge into target',
    deliverySquashBody: 'Finish a Workspace into its local target, or a Fork into its parent, as one commit. The source branch and its original commits remain unchanged.',
    squashFootnote: 'Neither operation pushes or force-pushes. Delivery checks both source and target before it starts.',
    workflowKicker: 'FROM OPEN TO FINISHED',
    workflowTitle: 'Parallel work has a clear way home.',
    workflowBody: 'Treefold makes the complete lifecycle visible: create, work, inspect, deliver, archive, and later reopen or delete with cleanup.',
    steps: [
      ['01', 'Create', 'Create a Workspace with an isolated branch and worktree.'],
      ['02', 'Parallelize', 'Assign Todos to Forks and let agents work independently.'],
      ['03', 'Review', 'Inspect changes, history, processes, and delivery readiness.'],
      ['04', 'Finish', 'Choose a delivery strategy, archive the work, and retain its checkout.'],
    ],
    deliveryTitle: 'Choose delivery per repository',
    deliveryModes: [
      ['Squash merge into target', 'Create one target commit and keep the source history unchanged.', 'RECOMMENDED'],
      ['Merge into target', 'Integrate the branch into its configured local target with the full history.', ''],
      ['Push feature branch', 'Push a Workspace branch for the team’s existing review and CI flow.', ''],
      ['Preserve without delivery', 'Archive without integrating code; keep the checkout available to reopen.', ''],
    ],
    agentsKicker: 'AMUX / MANAGED PROCESSES',
    agentsTitle: 'Managed processes. Shared across sessions.',
    agentsBody: 'amux manages development services and long-running processes. You and your agent can read the same logs at the same time, then keep inspecting output and debugging across sessions.',
    agentPoints: ['Processes keep running independently of Agent Sessions', 'Humans and agents share live logs simultaneously', 'Read logs, interact, restart, or stop across sessions'],
    processNote: 'Whether processes survive App exit follows the amux preference.',
    terminalIllustrationLabel: 'An amux process with shared human and agent logs across sessions',
    agentSessionEnded: 'Agent Session ended · process remains active',
    sharedLogs: 'HUMAN + AGENT · SHARED LIVE LOGS',
    scenariosKicker: 'FITS THE REPOSITORY YOU HAVE',
    scenariosTitle: 'One workflow across different codebases.',
    scenarios: [
      ['Single repository', 'Run independent features without agents competing for one working directory.'],
      ['Multiple repositories', 'Coordinate matching worktrees and delivery state across repositories.'],
      ['Monorepo and multiple directories', 'Start Sessions in the right directory while keeping repository-level Git ownership.'],
      ['Context Directory', 'Attach specifications, notes, or non-Git directories as read-only agent context.'],
    ],
    ctaKicker: 'FREE AND OPEN SOURCE',
    ctaTitle: 'Give parallel work a clean finish.',
    ctaBody: 'Treefold for Apple Silicon Macs. Local-first orchestration, standard Git primitives, no hosted control plane required for the core workflow.',
    ctaDownload: 'Download Treefold',
    ctaSource: 'Explore the source',
  },
} satisfies Record<Locale, HomeCopy>;
