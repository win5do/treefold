import { defaultFilter } from "cmdk";
import { actionScopes, type PaletteEntry } from "./model";

export function searchPalette(entries: PaletteEntry[], query: string): PaletteEntry[] {
  const search = query.trim().toLowerCase();
  return entries
    .map((entry) => {
      const id = entry.actionId.toLowerCase();
      const score = !search ? 1 : id === search ? 3 : id.startsWith(search) ? 2 :
        Math.max(defaultFilter(id, search), defaultFilter(entry.name, search), defaultFilter(entry.label, search));
      return { entry, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => actionScopes.indexOf(a.entry.scope) - actionScopes.indexOf(b.entry.scope) || b.score - a.score)
    .map(({ entry }) => entry);
}
