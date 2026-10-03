import type { Locale } from './config';

type Requirement = readonly [title: string, detail: string];

interface DownloadCopy {
  title: string;
  description: string;
  back: string;
  eyebrow: string;
  heading: readonly [string, string];
  intro: string;
  badges: readonly string[];
  noticeTitle: string;
  notice: string;
  option1: string;
  recommended: string;
  brewTitle: string;
  brewBody: string;
  terminal: string;
  copyCommand: string;
  copied: string;
  copyFailed: string;
  brewNote: string;
  tap: string;
  option2: string;
  dmgTitle: string;
  dmgBody: string;
  expected: string;
  releaseNote: string;
  openReleases: string;
  before: string;
  beforeTitle: string;
  beforeBody: string;
  requirements: readonly Requirement[];
  sourceKicker: string;
  sourceTitle: string;
  sourceBody: string;
  sourceLink: string;
}

export const downloadCopy = {
  'zh-cn': {
    title: '下载 Treefold for macOS',
    description: 'Treefold 面向 Apple Silicon Mac 的安装说明，提供 Homebrew Cask、GitHub Releases 和公开源码入口。',
    back: '返回首页',
    eyebrow: 'TREEFOLD FOR MACOS',
    heading: ['并行开发。', '清楚完成。'],
    intro: 'Treefold 面向 Apple Silicon Mac，源码已公开。首个 Release 发布后，可通过 Homebrew Cask 安装，或从 GitHub 下载 DMG。',
    badges: ['macOS Sonoma 或更新版本', 'Apple Silicon · arm64', 'AGPL-3.0-only'],
    noticeTitle: '安装包尚未发布',
    notice: '源码仓库和 Homebrew tap 均已公开，首个 Release 尚未发布。当前请按仓库 README 从源码运行；以下安装命令将在安装包发布后可用。',
    option1: 'OPTION 01 / HOMEBREW',
    recommended: '推荐',
    brewTitle: '用 Homebrew Cask 安装',
    brewBody: '安装包发布后，可用 Homebrew 管理 Treefold 的安装与更新。',
    terminal: 'TERMINAL',
    copyCommand: '复制命令',
    copied: '已复制',
    copyFailed: '复制失败 · 请手动选择',
    brewNote: '此命令需要已发布的 Release，当前尚不能完成安装。',
    tap: '查看 Homebrew tap',
    option2: 'OPTION 02 / GITHUB RELEASE',
    dmgTitle: '下载 DMG 安装包',
    dmgBody: '选择 Apple Silicon 的 aarch64.dmg，打开后将 Treefold 拖入“应用程序”。',
    expected: 'EXPECTED RELEASE ASSET',
    releaseNote: '当前 Release 页面仍为空，发布安装包后，这里会出现可下载版本。',
    openReleases: '打开 GitHub Releases',
    before: 'BEFORE YOU START',
    beforeTitle: '开始之前',
    beforeBody: 'Treefold 支持 Codex、Claude Code、Pi、OpenCode 等多种 AI Agent，在本机管理 Project、Workspace、Session 和 Git worktree。使用 Agent Session 前，请先安装并配置所选 Agent 的 CLI；Shell Session 可以独立使用。',
    requirements: [
      ['系统要求', 'Apple Silicon Mac、macOS Sonoma 或更新版本，以及 Git。'],
      ['首次打开', '当前构建使用 ad-hoc 签名，macOS 可能要求你在“隐私与安全性”中批准 Treefold。'],
      ['本地项目数据', 'Project 状态与编排数据保存在 Mac 上；Agent 的网络访问取决于你自己的配置。'],
    ],
    sourceKicker: 'PUBLIC SOURCE · AGPL-3.0-ONLY',
    sourceTitle: '免费开源。',
    sourceBody: '源码已公开，采用 AGPL-3.0-only 许可证。当前可按 README 的开发流程从源码运行。',
    sourceLink: '查看源码',
  },
  en: {
    title: 'Download Treefold for macOS',
    description: 'Installation information for Treefold on Apple Silicon Macs, with Homebrew Cask, GitHub Releases, and public source code.',
    back: 'Back to home',
    eyebrow: 'TREEFOLD FOR MACOS',
    heading: ['Build in parallel.', 'Finish with clarity.'],
    intro: 'Treefold targets Apple Silicon Macs, and its source is public. Once the first Release is available, install it with Homebrew Cask or download the DMG from GitHub.',
    badges: ['macOS Sonoma or newer', 'Apple Silicon · arm64', 'AGPL-3.0-only'],
    noticeTitle: 'App release not yet available',
    notice: 'The source repository and Homebrew tap are public. No Release has been published yet. Follow the repository README to run from source; the installation command below will work once an app release is available.',
    option1: 'OPTION 01 / HOMEBREW',
    recommended: 'RECOMMENDED',
    brewTitle: 'Install with Homebrew Cask',
    brewBody: 'Once the app is released, use Homebrew to manage Treefold installation and updates.',
    terminal: 'TERMINAL',
    copyCommand: 'Copy command',
    copied: 'Copied',
    copyFailed: 'Copy failed · select manually',
    brewNote: 'This command requires a published Release and cannot complete installation yet.',
    tap: 'View Homebrew tap',
    option2: 'OPTION 02 / GITHUB RELEASE',
    dmgTitle: 'Download the DMG',
    dmgBody: 'Choose the Apple Silicon aarch64.dmg asset, open it, and drag Treefold into Applications.',
    expected: 'EXPECTED RELEASE ASSET',
    releaseNote: 'The Release page is currently empty. Downloadable versions will appear here after publishing.',
    openReleases: 'Open GitHub Releases',
    before: 'BEFORE YOU START',
    beforeTitle: 'What you need',
    beforeBody: 'Treefold supports AI agents including Codex, Claude Code, Pi, and OpenCode, and manages Projects, Workspaces, Sessions, and Git worktrees on your Mac. Install and configure your chosen agent’s CLI before starting an Agent Session; Shell Sessions work independently.',
    requirements: [
      ['System requirements', 'Apple Silicon Mac, macOS Sonoma or newer, and Git.'],
      ['First launch', 'Current builds use ad-hoc signing. macOS may ask you to approve Treefold in Privacy & Security.'],
      ['Local project data', 'Project state and orchestration data remain on your Mac. Agent network access follows your own configuration.'],
    ],
    sourceKicker: 'PUBLIC SOURCE · AGPL-3.0-ONLY',
    sourceTitle: 'Free and open source.',
    sourceBody: 'The source is public under AGPL-3.0-only. Follow the README development instructions to run from source today.',
    sourceLink: 'View source',
  },
} satisfies Record<Locale, DownloadCopy>;
