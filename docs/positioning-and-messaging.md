# Treefold 定位与宣传信息

状态：README、发布介绍和演示内容的统一口径。

## 品牌标语

**并行展开，干净收敛。**

> **Run agents in parallel. Fold the work back cleanly.**

## 一句话定位

**让 Codex 并行工作，不留下失控的 worktree。**

> **Run parallel Codex workflows without the worktree mess.**

Treefold 是一个本地优先、免费开源的 macOS 应用，用于在受管理的 Git worktree 中
运行 Codex 和 Shell Session，并完成创建、恢复、rebase、合并与清理。

## 目标用户与痛点

主要面向已经使用 Codex CLI 和 Git worktree 的开发者。他们可以快速启动多个 Agent，
但需要手动管理 branch、目录、终端、冲突和残留资源。

## 三个核心卖点

1. **安全并行**：每项工作拥有独立 workspace，多个 Session 不互相污染。
2. **持续工作**：Session 可以关闭或恢复，工作归属于 Workstream 而不是一次对话。
3. **干净收尾**：统一完成 diff、rebase、恢复、向上合并和 branch/worktree 回收。

核心观念：

> **Sessions are disposable. Work should be durable.**

## 差异化

- 不只是 Codex launcher：管理从开工到回收的完整生命周期。
- 不只是终端管理器：理解 Session 与 Git workspace 的归属关系。
- 不只是 worktree GUI：把 Agent 历史、Todo 与代码和 Git 资源一起结算。
- 不替代 Git：使用标准 branch、commit 和 worktree，不制造平台锁定。

## 推荐介绍文案

### GitHub Description

> A local-first macOS workspace for running Codex and Shell sessions in managed Git worktrees—with resume, rebase, recovery, merge, and cleanup.

### 中文简介

> Treefold 为每项 Agent 工作管理独立的 Git workspace、Codex 与 Shell Session，以及从创建、恢复、rebase、合并到清理的完整生命周期。

## 核心演示

演示应在 30～45 秒内完成以下流程：

1. 导入本地 Git 项目并创建 Workstream。
2. 自动创建 branch/worktree，启动 Codex 和 Shell。
3. 创建 Fork 完成独立子功能。
4. 查看变化并将 Fork rebase 到父级。
5. Close and settle，向上合并并清理 branch/worktree。
6. 从历史记录 Resume Codex Session。

## 宣传边界

优先讲 worktree 生命周期、并行隔离、恢复和收敛。UI、内置终端、History 面板和 Todo
都是支撑能力，不应成为第一卖点。不要宣传为完整 Git GUI，也不要声称代码绝不离开
本机；准确说法是 Treefold 的项目状态和编排数据保持本地。
