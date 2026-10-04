import type { Locale } from './config';
import { currentRelease } from '../config/site';

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
    intro: 'Treefold 现已开放下载。通过 Homebrew Cask 安装，或直接下载 Apple Silicon Mac 的 DMG 安装包。',
    badges: ['macOS Sonoma 或更新版本', 'Apple Silicon · arm64', 'AGPL-3.0-only'],
    noticeTitle: `${currentRelease.version} 已发布`,
    notice: '当前为公开 Alpha 版本。安装包使用 ad-hoc 签名，尚未经过 Apple 公证；首次打开时可能需要在“系统设置 → 隐私与安全性”中选择“仍要打开”。',
    option1: 'OPTION 01 / HOMEBREW',
    recommended: '推荐',
    brewTitle: '用 Homebrew Cask 安装',
    brewBody: '用 Homebrew 管理 Treefold 的安装与更新。',
    terminal: 'TERMINAL',
    copyCommand: '复制命令',
    copied: '已复制',
    copyFailed: '复制失败 · 请手动选择',
    brewNote: '已安装 Homebrew 后直接运行；后续可用 brew upgrade --cask treefold 更新。',
    tap: '查看 Homebrew tap',
    option2: 'OPTION 02 / GITHUB RELEASE',
    dmgTitle: '下载 DMG 安装包',
    dmgBody: '下载 Apple Silicon 的 arm64.dmg，打开后将 Treefold 拖入“应用程序”。',
    expected: 'APPLE SILICON · DMG',
    releaseNote: 'Release 页面同时提供 ZIP 压缩包、SHA-256 校验文件和版本说明。',
    openReleases: '查看 Release 说明与其他下载',
    before: 'BEFORE YOU START',
    beforeTitle: '开始之前',
    beforeBody: 'Treefold 支持 Codex、Claude Code、Pi、OpenCode 等多种 AI Agent，在本机管理 Project、Workspace、Session 和 Git worktree。使用 Agent Session 前，请先安装并配置所选 Agent 的 CLI；Shell Session 可以独立使用。',
    requirements: [
      ['系统要求', 'Apple Silicon Mac、macOS Sonoma 或更新版本，以及 Git。'],
      ['首次打开', '尝试打开 Treefold 后，如被 macOS 阻止，请在“系统设置 → 隐私与安全性”中选择“仍要打开”，然后按提示确认。'],
      ['本地项目数据', 'Project 状态与编排数据保存在 Mac 上；Agent 的网络访问取决于你自己的配置。'],
    ],
    sourceKicker: 'PUBLIC SOURCE · AGPL-3.0-ONLY',
    sourceTitle: '免费开源。',
    sourceBody: '源码已公开，采用 AGPL-3.0-only 许可证。也可按 README 的开发流程从源码运行。',
    sourceLink: '查看源码',
  },
  en: {
    title: 'Download Treefold for macOS',
    description: 'Installation information for Treefold on Apple Silicon Macs, with Homebrew Cask, GitHub Releases, and public source code.',
    back: 'Back to home',
    eyebrow: 'TREEFOLD FOR MACOS',
    heading: ['Build in parallel.', 'Finish with clarity.'],
    intro: 'Treefold is available to download. Install it with Homebrew Cask or download the DMG for your Apple Silicon Mac.',
    badges: ['macOS Sonoma or newer', 'Apple Silicon · arm64', 'AGPL-3.0-only'],
    noticeTitle: `${currentRelease.version} is available`,
    notice: 'This is a public alpha release. The app is ad-hoc signed and has not been notarized by Apple. On first launch, you may need to choose Open Anyway in System Settings → Privacy & Security.',
    option1: 'OPTION 01 / HOMEBREW',
    recommended: 'RECOMMENDED',
    brewTitle: 'Install with Homebrew Cask',
    brewBody: 'Use Homebrew to manage Treefold installation and updates.',
    terminal: 'TERMINAL',
    copyCommand: 'Copy command',
    copied: 'Copied',
    copyFailed: 'Copy failed · select manually',
    brewNote: 'Run this command after installing Homebrew. Use brew upgrade --cask treefold for future updates.',
    tap: 'View Homebrew tap',
    option2: 'OPTION 02 / GITHUB RELEASE',
    dmgTitle: 'Download the DMG',
    dmgBody: 'Download the Apple Silicon arm64.dmg, open it, and drag Treefold into Applications.',
    expected: 'APPLE SILICON · DMG',
    releaseNote: 'The Release page also includes a ZIP archive, SHA-256 checksums, and release notes.',
    openReleases: 'Release notes and other downloads',
    before: 'BEFORE YOU START',
    beforeTitle: 'What you need',
    beforeBody: 'Treefold supports AI agents including Codex, Claude Code, Pi, and OpenCode, and manages Projects, Workspaces, Sessions, and Git worktrees on your Mac. Install and configure your chosen agent’s CLI before starting an Agent Session; Shell Sessions work independently.',
    requirements: [
      ['System requirements', 'Apple Silicon Mac, macOS Sonoma or newer, and Git.'],
      ['First launch', 'If macOS blocks Treefold after you try to open it, choose Open Anyway in System Settings → Privacy & Security, then confirm when prompted.'],
      ['Local project data', 'Project state and orchestration data remain on your Mac. Agent network access follows your own configuration.'],
    ],
    sourceKicker: 'PUBLIC SOURCE · AGPL-3.0-ONLY',
    sourceTitle: 'Free and open source.',
    sourceBody: 'The source is public under AGPL-3.0-only. You can also follow the README development instructions to run from source.',
    sourceLink: 'View source',
  },
} satisfies Record<Locale, DownloadCopy>;
