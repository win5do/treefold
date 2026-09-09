# 前后端通信方式

状态：架构决策，指导 Desktop、CLI、Skill 与未来 Remote 客户端的通信设计。

## 决策

Treefold 核心业务保持 **API-first**：React UI、CLI、Skill 和未来 Mobile/Web 客户端
通过同一套 HTTP API 与 WebSocket 访问 Workstation backend。Electron IPC 只用于文件选择、
窗口、菜单、通知等桌面原生能力，不承载 Workspace 等核心业务接口。

```text
Desktop React ─┐
CLI / Skill ───┼─ HTTP API / WebSocket ─→ Treefold Workstation
Mobile / Web ──┘                           ├── Workspace / Todo / Session
                                          ├── Git / Worktree
Desktop React ── preload / Electron IPC ───→ Electron main（桌面原生能力）
```

## 原因

- Project、Workspace、Todo 和 Session 是多客户端都需要的产品能力，不应绑定
  Electron renderer。
- HTTP/WebSocket 可直接复用于 CLI、Skill 和 Remote 客户端，也便于测试、调试和生成 SDK。
- Terminal 和实时状态天然适合 WebSocket，未来从本地连接切换到远程连接时不需要重写协议。
- Electron IPC 没有端口和 CORS 问题，但只能服务 App 内 renderer，不适合作为长期产品边界。
- 扩展时应从 backend 中抽离领域与应用服务，而不是重写 React 与 Electron 的通信方式。

## 能力边界

使用 HTTP API：

- Project、Workspace；
- Todo 和执行状态；
- Session、Git/worktree、Rebase 和 Delivery；
- Workstation 状态、能力发现和授权信息。

使用 WebSocket：

- Terminal 输入输出；
- 长操作进度和实时状态事件。

使用 Electron IPC：

- 文件或目录选择；
- 窗口、菜单、Dock 和系统通知；
- App bundle、系统权限等仅桌面端存在的能力；
- 必要时向 renderer 提供本地 API 地址和临时凭证。

## 本地与 Remote

Electron 主进程启动独立的 `treefold-backend`，通过 stdout 就绪消息和 HTTP health
检查获得随机本地 API 地址。业务请求保持直连 Rust，Electron IPC 仅暴露 API 地址、
目录选择和桌面日志。

同一 `TREEFOLD_HOME` 只允许一个 Rust backend，文件锁由操作系统释放。关闭窗口仅隐藏
窗口，API 继续运行；退出 App 时关闭父进程控制管道，Rust 清理 API 地址并按
`amux.keep_daemon_running_on_exit` 设置停止或保留 amux。API backend 本身不常驻。
Rust 与 Electron 分别记录轮转日志，保存在同一 home 的 `logs/` 下。

生产页面通过 `treefold://app/` 加载，使用上下文隔离和沙箱。开发时仍由 Vite 提供页面。
Electron、Rust backend、CLI 和 amux 随同一 App 发布，资源位于 App 的 Resources 目录。

未来的主要扩展形态是 **Treefold Remote**，而不是把执行迁移到 Cloud：

```text
Desktop / Mobile / Web ── API ─→ Workstation
                                   ├── code and Git
                                   ├── worktrees
                                   └── Codex and PTY
```

Workstation 始终拥有代码和执行环境。可选的 Relay 只负责设备发现、认证、连接中继和通知。
只有在要求 Desktop App 关闭后仍可远程控制 Workstation 时，才引入独立后台服务。

## API 要求

- 使用版本化路径和稳定 DTO；
- 提供结构化错误码与 request ID；
- 本地连接使用 capability token，Agent token 限制到所属 Session/Workspace；
- 只监听 loopback，限制可信 Origin，不使用任意 Origin CORS；
- 支持端口发现，客户端不依赖固定端口；
- 写操作具备幂等与冲突语义；
- 通过 OpenAPI 或共享 schema 生成客户端类型。

## 非目标

- 不把核心业务 API 迁移为 Electron IPC handlers；
- 不因为 CLI 或 Skill 引入 daemon；
- 不默认把 Workstation API 暴露到公网；
- 不假设未来 Cloud Server 持有代码或直接执行 Git。
