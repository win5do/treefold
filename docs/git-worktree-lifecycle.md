# Git Worktree 生命周期路线

状态：Treefold 核心领域能力的开发约束。

## 目标

Treefold 管理 Agent 工作所需的 Git 生命周期，而不是成为完整 Git GUI。

```text
Create -> Work -> Inspect -> Rebase -> Recover -> Settle -> Cleanup
```

## 生命周期能力

| 阶段 | 必须回答的问题 | 核心能力 |
| --- | --- | --- |
| Create | 工作从哪里开始？资源是否创建完整？ | base ref/commit、clean 检查、branch/worktree 创建与失败回滚 |
| Work | 当前工作状态如何？ | dirty status、diff、提交范围、ahead/behind |
| Inspect | 代码如何演进？发生过哪些操作？ | Git history、Workstream 事件、关键 commit 锚点 |
| Rebase | 如何跟进父级最新变化？ | 子级向父级 rebase、Continue/Abort、冲突保留 |
| Recover | 如何撤销错误或中断操作？ | recovery ref、语义化 reset、merge/rebase abort、Repair |
| Settle | 工作如何安全交付？ | preflight、验证、commit、merge、记录向上携带 |
| Cleanup | 何时可以删除资源？ | 可达性验证、worktree/branch 删除、残留状态校准 |

## 不变量

- Workstream 只合入 Project 基准分支，Fork 只合入父 Workstream。
- rebase 只允许子级跟进父级，不允许方向模糊的任意 rebase。
- Treefold 发起的 Git 变更要求 workspace clean；早期不自动 stash。
- 冲突或失败时保留 branch、worktree 和恢复锚点。
- 未验证 source commit 可从 target 到达前，不删除已合并 branch。
- 只有用户明确选择 discard，才允许强制删除未合并代码。
- 破坏性操作必须记录 `before_head`、`target_head`、结果和错误。

## Settlement 状态

跨 Git、文件系统、进程和 SQLite 的结算必须可恢复：

```text
active
-> preflight_passed
-> code_integrated
-> records_carried
-> sessions_settled
-> resources_cleaned
-> archived
```

每一步都应幂等、可重试，并能在应用重启后继续。失败不能伪装成未开始，也不能
静默留下已合并但仍 active 的 Workstream。

## 恢复与校准

破坏性操作前创建类似 `refs/treefold/recovery/<operation-id>` 的恢复引用。应用启动和
用户触发 Repair 时，对照以下状态：

```text
SQLite metadata <-> git worktree list <-> branch/refs <-> actual directory
```

发现不一致时展示原因和明确修复动作，不静默删除用户资源。

## 能力边界

纳入核心：status、diff、工作提交历史、ahead/behind、fetch、定向 rebase、
Continue/Abort、带恢复锚点的 reset、settlement、cleanup、reconciliation。

暂不纳入：通用 interactive rebase、完整 staging GUI、blame、tag/release、复杂
cherry-pick 和 Git 托管平台的全功能客户端。

