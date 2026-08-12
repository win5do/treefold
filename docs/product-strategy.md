# Treefold 产品方向

状态：后续开发的产品原则与优先级依据。

## 定位

Treefold 是面向 Codex 工作流的本地 Git worktree 生命周期管理器。它把一项
Agent 工作组织为可隔离、可并行、可恢复并最终安全收敛的交付单元。

```text
一项 Workstream
= Git workspace
+ 多个 Codex / Shell Session
+ Todo
+ 受控 Fork
+ 明确的结算流程
```

对象边界与三级层级见 [project-workstream-model.md](./project-workstream-model.md)。

## 要解决的问题

AI 可以快速写代码，但多个 Agent 并行后，branch、worktree、终端、目录关系和清理
工作容易失控。Treefold 需要让用户放心开工，并保证每项工作都能恢复、验证、合并
和回收。

## 核心原则

- **Workstream 拥有 workspace，Session 只负责执行。** 多个 Session 可以围绕同一项
  工作协作，不因每次对话制造新分支。
- **只提供受控并行。** 层级固定为 `Project -> Workstream -> Fork`，Fork 不再嵌套。
- **创建和回收同等重要。** Treefold 不只启动 Agent，还负责 Git 资源的完整生命周期。
- **失败必须可恢复。** merge、rebase、reset 和 cleanup 都要留下恢复锚点并可重试。
- **本地优先且不锁定。** 使用标准 Git、Codex CLI 和本地数据，退出 Treefold 后代码与
  历史仍可正常使用。

## 核心能力

1. **Isolation**：可靠创建 branch/worktree，避免并行工作互相污染。
2. **Evolution**：通过 status、diff、history、ahead/behind 和 rebase 跟进父级变化。
3. **Recovery**：支持 abort、reset、repair 和应用中断后的状态校准。
4. **Convergence**：把代码、Todo、Session 历史和 Git 资源一起向上结算。

## 开发优先级

### P0：闭合真实交付流程

- 可靠完成 `Create -> Work -> Verify -> Settle -> Cleanup`。
- 将 settlement 改造成可记录、可重试、可恢复的状态机。
- 在合并前展示 diff、提交范围、ahead/behind 和验证结果。
- 提供 Workstream/Fork 向父级 rebase，以及冲突的 Continue/Abort。
- 提升 Codex Session ID 捕获、应用重启校准和历史 Resume 的确定性。
- 对 SQLite、Git worktree、branch 和实际目录进行 reconciliation 与 Repair。

### P1：形成持续工作的闭环

- 通过 `developer_instructions` 向 Codex 注入实时目录、branch、父级目标和生命周期边界。
- 让 Todo 支持创建、分配、执行结果回写和结算时向上携带。
- 完成 Fork 在父级持续变化时的并行开发和集成体验。
- 为 reset、discard 等破坏性操作增加 recovery ref 和操作记录。

### 暂缓

- 无限层级或通用任务树。
- 为每个 Session 创建独立 worktree。
- 完整 Git GUI、复杂 staging、blame、tag/release 等通用能力。
- 与核心流程无关的主题、动画和边缘布局优化。
- 过早扩展大量 Agent provider 或远程协作平台。

## 决策标准

新增功能至少应明确改善以下一项，否则默认不进入近期路线：

1. 是否让隔离工作创建得更可靠？
2. 是否让 Workstream/Fork 的并行协作更清楚？
3. 是否让中断、冲突或误操作后的恢复更确定？
4. 是否让代码和工作记录更安全地收敛与回收？
