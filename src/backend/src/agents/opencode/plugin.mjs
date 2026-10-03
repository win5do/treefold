// Bind from a root user-message hook. Directory-wide metadata events are not launch evidence.
import { readFileSync, writeFileSync, renameSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const Treefold = async ({ client }) => {
  const file = fileURLToPath(new URL("./metadata.json", import.meta.url));
  let saved;
  try { saved = JSON.parse(readFileSync(file, "utf8")); } catch { saved = {}; }
  const expected = process.env.TREEFOLD_OPENCODE_SESSION_ID;
  if (expected) saved = { ...saved, id: expected };
  const write = (info) => {
    saved = { id: info.id, title: info.title };
    const temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(saved), { mode: 0o600 });
    renameSync(temporary, file);
  };
  return {
    "chat.message": async ({ sessionID }) => {
      // Native switching is allowed; Treefold keeps its existing Resume association.
      if (saved.id && saved.id !== sessionID) return;
      const { data: info } = await client.session.get({ path: { id: sessionID }, throwOnError: true });
      if (!info || info.id !== sessionID || !info.id.startsWith("ses_")) {
        return;
      }
      if (info.parentID) return;
      // Re-check after awaiting: two root requests must not replace each other's binding.
      if (saved.id && saved.id !== info.id) {
        return;
      }
      write(info);
    },
    event: async ({ event }) => {
      if (event.type !== "session.updated") return;
      const info = event.properties?.info;
      if (!saved.id || info?.id !== saved.id || info.parentID) return;
      write(info);
    },
  };
};
