# Agent Skill、CLI 与 amux 集成

状态：MVP 已实现。

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

## `treefold` CLI

桌面 App 与 CLI 共用 `treefold` 可执行文件。无参数运行时启动 App：

```text
treefold
treefold open [path]
treefold current [--json]

treefold todo list|show|add|edit|remove
treefold todo claim|release|done|block

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

退出码：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 参数或输入无效 |
| `3` | Treefold App/API 不可用 |
| `4` | Session 身份或权限无效 |
| `5` | 状态冲突，例如 Todo 已被其他 Session 领取 |
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

MVP Todo 是管理事实，不是执行报告：

```text
pending → assigned → done
   │          │
   └──────────┴→ blocked
assigned → pending   (release)
```

字段包括 title、description、status、Session 归属、可选阻塞原因及时间戳。不保存逐轮 progress、result、evidence、verification 或 handoff。

`claim` 是服务端原子状态转换：未领取 Todo 只能由一个 Session 领取；同一 Session 重试幂等；其他 Session 收到冲突。`done` 和 `block` 不能覆盖其他 Session 已领取的 Todo。

Todo 与 Codex Session ID 关联。需要理解工作过程时恢复真实 Codex Session，而不是读取 Treefold 生成的二手摘要。

## Agent API

CLI 只访问版本化窄接口：

```text
GET    /api/v1/agent/current
GET    /api/v1/agent/todos
POST   /api/v1/agent/todos
GET    /api/v1/agent/todos/{id}
PATCH  /api/v1/agent/todos/{id}
DELETE /api/v1/agent/todos/{id}
POST   /api/v1/agent/todos/{id}/claim
POST   /api/v1/agent/todos/{id}/release
POST   /api/v1/agent/todos/{id}/done
POST   /api/v1/agent/todos/{id}/block
```

接口要求 `Authorization: Bearer <TREEFOLD_API_TOKEN>`，并把能力限制到 token 绑定的当前 Session 和 Workspace。MVP 的本地 loopback capability 使用随机 Session ID；后续可以替换成独立短期 token，而不改变 CLI 协议。

Agent API 不暴露 Project/Workspace 创建删除、Session 控制、checkout、rebase、reset 或 delivery。

## amux runtime

Treefold 使用独占配置，不与用户默认 amuxd 冲突：

```text
state:  $TREEFOLD_HOME/data/amux
socket: /tmp/treefold-amux-<TREEFOLD_HOME hash>/amuxd.sock
```

一个唯一的物理 workspace root 对应一个 amux workspace。Git 项目中通常就是一个 Git worktree：

```text
Project main worktree  ↔ amux workspace
managed Workspace     ↔ amux workspace
```

每个 Workspace 都拥有 managed worktree，并按规范化路径映射到稳定的 amux workspace。

Treefold Session 注入：

```text
TREEFOLD_API_URL
TREEFOLD_API_TOKEN
TREEFOLD_PROJECT_ID
TREEFOLD_WORKSPACE_ID
TREEFOLD_SESSION_ID
AMUX_STATE_DIR
AMUX_SOCKET
AMUX_WORKSPACE
AMUX_WORKSPACE_ID
AMUX_PROCESS_ID
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
3. 开始 Todo 时 claim，放弃时 release，完成时 done，真实阻塞时 block；
4. 不逐轮上报 progress，不生成 report 或 handoff；
5. 进程操作切换到 `$amux` Skill；
6. 不自行执行 Treefold 生命周期操作；
7. App 不可用时继续安全的本地工作，并明确 Todo 同步失败。

amux Skill：

- 管理长期服务、watcher、测试进程和 TTY；
- 使用当前 Treefold 注入的 runtime 和 workspace；
- 不停止、重启、kill 或删除当前 `AMUX_PROCESS_ID`；
- 不作为第二套子 Agent orchestration。

## MVP 验收标准

- `treefold` 无参数能启动桌面 App；
- managed Session 中 `treefold current --json` 返回完整、来源明确的当前快照；
- Agent 只能读写当前 Workspace 的 Todo；
- 两个 Session 同时 claim 同一 Todo 时只有一个成功；
- Todo 支持 CRUD、claim、release、done 和带原因的 block；
- 每个实际 workspace root 使用稳定且隔离的 amux workspace；
- Treefold Session 中的 amux CLI 连接专属 runtime，不连接用户默认 amuxd；
- Treefold 与 amux Skill 均通过 Skill 结构校验；
- App 关闭时 Treefold 数据命令快速失败，不自行启动 App 或 daemon。
