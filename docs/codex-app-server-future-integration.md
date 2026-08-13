# Codex App Server 未来集成

状态：设计备忘，暂缓实现。

## 当前决策

当前阶段继续使用 `amux + Codex TUI` 启动和承载 Codex Session，不引入
Codex App Server，也不替换现有 Terminal 交互。

Treefold 只保留未来接入点：在启动后的 Codex Session ID 被可靠捕获后，可将
它作为 Codex App Server 的 `threadId`，读取 Codex 自己维护的会话元数据与历史。

## 未来可能使用的能力

- 使用 `thread/read` 按 ID 读取会话摘要；需要完整历史时设置
  `includeTurns: true`。
- 使用 `thread/list` 获取标题、预览、时间和状态等列表信息。
- 使用 `thread/name/set` 设置或更新用户可见标题。
- 需要长历史分页时再评估 `thread/turns/list` 和 `thread/items/list`；这两个接口
  当前属于实验性能力，不作为第一阶段依赖。
- 如果未来构建原生聊天界面，可再评估 `thread/start`、`turn/start`、流式事件、
  interrupt 与 approval 流程。该方向不属于当前范围。

官方协议说明：<https://learn.chatgpt.com/docs/app-server>

## 建议的接入边界

初次接入时，App Server 仅作为会话信息读取器：

```text
Treefold backend
├── amux -> Codex TUI               # 现有终端交互保持不变
└── codex app-server --stdio        # 读取 title/history/metadata
```

Treefold backend 应封装独立适配层，将 Codex 协议转换为自己的稳定 DTO；React
前端不得直接依赖 App Server 的原始响应。Treefold Session 与 Codex Thread 通过
已持久化的 `codex_session_id` 关联。

可考虑提供类似下面的内部 API：

```text
GET /api/sessions/:treefoldSessionId/codex-thread
```

建议的标题回退顺序：

```text
thread.name
-> thread.preview
-> 第一条用户消息的截断文本
-> Codex · repositoryName
```

历史记录可能包含命令、工具输出、文件路径和其他敏感上下文。默认 UI 只展示
user/assistant 消息，工具调用与原始记录按需展开；不应无选择地复制整份历史到
Treefold 数据库。

## 稳定性要求

实施前需要重新核对随当前 Codex CLI 发布的协议和生成 schema，不能假设今天的
字段结构永久稳定。第一阶段优先依赖官方文档中未标记为 experimental 的
`thread/read`、`thread/list` 和 `thread/name/set`，并在 Treefold 适配层处理缺失字段、
未知 item 类型和版本差异。

Codex Session ID 的捕获必须先达到可靠状态。当前基于工作目录和启动时间扫描
`$CODEX_HOME/sessions` 的方式，在同一目录并发启动多个 Codex 时存在误关联风险；
在 App Server 信息成为产品能力前，应先消除或显著降低这个风险。

App Server 进程失败、协议不兼容或历史暂不可读时，不得影响现有 Terminal Session
的启动、连接、关闭和恢复。标题与历史都应被视为可降级的增强信息。

## 启动实施的条件

只有出现下列明确产品需求之一时再实施：

- 自动生成或同步 Codex Session 标题；
- 在 Treefold 中浏览、搜索或分页展示 Codex 历史；
- 不进入 Terminal 也能查看 Codex Session 摘要与状态；
- 构建 Treefold 原生的 Codex 聊天与审批界面。

在这些需求出现之前，不为 App Server 增加常驻进程、数据库字段、前端页面或新的
生命周期复杂度。
