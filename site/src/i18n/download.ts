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
  macTitle: string;
  brewBody: string;
  terminal: string;
  copyCommand: string;
  copied: string;
  copyFailed: string;
  brewNote: string;
  option2: string;
  dmgTitle: string;
  zipTitle: string;
  dmgBody: string;
  expected: string;
  releaseNote: string;
  openReleases: string;
  linuxTitle: string;
  linuxStatus: string;
  linuxBody: string;
  linuxFormatsTitle: string;
  linuxFeatures: string;
  appImageTitle: string;
  debTitle: string;
  rpmTitle: string;
  linuxNote: string;
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
    title: '获取 Treefold · macOS 与 Linux',
    description: '下载 Treefold for macOS 与 Linux。macOS 提供 Homebrew Cask、DMG 和 ZIP；Linux 提供 AppImage、deb 和 rpm。',
    back: '返回首页',
    eyebrow: 'TREEFOLD FOR MACOS & LINUX',
    heading: ['并行开发。', '清楚完成。'],
    intro: 'macOS 可通过 Homebrew Cask 或 DMG 安装。Linux 提供 AppImage、deb 和 rpm，按你的系统选择安装包。',
    badges: ['macOS · Apple Silicon', 'Linux · x86_64', 'AGPL-3.0-only'],
    noticeTitle: `macOS ${currentRelease.version} 已发布`,
    notice: 'Mac 安装包使用 ad-hoc 签名，尚未经过 Apple 公证；首次打开时可能需要在“系统设置 → 隐私与安全性”中选择“仍要打开”。',
    option1: 'MACOS / HOMEBREW & DMG',
    recommended: '已发布',
    macTitle: 'macOS · Apple Silicon',
    brewBody: '使用 Homebrew Cask 管理 Treefold 的安装与更新。',
    terminal: 'TERMINAL',
    copyCommand: '复制命令',
    copied: '已复制',
    copyFailed: '复制失败 · 请手动选择',
    brewNote: '已安装 Homebrew 后直接运行；后续可用 brew upgrade --cask treefold 更新。',
    option2: 'LINUX / APPIMAGE · DEB · RPM',
    dmgTitle: '下载 DMG 安装包',
    zipTitle: '下载 ZIP 压缩包',
    dmgBody: '下载 Apple Silicon 的 arm64.dmg，打开后将 Treefold 拖入“应用程序”。',
    expected: 'APPLE SILICON · DMG',
    releaseNote: 'Release 页面同时提供 ZIP 压缩包、SHA-256 校验文件和版本说明。',
    openReleases: '查看 Release 说明与其他下载',
    linuxTitle: 'Linux · x86_64',
    linuxStatus: '已发布',
    linuxBody: 'AppImage 添加执行权限后即可打开；deb 用于兼容的 Debian/Ubuntu 系统，rpm 用于兼容的 Fedora 系统。',
    linuxFormatsTitle: '安装包格式',
    linuxFeatures: '沿用相同的 Workspace、Session 和 Git 工作流，并提供 Linux 桌面菜单、快捷键和系统应用打开功能。',
    appImageTitle: '下载 AppImage',
    debTitle: '下载 deb 安装包',
    rpmTitle: '下载 rpm 安装包',
    linuxNote: 'Linux 安装包面向 x86_64 桌面。具体系统依赖、兼容范围和 SHA-256 校验文件见版本说明。',
    before: 'BEFORE YOU START',
    beforeTitle: '开始之前',
    beforeBody: 'Treefold 支持 Codex、Claude Code、Pi、OpenCode 等多种 AI Agent，在本机管理 Project、Workspace、Session 和 Git worktree。使用 Agent Session 前，请先安装并配置所选 Agent 的 CLI；Shell Session 可以独立使用。',
    requirements: [
      ['macOS', 'Apple Silicon Mac、macOS Sonoma 或更新版本，以及 Git。首次打开若被系统阻止，可在“隐私与安全性”中选择“仍要打开”。'],
      ['Linux', '需要 Git、x86_64 处理器和图形桌面环境。请选择匹配发行版的安装包，具体依赖与兼容范围见版本说明。'],
      ['本地项目数据', 'Project 状态与编排数据保存在本机；Agent 的网络访问取决于你自己的配置。'],
    ],
    sourceKicker: 'PUBLIC SOURCE · AGPL-3.0-ONLY',
    sourceTitle: '免费开源。',
    sourceBody: '源码已公开，采用 AGPL-3.0-only 许可证。也可按 README 的开发流程从源码运行。',
    sourceLink: '查看源码',
  },
  en: {
    title: 'Get Treefold · macOS and Linux',
    description: 'Download Treefold for macOS and Linux. Install on macOS with Homebrew Cask, DMG, or ZIP; choose AppImage, deb, or rpm for Linux.',
    back: 'Back to home',
    eyebrow: 'TREEFOLD FOR MACOS & LINUX',
    heading: ['Build in parallel.', 'Finish with clarity.'],
    intro: 'Install on macOS with Homebrew Cask or a DMG. Linux offers AppImage, deb, and rpm packages; choose the format for your system.',
    badges: ['macOS · Apple Silicon', 'Linux · x86_64', 'AGPL-3.0-only'],
    noticeTitle: `macOS ${currentRelease.version} is available`,
    notice: 'The Mac app is ad-hoc signed and has not been notarized by Apple. On first launch, you may need to choose Open Anyway in System Settings → Privacy & Security.',
    option1: 'MACOS / HOMEBREW & DMG',
    recommended: 'AVAILABLE',
    macTitle: 'macOS · Apple Silicon',
    brewBody: 'Use Homebrew Cask to manage Treefold installation and updates.',
    terminal: 'TERMINAL',
    copyCommand: 'Copy command',
    copied: 'Copied',
    copyFailed: 'Copy failed · select manually',
    brewNote: 'Run this command after installing Homebrew. Use brew upgrade --cask treefold for future updates.',
    option2: 'LINUX / APPIMAGE · DEB · RPM',
    dmgTitle: 'Download the DMG',
    zipTitle: 'Download the ZIP',
    dmgBody: 'Download the Apple Silicon arm64.dmg, open it, and drag Treefold into Applications.',
    expected: 'APPLE SILICON · DMG',
    releaseNote: 'The Release page also includes a ZIP archive, SHA-256 checksums, and release notes.',
    openReleases: 'Release notes and other downloads',
    linuxTitle: 'Linux · x86_64',
    linuxStatus: 'AVAILABLE',
    linuxBody: 'Make the AppImage executable, then open it. Use deb on compatible Debian/Ubuntu systems or rpm on compatible Fedora systems.',
    linuxFormatsTitle: 'PACKAGE FORMATS',
    linuxFeatures: 'Use the same Workspace, Session, and Git workflows, with Linux desktop menus, shortcuts, and actions to open your work in system applications.',
    appImageTitle: 'Download the AppImage',
    debTitle: 'Download the deb',
    rpmTitle: 'Download the rpm',
    linuxNote: 'Linux packages target x86_64 desktops. See the release notes for system dependencies, compatibility, and SHA-256 checksums.',
    before: 'BEFORE YOU START',
    beforeTitle: 'What you need',
    beforeBody: 'Treefold supports AI agents including Codex, Claude Code, Pi, and OpenCode, and manages Projects, Workspaces, Sessions, and Git worktrees on your computer. Install and configure your chosen agent’s CLI before starting an Agent Session; Shell Sessions work independently.',
    requirements: [
      ['macOS', 'Apple Silicon Mac, macOS Sonoma or newer, and Git. If the first launch is blocked, choose Open Anyway in Privacy & Security.'],
      ['Linux', 'Git, an x86_64 processor, and a graphical desktop are required. Choose a package for your distribution; see the release notes for dependencies and compatibility.'],
      ['Local project data', 'Project state and orchestration data remain on your computer. Agent network access follows your own configuration.'],
    ],
    sourceKicker: 'PUBLIC SOURCE · AGPL-3.0-ONLY',
    sourceTitle: 'Free and open source.',
    sourceBody: 'The source is public under AGPL-3.0-only. You can also follow the README development instructions to run from source.',
    sourceLink: 'View source',
  },
} satisfies Record<Locale, DownloadCopy>;
