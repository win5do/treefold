# Agent Skill、CLI 与 App API 架构

状态：提案，作为 Agent 集成首期实现边界。

## 决策摘要

Treefold 的 Agent Skill 服务于 **Treefold 管理的 Session**。它让 Session 中的 Agent
读取所属 Workstream 的工作信息，并把进度、结果、证据和阻塞回传给 Treefold App。

```text
Treefold App
├── Rust/Axum backend：状态与权限的唯一拥有者
├── React UI：用户控制面
└── managed Session
    └── Agent -> Treefold Skill -> treefold CLI -> App Agent API
```

首期不引入常驻 daemon。App 退出后 API 不可用，CLI 返回明确的不可用错误，不自行
启动后台服务。只有未来需要脱离 App 的 CI、定时任务、远程控制或持久 Session 时，
才重新评估独立 `treefoldd`。

Skill 的定位是 **Workstream 运行信息桥梁和执行反馈通道**，不是生命周期控制器。
创建、删除、rebase、settlement 和资源清理仍由用户通过 UI 或显式控制流程发起。

## 目标

- Agent 能可靠识别自己所属的 Project、Workstream/Fork 和 Session。
- Agent 能一次获取完成工作所需的目录拓扑、Todo 和必要状态摘要。
- Agent 能回传 Todo 进度、完成结果、验证证据、阻塞和 handoff。
- Treefold UI 能展示 Agent 的真实执行状态，而不依赖解析终端文本。
- Agent 只能访问当前 Session 被授权的 Workstream 范围。
- CLI 面向 Skill 提供稳定 JSON、退出码和可诊断错误。
- 复用当前 App 内嵌 Axum backend，不增加 daemon 生命周期复杂度。

## 非目标

首期 Agent Skill 不负责：

- 创建或删除 Project、Workstream、Fork；
- 创建、停止、重启或删除其他 Session；
- checkout、rebase、merge、settlement、discard 或 cleanup；
- 直接操作 Treefold SQLite；
- 在 Treefold App 未运行时独立工作；
- 对外提供通用自动化平台或远程 API。

Agent 可以把“建议创建 Fork”“建议 rebase”“已经满足结算条件”等判断作为 report
回传，但不能默认执行这些动作。

## 核心场景

### 1. Session 启动时获取工作快照

Treefold 创建 Session 时注入身份和连接信息。Skill 在需要了解任务时执行一次：

```bash
treefold current --json
```

返回一个面向 Agent 的工作快照：

```text
CurrentSnapshot
├── project
├── workstream
├── session
├── workspace
├── directories
├── integration_target
├── todos
└── status
    ├── git summary
    ├── active forks
    └── lifecycle warnings
```

Skill 不需要依次遍历 Project、Workstream 和 Session API，也不需要从当前目录猜测归属。

### 2. Todo 执行反馈闭环

Agent 可以领取当前 Workstream 的 Todo，并在有意义的状态变化时回传：

```bash
treefold todo claim <todo-id>
treefold todo progress <todo-id> --message "实现完成，正在运行回归测试"
treefold todo complete <todo-id> \
  --result "增加冲突恢复流程" \
  --evidence "cargo test: passed"
treefold todo block <todo-id> --reason "缺少目标分支选择"
```

回传发生在领取、重要进度、阻塞和完成节点，不要求 Agent 高频轮询或持续上报。

### 3. 动态运行信息与 handoff

稳定的项目知识由仓库中的 `AGENTS.md` 和 `docs/` 维护。Treefold 在每次 Codex launch
或 resume 时通过 `developer_instructions` 注入 Project、Workstream/Fork、cwd、附加目录、
branch、父级集成目标和生命周期边界。Git 信息是启动快照，Agent 在历史修改前仍需重新检查。

工作完成或即将结束时，Agent 可以生成结构化 handoff：

```bash
treefold report \
  --summary "完成 recoverable rebase" \
  --verification "cargo test; npm run typecheck" \
  --risk "原生桌面流程尚未人工验证" \
  --next "在 UI 中补充冲突状态入口"
```

