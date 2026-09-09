# Agent Skill、CLI 与 amux 集成

状态：当前架构与运行合同。

## 决策摘要

Treefold 是管理层，不是 Agent 智能层：它管理 Project、Workspace、物理工作目录、Session 和 Todo，但不复制 Codex 会话历史，不要求逐轮总结，也不存 Report、handoff、验证证据或 Agent memory。

```text
Treefold App
├── Rust/Axum backend：Treefold 状态与权限
├── React UI：用户控制面
├── treefold CLI + Skill：上下文与 Todo
└── Treefold 专属 amux runtime
    └── amux CLI + Skill：进程、TTY、日志和重启
```

Treefold 不包装 `amux run/logs/restart`，也不实现第二套子 Agent 编排。进程管理由独立的 amux CLI 和 Skill 承担；Codex 使用自身的子 Agent 能力。

amux 是可脱离 Treefold 使用的独立模块，也是 `amux` CLI 与 Skill 的唯一源码和版本
所有者。Treefold 仓库只维护自己的 `cli/skills/treefold`；release 构建从选定的 amux
源码 staging 二进制与 `skills/amux`，并以 amux package version 同时标记两者。

## `treefold` CLI

桌面 App 使用 Electron 主进程，并启动内部 Rust 可执行文件 `treefold-backend`；用户 CLI 是不依赖桌面运行时的独立
`treefold-cli` package，产物名为 `treefold`。无参数时显示帮助，打开 App 必须显式执行：

```text
treefold
treefold open [path]
treefold current [--json]

treefold todo list|show|add|edit|remove|block

treefold doctor
treefold version
```

CLI 约束：

- 非流式数据命令支持全局 `--json`；
- JSON 只写 stdout，诊断写 stderr；
- App/API 不可用时快速失败，不启动另一个 Treefold 后端；
- CLI 不直接读取 SQLite；
- `remove` 是永久删除，Skill 只在用户明确要求时使用；
- 不提供 `treefold report`、`treefold service`、`treefold logs` 或 Agent spawn 命令。

## 安装、更新与所有权

安装时 App bundle 是集成资源的版本源，manifest 记录 schema、bundle、protocol、CLI
和 Skill 版本；其中 amux CLI 与 Skill 的版本在 release staging 时取自 amux 模块。
App 启动时只读检查；缺失、过期、不完整或冲突时，在单次 App
进程内提示一次，并持续显示左下角异常状态。只有用户点击“安装集成/同步”才修改：

```text
~/.local/bin/treefold
~/.agents/skills/treefold
~/.agents/skills/amux
```

三个路径都是指向当前 App bundle 的软链接。`amux` CLI 是 Session 私有资源，不创建
`~/.local/bin/amux`。receipt 位于 `$TREEFOLD_HOME/data/agent-integration.json`；更新只
替换 receipt 所有的旧链接，冲突路径不覆盖。卸载只移除仍匹配 receipt 的链接。

退出码：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 参数或输入无效 |
| `3` | Treefold App/API 不可用 |
| `4` | Session 身份或权限无效 |
| `5` | 状态冲突，例如 Todo 已关联活动 Fork |
| `10` | Treefold 内部错误 |

## 当前上下文

Treefold managed Session 中运行：

```bash
treefold current --json
```

一次返回：

- Project；
- Workspace；
- Session；
- 当前及原始 workspace path；
- 目录拓扑；
- branch、HEAD、dirty 等 Git 摘要；
- Workspace 固定的 Project target branch；
- 当前 Workspace 的 Todo；
- 当前物理 workspace 对应的 amux workspace。

Git 信息是读取时快照。Agent 在破坏性或历史修改前仍需使用 Git 重新确认。

## Todo 模型

Todo 是 Workspace 的工作项，不是执行报告：

```text
pending ── create Fork ──→ in_progress ── finish with local merge ──→ done
   └──────────────→ blocked

in_progress / blocked ── archive Fork ──→ pending
```

字段包括 `content`、`status`、可选的 `fork_id`、可选阻塞原因及时间戳。
`in_progress` 表示 Todo 已绑定活动 Fork，而不是某个 Agent Session 持有锁。Fork
成功合并到父 Workspace 后 Todo 变为 `done`；归档未完成的 Fork 时回到
`pending`。Agent 可以把当前范围内的 Todo 标记为 `blocked`，但不直接 claim、
release 或 done。

