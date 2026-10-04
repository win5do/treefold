import { test, expect, type Page } from "@playwright/test";
import { startUiHarness } from "./ui-harness.ts";
import { closeUiSession, createUiSession } from "./harness/session.ts";
import { FIXTURE_IDS } from "./fixtures/sidebar-core.ts";

test("Session labels restore saved terminal titles and keep custom names; Resume errors come from the backend", async () => {
  const harness = await startUiHarness();
  let page: Page | undefined;
  const id = FIXTURE_IDS.workspaceCodex;
  let title: string | undefined;
  let custom = false;
  let attempts = 0;
  try {
    page = await createUiSession({apiUrl:harness.apiUrl,sessionName:'session-titles'});
    await page.route('**/api/**', async route => {
      const request = route.request();
      const path = new URL(request.url()).pathname;
      if (path === `/api/sessions/${id}/restart` && request.method() === 'POST') {
        attempts++;
        return route.fulfill({status:409,json:{error:{code:'CODEX_SESSION_ID_PENDING',message:'No native callback'}}});
      }
      if (request.method() !== 'GET' || path === '/api/events') return route.continue();
      const response = await route.fetch();
      if (!response.headers()['content-type']?.includes('application/json')) return route.fulfill({response});
      const body = await response.json();
      const visit = (value: unknown): void => {
        if (Array.isArray(value)) return value.forEach(visit);
        if (!value || typeof value !== 'object') return;
        const record = value as Record<string,unknown>;
        if (record.id === id && 'kind' in record) Object.assign(record,{name:'Codex',name_is_custom:custom,terminal_title:title,status:'stopped',agent_session_id:null});
        Object.values(record).forEach(visit);
      };
      visit(body);
      return route.fulfill({response,json:body});
    });
    const home = `${harness.baseUrl}/#/workspaces/${FIXTURE_IDS.workspace}`;
    await page.goto(home);
    const row = page.getByTestId(`workspace-session-${id}`);
    await expect(row).toContainText(`Codex · ${id.slice(-8)}`);
    title = 'Restore the login flow';
    await page.reload();
    await expect(row).toContainText(title);
    await expect(page.getByTestId(`sidebar-session-${id}`)).toContainText(title);
    await row.getByRole('button',{name:'Open',exact:true}).click();
    const resume = page.getByRole('button',{name:'Resume',exact:true});
    await expect(resume).toBeEnabled();
    await resume.click();
    await expect.poll(()=>attempts).toBe(1);
    await expect(page.getByText(/Hook or extension has not reported a Session ID/)).toBeVisible();
    custom = true;
    await page.goto(home);
    await page.reload();
    await expect(page.getByTestId(`sidebar-session-${id}`).getByRole('button').first()).toHaveAttribute('title','Codex');
    harness.assertNoUnexpectedRequests();
  } finally {
    try { await closeUiSession(page); } finally { await harness.close(); }
  }
});
