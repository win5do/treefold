import { mkdirSync, writeFileSync } from 'node:fs';

// One source for the site and README diagrams. Run with Node type stripping.
const output = new URL('../public/diagrams/', import.meta.url);
mkdirSync(output, { recursive: true });
const translations = {
  'zh-cn': {
    title: 'Treefold 产品架构', subtitle: '并行展开，干净收敛。',
    project: '组织相关仓库与参考目录', repos: '前端仓库 · 后端仓库 · 只读 Context',
    workspace: '承载一项 feature', own: '各仓库的独立分支与 worktree',
    fork: '从 Todo 展开并行子任务', a: '认证逻辑', b: 'API 测试',
    isolated: '独立分支与 worktree', sessions: 'Agent / Shell Session · 执行与接续',
    shared: '同一 Workspace / Fork 内的 Session 共享 checkout',
    returns: '检查后合回父 Workspace',
    tools: ['Todo · 跟进任务', 'Diff / History · 检查改动', 'amux · 托管进程'],
    delivery: '检查与交付', flow: '同步 / 冲突处理 → 本地合并或推送分支 → 完成后归档',
    durable: '代码、Todo 与交付记录归属于工作；更换 Session 后仍然保留。',
    boundary: '本地优先 · 远端评审与 CI 在 Git 托管平台完成 · 归档保留 worktree，删除时显式清理',
  },
  en: {
    title: 'Treefold product architecture', subtitle: 'Run agents in parallel. Fold the work back cleanly.',
    project: 'Organize repositories and reference directories', repos: 'Frontend repo · Backend repo · Read-only Context',
    workspace: 'Own a feature', own: 'Dedicated branch and worktree per repository',
    fork: 'Split Todos into parallel subtasks', a: 'Auth logic', b: 'API tests',
    isolated: 'Own branch and worktree', sessions: 'Agent / Shell Sessions · Execute and resume',
    shared: 'Sessions within the same Workspace / Fork share a checkout',
    returns: 'Review, then merge into the parent Workspace',
    tools: ['Todo · Track tasks', 'Diff / History · Review changes', 'amux · Manage processes'],
    delivery: 'Review and deliver', flow: 'Sync / resolve conflicts → Merge locally or push branch → Archive when finished',
    durable: 'Code, Todos, and delivery records belong to the work and survive Session changes.',
    boundary: 'Local-first · Remote review and CI stay on your Git host · Archive keeps worktrees; deletion handles cleanup',
  },
};
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;');
for (const [locale, c] of Object.entries(translations)) {
  for (const mobile of [false, true]) {
    const w = mobile ? 440 : 1120;
    const h = mobile ? 1230 : 790;
    const parts: string[] = [];
    const rect = (x: number, y: number, width: number, height: number, fill = '#15171e', stroke = '#343747') => parts.push(`<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="14" fill="${fill}" stroke="${stroke}"/>`);
    const text = (x: number, y: number, value: string, size = 16, color = '#acafbf', weight = 400) => parts.push(`<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}">${escape(value)}</text>`);
    const line = (x: number, y: number, x2: number, y2: number) => parts.push(`<path d="M${x} ${y} L${x2} ${y2}" fill="none" stroke="#a5a6ff" stroke-width="2" marker-end="url(#arrow)"/>`);
    rect(0.5, 0.5, w - 1, h - 1, '#0d0e12');
    text(28, 44, c.title, mobile ? 24 : 28, '#f4f4f5', 650);
    text(28, 74, c.subtitle, mobile ? 13 : 16);
    rect(24, 98, w - 48, mobile ? 112 : 94);
    text(44, 128, 'Project', 19, '#b9baff', 650);
    text(mobile ? 44 : 152, mobile ? 158 : 128, c.project, mobile ? 13 : 16, '#f4f4f5');
    text(44, mobile ? 188 : 163, c.repos, mobile ? 12 : 15);
    line(w / 2, mobile ? 210 : 192, w / 2, mobile ? 230 : 214);
    const wy = mobile ? 236 : 220;
    rect(24, wy, w - 48, mobile ? 720 : 344, '#141420', '#6263a0');
    text(44, wy + 32, 'Workspace', 20, '#c0c1ff', 650);
    text(mobile ? 44 : 198, mobile ? wy + 58 : wy + 32, c.workspace, 15, '#f4f4f5');
    text(44, wy + (mobile ? 84 : 61), c.own, mobile ? 13 : 15);
    text(44, wy + (mobile ? 113 : 89), c.sessions, mobile ? 13 : 15);
    text(44, wy + (mobile ? 151 : 122), c.fork, mobile ? 14 : 15, '#c0c1ff');
    const cardWidth = mobile ? w - 88 : (w - 116) / 2;
    for (let i = 0; i < 2; i++) {
      const x = mobile ? 44 : 44 + i * (cardWidth + 28);
      const y = wy + (mobile ? 170 + i * 173 : 141);
      rect(x, y, cardWidth, 148, '#1b1c2b', '#4b4c6f');
      text(x + 18, y + 30, `Fork / ${i === 0 ? 'validation' : 'api-tests'}`, 17, '#f4f4f5', 600);
      text(x + 18, y + 57, i === 0 ? c.a : c.b, 14);
      text(x + 18, y + 85, c.isolated, 13, '#b9baff');
      text(x + 18, y + 121, i === 0 ? 'Session · Codex + Shell' : 'Session · Claude Code + Shell', 13, '#e0e1ea');
    }
    text(44, wy + (mobile ? 526 : 318), `↑ ${c.returns}`, mobile ? 12 : 14, '#8edbb7');
    if (!mobile) text(570, wy + 318, c.shared, 12);
    if (mobile) {
      text(44, wy + 562, locale === 'en' ? 'Sessions share a checkout within' : c.shared, locale === 'en' ? 13 : 12);
      if (locale === 'en') text(44, wy + 582, 'the same Workspace / Fork.', 13);
      c.tools.forEach((label, i) => text(44, wy + 621 + i * 30, label, 14, '#e0e1ea'));
    } else {
      c.tools.forEach((label, i) => { rect(24 + i * 364, 582, 344, 48); text(42 + i * 364, 612, label, 15, '#e0e1ea'); });
    }
    const dy = mobile ? 980 : 650;
    line(w / 2, mobile ? 956 : 630, w / 2, dy - 7);
    rect(24, dy, w - 48, mobile ? 140 : 68, '#10221f', '#326555');
    text(44, dy + 29, c.delivery, 17, '#8edbb7', 600);
    if (mobile) {
      const lines = locale === 'en' ? ['Sync / resolve conflicts', 'Merge locally or push branch', 'Archive when finished'] : ['同步与冲突处理', '本地合并或推送分支', '完成后归档，保留工作记录与 worktree'];
      lines.forEach((s, i) => text(44, dy + 57 + i * 27, `${i + 1}. ${s}`, 13));
      text(28, 1154, locale === 'en' ? 'Work persists across Session changes.' : '更换 Session，代码、Todo 与交付记录仍然保留。', 13, '#e0e1ea');
      text(28, 1181, locale === 'en' ? 'Local-first. Remote review and CI stay on your Git host.' : '本地优先；远端评审与 CI 在 Git 托管平台完成。', 11);
      text(28, 1204, locale === 'en' ? 'Worktree cleanup is an explicit deletion choice.' : '清理 worktree 与分支需在删除时显式选择。', 11);
    } else {
      text(44, dy + 52, c.flow, 14);
      text(28, 747, c.durable, 15, '#e0e1ea');
      text(28, 773, c.boundary, 12);
    }
    const desc = [c.project, c.workspace, c.fork, c.isolated, c.shared, c.returns, c.durable, c.boundary].join('. ');
    writeFileSync(new URL(`product-architecture-${locale}${mobile ? '-mobile' : ''}.svg`, output), `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="title description"><title id="title">${escape(c.title)}</title><desc id="description">${escape(desc)}</desc><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="none" stroke="#a5a6ff"/></marker></defs><g font-family="Inter, -apple-system, BlinkMacSystemFont, Segoe UI, PingFang SC, Microsoft YaHei, sans-serif">${parts.join('\n')}</g></svg>\n`);
  }
}