Todo 属于根 Workspace；由 Todo 创建的 Fork 通过 `fork_id` 关联该工作项。根
Workspace Session 可见整个 Workspace 的 Todos，Fork Session 只看见与该 Fork
关联的 Todo，Project Session 不拥有开发 Todo。需要理解工作过程时恢复真实 Codex
Session，而不是读取 Treefold 生成的二手摘要。

## Agent API

CLI 只访问版本化窄接口：

```text
GET    /api/v1/agent/current
GET    /api/v1/agent/todos
POST   /api/v1/agent/todos
GET    /api/v1/agent/todos/{id}
PATCH  /api/v1/agent/todos/{id}
DELETE /api/v1/agent/todos/{id}
POST   /api/v1/agent/todos/{id}/block
```

接口要求 `Authorization: Bearer <TREEFOLD_API_TOKEN>`，并把能力限制到 token 绑定的当前 Session 和 Workspace。当前 pre-release 的本地 loopback capability 使用随机 Session ID；后续可以替换成独立短期 token，而不改变 CLI 协议。

Agent API 不暴露 Project/Workspace 创建删除、Session 控制、checkout、rebase、reset 或 delivery。

## amux runtime

Treefold 使用独占配置，不与用户默认 amuxd 冲突：

```text
state:  $TREEFOLD_HOME/data/amux
socket: $TMPDIR/amux-<uid>-<daemon hash>.sock
```

一个唯一的物理 workspace root 对应一个 amux workspace。Git 项目中通常就是一个 Git worktree：

```text
Project main worktree  ↔ amux workspace
managed Workspace     ↔ amux workspace
```

每个开发 Workspace/Fork 为各个 ready Repository 使用 managed worktree，并按规范化
路径映射到稳定的 amux workspace。

Treefold Session 注入：

```text
TREEFOLD_API_URL
TREEFOLD_API_TOKEN
TREEFOLD_PROJECT_ID
TREEFOLD_WORKSPACE_ID
TREEFOLD_SESSION_ID
TREEFOLD_HOME
TREEFOLD_INTEGRATION_VERSION
AMUX_STATE_DIR
AMUX_SOCKET
AMUX_WORKSPACE
AMUX_WORKSPACE_ID
AMUX_PROCESS_ID
PATH=<Treefold.app bundled binaries>:<inherited PATH>
```

因此 Agent 可直接通过 amux Skill 执行：

```bash
amux run --name api -- cargo run
amux logs --follow "$AMUX_WORKSPACE/api"
amux restart "$AMUX_WORKSPACE/api"
```

`amux run` 和 `amux shell` 从 `AMUX_WORKSPACE` 读取默认 workspace。Treefold Skill 不复制 amux 命令说明，只引用独立 `$amux` Skill。

## Skill 行为

Treefold Skill：

1. 需要 Treefold 上下文时运行一次 `treefold current --json`；
2. 按需 list/show/add/edit/remove Todo；
3. 只在真实阻塞时 block；Todo 的 Fork 绑定与完成状态由 Treefold 生命周期管理；
4. 不逐轮上报 progress，不生成 report 或 handoff；
5. 进程操作切换到 `$amux` Skill；
6. 不自行执行 Treefold 生命周期操作；
7. App 不可用时继续安全的本地工作，并明确 Todo 同步失败。

amux Skill：

- 管理长期服务、watcher、测试进程和 TTY；
- 使用当前 Treefold 注入的 runtime 和 workspace；
- 不停止、重启、kill 或删除当前 `AMUX_PROCESS_ID`；
- 不作为第二套子 Agent orchestration。

## 运行合同

- `treefold` 无参数显示帮助，`treefold open` 显式启动桌面 App；
- managed Session 中 `treefold current --json` 返回完整、来源明确的当前快照；
- 根 Workspace Agent 只能读写当前 Workspace 的 Todo，Fork Agent 只能访问其关联
  Todo，Project Session 不能访问开发 Todo；
- Agent Todo API 支持 Markdown content 的 CRUD 和带原因的 block；
- `in_progress`、Fork 关联和完成状态由 Treefold 的 Todo-driven Fork 生命周期维护；
- 每个实际 workspace root 使用稳定且隔离的 amux workspace；
- Treefold Session 中的 amux CLI 连接专属 runtime，不连接用户默认 amuxd；
- Treefold 与 amux Skill 均通过 Skill 结构校验；
- App 关闭时 Treefold 数据命令快速失败，不自行启动 App 或 daemon。
