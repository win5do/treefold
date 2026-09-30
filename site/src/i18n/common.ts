import type { Locale } from './config';

interface CommonCopy {
  header: {
    homeLabel: string;
    model: string;
    git: string;
    workflow: string;
    agents: string;
    download: string;
    menuLabel: string;
    source: string;
    languageLabel: string;
    switchLanguageLabel: string;
    primaryNavigationLabel: string;
    mobileNavigationLabel: string;
  };
  footer: {
    tagline: string;
    licenseSummary: string;
    navigationLabel: string;
    home: string;
    download: string;
    license: string;
  };
}

export const commonCopy = {
  'zh-cn': {
    header: {
      homeLabel: 'Treefold 首页',
      model: '产品模型',
      git: 'Git 可视化',
      workflow: '工作方式',
      agents: '进程托管',
      download: '下载',
      menuLabel: '打开导航菜单',
      source: '源码',
      languageLabel: 'EN',
      switchLanguageLabel: 'Switch to English',
      primaryNavigationLabel: '主导航',
      mobileNavigationLabel: '移动端导航',
    },
    footer: {
      tagline: '并行展开，干净收敛。',
      licenseSummary: '免费开源 · AGPL-3.0-only',
      navigationLabel: '页脚导航',
      home: '首页',
      download: '下载',
      license: '许可证',
    },
  },
  en: {
    header: {
      homeLabel: 'Treefold home',
      model: 'Model',
      git: 'Git visibility',
      workflow: 'Workflow',
      agents: 'Processes',
      download: 'Download',
      menuLabel: 'Open navigation',
      source: 'Source',
      languageLabel: '中文',
      switchLanguageLabel: '切换到中文',
      primaryNavigationLabel: 'Primary navigation',
      mobileNavigationLabel: 'Mobile navigation',
    },
    footer: {
      tagline: 'Run agents in parallel. Fold the work back cleanly.',
      licenseSummary: 'Free and open source · AGPL-3.0-only',
      navigationLabel: 'Footer navigation',
      home: 'Home',
      download: 'Download',
      license: 'License',
    },
  },
} satisfies Record<Locale, CommonCopy>;
