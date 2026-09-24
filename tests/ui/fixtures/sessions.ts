import type { FixtureSession, SidebarFixture } from "./types.ts";

export function fixtureSessions(fixture: SidebarFixture): FixtureSession[] {
  return [...Object.values(fixture.projectDetails), ...Object.values(fixture.workspaceDetails)]
    .flatMap(detail => detail.sessions);
}

export function withSession(id: string, overrides: Partial<FixtureSession>) {
  return (fixture: SidebarFixture) => {
    const sessions = fixtureSessions(fixture).filter(session => session.id === id);
    if (sessions.length === 0) throw new Error(`Unknown fixture Session: ${id}`);
    for (const session of sessions) Object.assign(session, overrides);
  };
}
