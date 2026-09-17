# Treefold 术语表

本文件是中英文界面术语的唯一维护入口。翻译原则和执行流程见 [AGENTS.md](./AGENTS.md)。

## 保留英文的术语

以下词在中文界面中也保留原样，不附加中文括注。

| 术语 | 中文界面写法 | 使用规则 |
| --- | --- | --- |
| Treefold | Treefold | 产品名称，保留大小写 |
| Codex | Codex | 产品名称，保留大小写 |
| Git | Git | 工具名称，保留大小写 |
| amux | amux | 工具名称，保持小写 |
| Workspace | Workspace | Treefold 核心概念，不译为工作区或工作流 |
| Fork | Fork | Treefold 核心概念，不译为分叉或分支 |
| Project | Project | Treefold 核心概念，不译为项目 |
| Session | Session | Treefold 核心概念，不译为会话 |
| Agent | Agent | 智能体概念，保留英文 |
| Skill | Skill | 技能概念，保留英文 |

## 使用边界

- 按概念判断，不做全文机械替换。例如 Git branch 可以译为“分支”，不能因为 Fork 保留英文就把分支改成 Fork。
- 上述限制针对对应产品实体或技术概念；普通描述中的同形词按语境处理。
- 中文句子中的概念词用单数形式，如“3 个 Session”“管理 Skill”；英文界面按语法使用 Projects、Sessions、Skills 等复数。
- 中文与英文或数字之间留一个空格，如“新建 Project”“共 3 个 Session”。标点旁不额外加空格。
- 用户输入、文件路径、命令、参数、配置键、API 标识符保持原值；如命令中的 `git` 不改成 `Git`。

## 新术语与固定译法

新增产品名遵循其官方拼写。新增核心概念时，先在这里记录选定写法、含义和使用边界，再更新语言包；存在歧义时确认具体概念，不从旧文案推断全局规则。

目前没有额外约定的固定中文术语。以后需要固定译法时，在本文件新增条目；普通操作词的文风和示例维护在 AGENTS.md 中。
