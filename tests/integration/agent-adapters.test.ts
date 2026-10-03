import { test, expect } from "@playwright/test";
import { mkdtemp, copyFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

test("OpenCode captures its conversation and allows native switching without replacing its Resume association", async () => {
  const root = await mkdtemp("/tmp/treefold-opencode-plugin-");
  const previous = process.env.TREEFOLD_OPENCODE_SESSION_ID;
  delete process.env.TREEFOLD_OPENCODE_SESSION_ID;
  try {
    const plugin = path.join(root, "plugin.mjs");
    await copyFile(path.resolve("src/backend/src/agents/opencode/plugin.mjs"), plugin);
    const { Treefold } = await import(pathToFileURL(plugin).href);
    const client = { session: { get: async ({ path: { id } }: {path: {id: string}}) => ({ data: {
      id, title: "First title", ...(id === "ses_child" ? { parentID: "ses_root" } : {}),
    } }) } };
    const hooks = await Treefold({ client });
    const event = (type: string, id: string, title: string, parentID?: string) => hooks.event({ event: { type, properties: { info: { id, title, parentID } } } });
    await event("session.updated", "ses_unrelated", "Rename unrelated history");
    await event("session.created", "ses_other", "Unrelated creation");
    await hooks["chat.message"]({ sessionID: "ses_child" });
    await expect(readFile(path.join(root, "metadata.json"), "utf8")).rejects.toThrow();
    await hooks["chat.message"]({ sessionID: "ses_root" });
    await event("session.updated", "ses_other", "Other root");
    expect(JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8"))).toEqual({ id: "ses_root", title: "First title" });
    await expect(hooks["chat.message"]({ sessionID: "ses_other" })).resolves.toBeUndefined();
    expect(JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8"))).toEqual({ id: "ses_root", title: "First title" });
    const resumed = await Treefold({ client });
    await resumed.event({ event: { type: "session.updated", properties: { info: { id: "ses_root", title: "Updated title" } } } });
    expect(JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8"))).toEqual({ id: "ses_root", title: "Updated title" });
    // Persisted native identity remains authoritative even if the sidecar metadata is lost.
    await rm(path.join(root, "metadata.json"));
    process.env.TREEFOLD_OPENCODE_SESSION_ID = "ses_root";
    const recovered = await Treefold({ client });
    await expect(recovered["chat.message"]({ sessionID: "ses_other" })).resolves.toBeUndefined();
    await recovered["chat.message"]({ sessionID: "ses_root" });
    expect(JSON.parse(await readFile(path.join(root, "metadata.json"), "utf8"))).toMatchObject({ id: "ses_root" });
  } finally {
    if (previous === undefined) delete process.env.TREEFOLD_OPENCODE_SESSION_ID;
    else process.env.TREEFOLD_OPENCODE_SESSION_ID = previous;
    await rm(root, { recursive: true, force: true });
  }
});