Report 是执行记录，不触发 settlement。

## 分层设计

### Treefold Skill

Skill 负责告诉 Agent 何时以及如何使用 CLI：

- 进入任务时读取 `treefold current --json`；
- 优先处理分配给当前 Session 的 Todo；
- 只在状态发生变化时回传；
- 完成时附带验证证据和剩余风险；
- 不自行执行生命周期 Action；
- App 不可用时继续完成本地代码工作，并明确记录回传失败。

Skill 不包含 HTTP、端口发现或鉴权细节，这些由 CLI 封装。

### `treefold` CLI

CLI 是 Agent API 的薄客户端，不复制 Store、Git 或生命周期业务逻辑。

首期命令面：

```text
treefold current [--json]
treefold todo list|claim|progress|complete|block
treefold report
treefold doctor
```

约束：

- 非交互命令必须支持 `--json`；
- JSON 输出只写 stdout，诊断信息写 stderr；
- 字段和错误码保持向后兼容；
- 默认从环境变量发现 App，不扫描端口、不读取数据库；
- 不在 App 不可用时自动启动 daemon；
- 不暴露 UI 控制面的任意 HTTP 转发命令。

建议退出码：

| 退出码 | 含义 |
| --- | --- |
| `0` | 成功 |
| `2` | 参数或输入无效 |
| `3` | Treefold App/API 不可用 |
| `4` | 身份或权限无效 |
| `5` | 状态冲突，例如 Todo 已被领取 |
| `10` | Treefold 内部错误 |

### App Agent API

Agent API 是现有 UI API 之上的窄接口，不直接把所有管理路由授权给 Session。

建议版本前缀：

```text
/api/v1/agent
```

