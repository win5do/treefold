import type { Locale } from './config';

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
  modelKicker: string;
  modelTitle: string;
  modelBody: string;
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
  squashTitle: string;
  deliveryNote: string;
  continuity: {
    kicker: string;
    title: string;
    body: string;
    items: readonly DetailItem[];
    cliLabel: string;
    cliNote: string;
  };
  historySquashTitle: string;
  historySquashBody: string;
  deliverySquashTitle: string;
  deliverySquashBody: string;
  squashFootnote: string;
  workflowTitle: string;
  workflowBody: string;
  steps: readonly StepItem[];
  deliveryTitle: string;
  deliveryModes: readonly DeliveryMode[];
  agentSupport: {
    kicker: string;
    title: string;
    body: string;
    available: string;
  };
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
  ctaStarNote: string;
}

export const homeCopy = {
  'zh-cn': {
    title: 'Treefold — 并行展开，干净收敛',
    description: 'Treefold 是免费开源的 macOS App，在独立的 Git worktree 中组织并行 Agent 开发，集中管理 Session、Todo、代码改动和交付。支持 Codex、Claude Code、Pi、OpenCode 与 Shell。',
    eyebrow: 'FREE · OPEN SOURCE · MACOS',
    heroTitle: ['让 Agent 并行工作。', '把 Git 干净收敛。'],
    heroBody: 'Treefold 是管理并行 Agent 开发的 macOS App。为不同任务组织独立的 Git worktree，集中运行 Agent 和 Shell，跟进任务、检查改动，并完成交付与归档。',
    download: '获取 Treefold',
    source: '查看源码',
    privateNote: '首个公开 Alpha 已发布，支持 Homebrew 安装和 DMG 下载。',
    proof: ['独立的开发目录', '任务与 Session 集中管理', '从开工到交付收尾'],
    modelKicker: 'THE OPERATING MODEL',
    modelTitle: '每项工作，都有自己的位置。',
    modelBody: '例如开发一项登录功能：把前后端仓库放进同一个 Project，为整项 feature 创建 Workspace，再用 Fork 并行处理验证与测试。',
    sessionNote: '隔离发生在 Workspace / Fork 层级。同一 Workspace 或 Fork 中的多个 Session 可以共享 checkout。',
    gitKicker: 'REVIEW AND DELIVER',
    gitTitle: '看清改动，再决定如何交付。',
    gitBody: '在当前工作中查看 diff 和 Git History、同步分支、处理冲突。为整个 Workspace 或 Fork 选择交付方式，再逐仓库检查与执行。',
    gitFeatures: [
      ['检查代码与历史', '查看文件改动、暂存状态和提交差异，按需提交或整理历史。'],
      ['同步分支与处理冲突', '通过 rebase 或 merge 更新代码；遇到冲突时，可以启动辅助处理 Session，检查解决结果后继续。'],
      ['中断后继续交付', '交付进度会保留。操作中断或出现冲突后，重新检查 Git 状态，再继续剩余步骤。'],
    ],
    gitIllustrationLabel: 'Git History 功能示意',
    gitExample: {
      yesterday: '昨天',
      monday: '周一',
      files: '个文件',
      commitActions: '提交操作',
      selected: '2 个 COMMIT 已选中',
    },
    squashTitle: '了解两种 Squash：整理历史与交付成果',
    historySquashTitle: 'Squash 选中的历史',
    historySquashBody: '选择一段连续且未发布的 commit，将它们合并为一个。Treefold 会预览改写范围、阻止不安全的操作，并在结果仍可恢复时提供 Undo。',
    deliverySquashTitle: 'Squash merge 到目标',
    deliverySquashBody: '把 Workspace 交付到本地目标，或把 Fork 交付到父 Workspace，并在目标上生成一个 commit。源 branch 及原始 commit 保持不变。',
    squashFootnote: '两种操作都不会自动 push 或 force-push；Delivery 开始前会同时检查 source 与 target。',
    workflowTitle: '从一项 Todo，到一份交付。',
    workflowBody: '以登录功能为例，把任务、执行过程和代码结果连起来。',
    steps: [
      ['01', '记录 Todo', '在 auth-flow Workspace 中添加“处理认证边界情况”。'],
      ['02', '拆出 Fork', '从 Todo 创建 validation Fork，启动 Agent 处理子任务。'],
      ['03', '检查结果', '查看 diff、运行测试，确认改动与任务要求一致。'],
      ['04', '合回 Workspace', '将 Fork 的成果交付到父 Workspace，继续集成整项 feature。'],
    ],
    deliveryNote: '阶段性交付保留工作状态；完成交付后归档并保留分支与 worktree。远端 PR 评审和合并在你的 Git 托管平台完成。',
    deliveryTitle: '统一选择策略，逐仓库检查与执行',
    deliveryModes: [
      ['合并到目标', 'Workspace 合入本地目标，Fork 合入父 Workspace。可以阶段性交付后继续开发，也可以完成后归档。', ''],
      ['Squash merge', '完成并归档时，可将本次成果合为一个目标提交，保留源分支和原始历史。', '完成时可选'],
      ['推送 feature 分支', 'Workspace 可以推送分支，接入团队已有的评审与 CI；也可以推送阶段成果后继续工作。', ''],
      ['保留，不交付', '不合并或推送代码，直接归档。保留 checkout，需要时重新打开；资源清理由显式删除处理。', ''],
    ],
    continuity: {
      kicker: 'KEEP WORK MOVING',
      title: '切换 Session，继续工作。',
      body: '代码、任务和交付目标归属于 Workspace / Fork。你可以在同一项工作中打开多个 Session，使用熟悉的 Agent 或 Shell。',
      items: [
        ['工作持续保留', 'Session 结束后，Workspace 中的代码与 Todo 仍然保留，方便下一次继续处理。'],
        ['恢复 Codex 对话', '恢复已保存的 Codex 对话，继续上次的工作。'],
        ['让 Agent 读取当前上下文', '通过 treefold CLI 查看当前 Workspace、仓库与 Todo；支持添加、编辑、删除 Todo 和标记阻塞。Codex 启动时还会自动注入工作上下文。'],
      ],
      cliLabel: '当前工作与任务',
      cliNote: '在受管理的 Session 中使用 treefold CLI；配套 Skill 帮助 Agent 理解工作归属与操作边界。',
    },
    agentSupport: {
      kicker: 'MULTIPLE AI AGENTS',
      title: '使用你熟悉的 Agent。',
      body: '在 Workspace 或 Fork 中运行 Codex、Claude Code、Pi、OpenCode，也可以打开 Shell 执行命令。请先安装并配置所选 Agent 的 CLI。',
      available: '现已支持',
    },
    agentsKicker: 'AMUX / MANAGED PROCESSES',
    agentsTitle: '进程托管，跨 Session 接续。',
    agentsBody: 'amux 托管开发服务与长时间运行的进程。你和 Agent 可以同时查看同一份日志；切换或结束 Session 后，仍能继续查看输出、接手排查。',
    agentPoints: ['进程独立于 Agent Session 持续运行', '你与 Agent 同时查看实时日志', '跨 Session 查看日志、交互、重启或停止进程'],
    processNote: '退出 App 后是否保持进程运行，由 amux 设置决定。',
    terminalIllustrationLabel: 'amux 托管进程，人和 Agent 同时查看日志并跨 Session 接续',
    agentSessionEnded: 'Agent Session 已结束 · 进程继续运行',
    sharedLogs: '你与 Agent · 同时查看日志',
    scenariosKicker: 'FITS THE REPOSITORY YOU HAVE',
    scenariosTitle: '把相关仓库，放进同一项工作。',
    scenarios: [
      ['单仓库', '为不同 feature 创建各自的 Workspace，避免并行任务争用同一份代码。'],
      ['多仓库', '前后端共同完成一项 feature：在同一个 Workspace 中组织各仓库的 checkout，并跟踪交付进度。'],
      ['Monorepo 与多目录', '选择具体目录启动 Session，同时保持仓库级 Git 归属。'],
      ['Context Directory', '把规范、笔记等参考资料标记为只读上下文，供开发时查阅。'],
    ],
    ctaKicker: 'FREE AND OPEN SOURCE',
    ctaTitle: '让并行的工作，有序完成。',
    ctaBody: '免费开源，面向 Apple Silicon Mac。Project 状态和编排数据保存在本机，使用标准 Git 分支与 worktree。Agent 的网络访问取决于所用服务和你的配置。',
    ctaDownload: '获取 Treefold',
    ctaSource: 'Star on GitHub',
    ctaStarNote: '如果 Treefold 对你有帮助，欢迎点个 Star，支持这个开源项目。',
  },
  en: {
    title: 'Treefold — Run agents in parallel. Fold the work back cleanly.',
    description: 'Treefold is a free, open source macOS app for parallel agent development in isolated Git worktrees. Organize Sessions, Todos, changes, and delivery with Codex, Claude Code, Pi, OpenCode, and Shell.',
    eyebrow: 'FREE · OPEN SOURCE · MACOS',
    heroTitle: ['Run agents in parallel.', 'Fold the work back cleanly.'],
    heroBody: 'Treefold is a macOS app for managing parallel agent development. Give each task its own Git worktree, run agents and shells together, track work, review changes, and deliver the results.',
    download: 'Get Treefold',
    source: 'View source',
    privateNote: 'The first public alpha is available. Install with Homebrew or download the DMG.',
    proof: ['Separate development directories', 'Tasks and Sessions in one place', 'From starting work to delivering it'],
    modelKicker: 'THE OPERATING MODEL',
    modelTitle: 'A place for every piece of work.',
    modelBody: 'Building a sign-in feature? Put the frontend and backend repositories in one Project, create a Workspace for the feature, and use Forks for parallel validation and testing.',
    sessionNote: 'Isolation belongs to Workspaces and Forks. Multiple Sessions in the same Workspace or Fork can share a checkout.',
    gitKicker: 'REVIEW AND DELIVER',
    gitTitle: 'Review the changes. Choose how to deliver.',
    gitBody: 'Inspect diffs and Git History, sync branches, and handle conflicts in the context of your work. Choose one delivery strategy for the Workspace or Fork, then check and execute it across repositories.',
    gitFeatures: [
      ['Review code and history', 'Inspect file changes, staged state, and commit diffs. Commit or tidy up history when needed.'],
      ['Sync branches and resolve conflicts', 'Update code with rebase or merge. When conflicts arise, start a helper Session, review the resolution, and continue.'],
      ['Continue interrupted delivery', 'Delivery progress is saved. After an interruption or conflict, recheck Git state and continue the remaining steps.'],
    ],
    gitIllustrationLabel: 'Git History illustration',
    gitExample: {
      yesterday: 'Yesterday',
      monday: 'Monday',
      files: 'files',
      commitActions: 'COMMIT ACTIONS',
      selected: '2 COMMITS SELECTED',
    },
    squashTitle: 'Two uses of Squash: rewriting history and delivering work',
    historySquashTitle: 'Squash selected history',
    historySquashBody: 'Select consecutive, unpublished commits and combine them into one. Treefold previews the rewrite, blocks unsafe ranges, and offers Undo while the result remains recoverable.',
    deliverySquashTitle: 'Squash merge into target',
    deliverySquashBody: 'Finish a Workspace into its local target, or a Fork into its parent, as one commit. The source branch and its original commits remain unchanged.',
    squashFootnote: 'Neither operation pushes or force-pushes. Delivery checks both source and target before it starts.',
    workflowTitle: 'From a Todo to delivered code.',
    workflowBody: 'Follow a sign-in task from its description through execution to the resulting code.',
    steps: [
      ['01', 'Add a Todo', 'Add “Validate auth edge cases” to the auth-flow Workspace.'],
      ['02', 'Create a Fork', 'Create the validation Fork from the Todo and start an agent on the subtask.'],
      ['03', 'Review the result', 'Inspect the diff, run tests, and check the changes against the task.'],
      ['04', 'Deliver to the Workspace', 'Integrate the Fork into its parent and continue bringing the feature together.'],
    ],
    deliveryNote: 'Intermediate delivery keeps work active. Finishing archives it while retaining branches and worktrees. Remote PR review and merging happen on your Git hosting platform.',
    deliveryTitle: 'One strategy, checked across repositories',
    deliveryModes: [
      ['Merge into target', 'Merge a Workspace into its local target or a Fork into its parent. Deliver progress and keep working, or finish and archive.', ''],
      ['Squash merge', 'When finishing and archiving, combine the result into one target commit while preserving the source branch and history.', 'OPTIONAL AT FINISH'],
      ['Push feature branch', 'Push a Workspace branch for your team’s review and CI. You can also push intermediate results and keep working.', ''],
      ['Preserve without delivery', 'Archive without merging or pushing. Keep the checkout to reopen later; explicit deletion handles resource cleanup.', ''],
    ],
    continuity: {
      kicker: 'KEEP WORK MOVING',
      title: 'New Sessions. Work carries on.',
      body: 'Code, tasks, and delivery targets belong to a Workspace or Fork. Open multiple Sessions within that work, using your preferred agents or shells.',
      items: [
        ['Keep the work', 'When a Session ends, the Workspace’s code and Todos remain ready for the next session.'],
        ['Resume Codex conversations', 'Resume saved Codex conversations and continue where you left off.'],
        ['Give agents the current context', 'Use the treefold CLI to inspect the Workspace, repositories, and Todos; add, edit, remove, or block a Todo. Codex also receives work context automatically at launch.'],
      ],
      cliLabel: 'CURRENT WORK AND TASKS',
      cliNote: 'Use the treefold CLI in managed Sessions. The companion Skill helps agents understand work ownership and operation boundaries.',
    },
    agentSupport: {
      kicker: 'MULTIPLE AI AGENTS',
      title: 'Work with the agents you know.',
      body: 'Run Codex, Claude Code, Pi, or OpenCode in a Workspace or Fork, or open a Shell for commands. Install and configure your chosen agent’s CLI first.',
      available: 'Available now',
    },
    agentsKicker: 'AMUX / MANAGED PROCESSES',
    agentsTitle: 'Managed processes. Shared across sessions.',
    agentsBody: 'amux manages development services and long-running processes. You and your agent can read the same logs at the same time, then keep inspecting output and debugging across sessions.',
    agentPoints: ['Processes keep running independently of Agent Sessions', 'Humans and agents share live logs simultaneously', 'Read logs, interact, restart, or stop across sessions'],
    processNote: 'Whether processes survive App exit follows the amux preference.',
    terminalIllustrationLabel: 'An amux process with shared human and agent logs across sessions',
    agentSessionEnded: 'Agent Session ended · process remains active',
    sharedLogs: 'HUMAN + AGENT · SHARED LIVE LOGS',
    scenariosKicker: 'FITS THE REPOSITORY YOU HAVE',
    scenariosTitle: 'Bring related repositories into the same work.',
    scenarios: [
      ['Single repository', 'Give each feature its own Workspace so parallel tasks do not compete for the same checkout.'],
      ['Multiple repositories', 'Build a feature across frontend and backend repositories. Organize their checkouts and track delivery in one Workspace.'],
      ['Monorepo and multiple directories', 'Choose the directory where a Session starts while keeping repository-level Git ownership.'],
      ['Context Directory', 'Mark specifications, notes, and other reference material as read-only context to consult while developing.'],
    ],
    ctaKicker: 'FREE AND OPEN SOURCE',
    ctaTitle: 'Bring parallel work to a clear finish.',
    ctaBody: 'Free and open source for Apple Silicon Macs. Project state and orchestration data stay on your Mac, using standard Git branches and worktrees. Agent network access depends on your services and configuration.',
    ctaDownload: 'Get Treefold',
    ctaSource: 'Star on GitHub',
    ctaStarNote: 'If you find Treefold useful, consider giving it a star on GitHub to support the project.',
  },
} satisfies Record<Locale, HomeCopy>;
