# Treefold for macOS

**简体中文** | [English](README.en.md)

**并行展开，干净收敛。**

Treefold 是一个本地优先的 macOS 应用，让你在独立的 Git worktree 中并行运行 Codex 和 Shell Session，集中查看改动、恢复工作，并完成合并与清理。

适合已经使用 Codex CLI、希望同时推进多项开发任务的开发者：每项 feature 有自己的 Workspace，子任务可以拆成 Fork，代码、Session 和 Todo 始终归属于对应的工作。

[安装与运行](#安装与运行) · [使用流程](#使用流程) · [GitHub Releases](https://github.com/win5do/treefold/releases) · [产品文档](#产品文档)

## 为什么使用 Treefold

- **隔离开发**：为不同 Workspace 和 Fork 管理独立的分支与 worktree，减少并行任务之间的代码干扰。
- **接着上次的工作继续**：集中管理 Codex 和 Shell Session，切换页面不会中断运行中的进程；Codex 历史支持恢复。
- **完成后有序收尾**：查看改动、同步分支、处理 rebase 与冲突，再按交付方式合并或推送，并清理完成的工作。

还可以在同一个 Project 中组织多个仓库和上下文目录，通过 Todo、CLI 与 Skill 向 Agent 提供当前工作的信息。

## 安装与运行

### 使用要求

- Apple Silicon Mac，macOS Sonoma 14 或更新版本，以及 Git。
- 使用 Codex Session 前，需要安装并配置 Codex CLI；Shell Session 可以独立使用。

### 安装包

首个公开 Alpha 版本 **0.1.0-alpha.1** 已发布。通过 [Homebrew tap](https://github.com/win5do/homebrew-tap) 安装：

```bash
brew install --cask win5do/tap/treefold
```

也可直接下载 [Apple Silicon DMG](https://github.com/win5do/treefold/releases/download/v0.1.0-alpha.1/Treefold-0.1.0-alpha.1-arm64.dmg)，打开后将 Treefold 拖入“应用程序”。[Release 页面](https://github.com/win5do/treefold/releases/tag/v0.1.0-alpha.1) 同时提供 ZIP、SHA-256 校验文件和版本说明。

当前 Alpha 使用 ad-hoc 签名，尚未经过 Apple 公证。首次打开如果被 macOS 阻止，请在“系统设置 → 隐私与安全性”中选择“仍要打开”，然后按提示确认。后续可运行 `brew upgrade --cask treefold` 更新。

### 从源码运行

准备 stable Rust、Node.js 24.12 或更新版本、Git 和 `just`。默认构建使用 Cargo.lock 锁定的 GitHub main 分支 amux 源码；本地联调可用 `TREEFOLD_AMUX_MANIFEST` 统一指定 runtime、CLI 和 Skill 的源码，详见 [开发环境说明](AGENTS.md#development-environment-and-commands)。

在仓库根目录运行：

```bash
npm install
just app-dev
```

开发数据默认存放在仓库的 `.treefold-dev/`，与日常使用的 `~/.treefold` 分开。

## 使用流程

以开发一项需要前后端配合的 feature 为例：

1. **创建 Project**：添加本地 Git 仓库，以及需要提供给 Agent 的上下文目录。
2. **创建 Workspace**：为这项 feature 创建独立的分支和 worktree，保留原有工作现场。
3. **启动 Session**：运行 Codex 编写代码，使用 Shell 启动服务、执行测试或检查结果。
4. **按需创建 Fork**：将可以并行完成的子任务拆出去，例如接口实现和页面开发，各自在独立的 worktree 中推进。
5. **检查并交付**：检查改动，将 Fork 的成果合回父 Workspace。Workspace 可按仓库配置在本地合并，或推送分支供远端评审与 CI 使用。
6. **完成与清理**：使用完成流程处理分支和 worktree 的清理，保留可供回顾的工作记录。

远端代码评审和 PR 合并仍在你的 Git 托管平台完成。

## 核心概念

| 概念 | 用途 |
| --- | --- |
| **Project** | 组织相关仓库、目录和上下文。 |
| **Workspace** | 承担一项独立的 feature，拥有自己的 worktree、分支、Session 和 Todo。 |
| **Fork** | 承担 Workspace 下的并行子任务，成果合回父 Workspace；不支持嵌套 Fork。 |
| **Session** | 在对应目录中运行 Codex 或 Shell；一个 Workspace 或 Fork 可以拥有多个 Session。 |

## CLI 与 Agent 协作

桌面 App 附带 `treefold` CLI 和 Treefold Skill。受管理的 Session 会获得当前 Project、Workspace、仓库和 Todo 的上下文；Agent 可以查看任务，领取、更新并完成 Todo。

```bash
treefold open /path/to/project
treefold current --json
treefold todo list --json
treefold doctor
```

持久进程与终端由配套的 `amux` 管理。Treefold 创建 CLI 与 Skill 链接时，会保留已有的用户自管路径。

## 本地数据与偏好设置

Treefold 的 Project 状态、Session 元数据、Todo 和配置保存在本机，核心管理流程无需托管控制服务。Codex 等 Agent 的网络访问取决于其服务和你的配置。

在 Settings 中可以调整偏好和快捷键。配置位于 `$TREEFOLD_HOME`（默认 `~/.treefold`）：

- `config/settings.toml`：语言、主题与 Agent 默认设置。
- `config/keymap.toml`：快捷键覆盖；省略的绑定使用默认值，`false` 表示禁用。

详见 [配置与快捷键](docs/keymap-configuration.md)。

## 开发与构建

```bash
just                  # 列出可用任务
just app-dev-watch    # 同时监听 Electron 与 Rust 变更
just build            # 在 release/ 生成 macOS App、DMG 与 ZIP
```

[开发指南](AGENTS.md#development-environment-and-commands) 包含环境配置、amux 路径、验证命令和本地安装说明。UI 测试默认在隐藏的 Electron 窗口中运行。

## 产品文档

- [Project、Workspace 与 Fork 模型](docs/project-workspace-model.md)
- [Git worktree 生命周期](docs/git-worktree-lifecycle.md)
- [Agent Skill、CLI 与 App API](docs/agent-skill-cli-api-architecture.md)
- [前后端通信](docs/frontend-backend-communication.md)

## 许可证

Treefold 使用 [GNU Affero General Public License v3.0 only](LICENSE)（AGPL-3.0-only）。