首期端点：

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/current` | 返回当前 Session 的完整工作快照 |
| `GET` | `/todos` | 返回当前 Workstream Todo |
| `POST` | `/todos/{id}/claim` | 原子领取 Todo |
| `POST` | `/todos/{id}/progress` | 更新进度信息 |
| `POST` | `/todos/{id}/complete` | 写入结果与证据并完成 |
| `POST` | `/todos/{id}/block` | 记录阻塞原因 |
| `POST` | `/reports` | 写入结构化执行报告或 handoff |
| `GET` | `/health` | 校验 App、身份和 API 版本 |

Agent API 不包含 Project/Workstream/Fork 创建删除、Session 控制、Git checkout、rebase
或 settlement。相关现有路由继续属于 UI/用户控制面。

建议响应结构：

```json
{
  "data": {},
  "request_id": "req_..."
}
```

```json
{
  "error": {
    "code": "todo_already_claimed",
    "message": "Todo is assigned to another Session",
    "details": {}
  },
  "request_id": "req_..."
}
```

错误码用于 Skill 决策，`message` 用于人类诊断。CLI 不应依赖错误字符串匹配。

## 身份、发现与权限

Treefold 创建 managed Session 时注入：

```text
TREEFOLD_API_URL
TREEFOLD_API_TOKEN
TREEFOLD_PROJECT_ID
TREEFOLD_WORKSTREAM_ID
TREEFOLD_SESSION_ID
```

其中 ID 用于 Agent 展示和诊断；服务端身份以 token 为准，不能信任客户端提交的 ID。

Token 采用短期 capability：

- 绑定一个有效 Session 和它所属的 Workstream；
- 可读取当前 Session 的目录、Git 摘要和父级集成目标；
- 只能写当前 Workstream 的 Todo 和 Report；
- 不能调用 UI 控制面；
- Session 被删除或 Workstream 归档后失效；
- 不写入终端日志、错误详情或持久化 Agent 产物。

App 只监听 loopback。Agent API 要求 `Authorization: Bearer <token>`，并限制 CORS；
不能沿用当前内部 API 的任意 Origin 策略。`TREEFOLD_API_URL` 允许 App 使用动态端口，CLI
不应假设固定 `7331`。

## 状态模型补充

### Todo

为了支持 Agent 回传，Todo 至少需要表达：

```text
status: pending | assigned | in_progress | blocked | done
session_id
progress_message
result
evidence[]
blocked_reason
claimed_at
completed_at
updated_at
```

`claim` 必须是原子状态转换：只有未分配 Todo 能被领取；重复领取同一个 Todo 应幂等；
其他 Session 已领取时返回 `todo_already_claimed`。

### Report

Report 是不可变或追加式的 Workstream 事件，建议包含：

```text
id
project_id
workstream_id
session_id
kind: progress | handoff | verification | recommendation
summary
verification[]
risks[]
next_steps[]
created_at
```

Report 表达一次执行的结果和证据；稳定规则与知识应沉淀到 `AGENTS.md` 或项目文档。

### Git 状态

`current` 中的 Git 信息只提供 Agent 做决策所需的摘要：

- branch、HEAD、dirty；
- changed file count；
- 相对父级的 ahead/behind；
- conflict/rebase/settlement 状态；
- 最近一次验证摘要（如果存在）。

Agent 仍可在 workspace 中使用标准 Git 命令获取详细 diff。首期不为 Skill 重复实现完整
Git API。

## 生命周期与失败语义

- App 是唯一状态拥有者；CLI 不直接打开 SQLite。
- App 关闭或 API 重启时，CLI 快速失败并返回 `app_unavailable`。
- 状态写入使用请求 ID；可重试写操作应支持幂等键。
- Todo claim/complete 在服务端完成权限校验和状态转换。
- Skill 回传失败不应导致代码任务失败，但必须在最终回复中告知用户。
- 不要求 CLI 常驻，不要求 Skill 保持长连接。

## 与现有架构的关系

当前实现已经具备：

- Tauri 进程内的 Axum loopback API；
- `Project -> Workstream -> Fork -> Session` 的归属信息；
- Codex launch/resume 的动态 `developer_instructions`；
- Todo 创建与状态更新；
- Session 中的 `TREEFOLD_PROJECT_ID`、`TREEFOLD_WORKSTREAM_ID`、`TREEFOLD_SESSION_ID`。

首期演进重点不是拆分 backend，而是：

1. 增加 Session capability token 和 API URL 注入；
2. 建立窄的、版本化 Agent API；
3. 增加 `current` 聚合快照；
4. 扩充 Todo 回传字段和原子状态转换；
5. 增加 Report/handoff 记录；
6. 实现薄 CLI 和对应 Skill；
7. 在 UI 展示 Agent 进度、结果、证据和阻塞。

## 分阶段交付

### Phase 1：只读运行快照

- 注入 API URL、token 和身份变量；
- `GET /current`；
- `treefold current` 和 `treefold todo list --json`；
- Skill 在 Session 中读取工作快照。

### Phase 2：反馈闭环

- Todo claim/progress/complete/block；
- Report/handoff；
- 幂等、结构化错误和审计字段。

### Phase 3：用户可见状态

- UI 展示当前执行者、进度、阻塞、结果和证据；
- 用户可以从 Report 创建新 Todo 或更新项目文档；
- Agent 的 Fork/rebase/settlement 建议只显示为建议操作。

### Phase 4：重新评估控制能力

根据真实使用数据决定是否增加显式授权的控制 Skill。默认 Skill 仍不获得生命周期权限。
只有出现脱离 App 的明确场景时，才评估独立 daemon。

## 验收标准

- Treefold managed Session 中执行 `treefold current --json` 能一次返回完整且来源明确的运行快照。
- Agent 不能读取其他 Project 的私有 Workstream 数据，也不能写父级 Workstream 状态。
- 两个 Session 同时 claim 同一 Todo 时只有一个成功。
- Todo 完成后，Treefold UI 可查看结果、验证证据和执行 Session。
- Agent 可以提交 handoff，但不能通过 Agent token 调用 rebase、settlement 或删除路由。
- App 关闭时 CLI 在短时间内以稳定退出码和结构化错误结束，不启动后台进程。
- CLI 输出可直接被 Skill 消费，不需要解析面向人类的终端文案。
