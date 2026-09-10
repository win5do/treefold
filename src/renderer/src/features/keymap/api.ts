import { queryOptions } from "@tanstack/react-query";
import { request } from "@/api/client";
import type { Keymap } from "@/domain/types";
export type { CommandId, Keymap, KeymapCommand } from "@/domain/types";
export const keymapKey = ["keymap"] as const;
export const keymapQuery = () =>
  queryOptions({
    queryKey: keymapKey,
    queryFn: ({ signal }) => request<Keymap>("/api/keymap", { signal }),
    refetchInterval: 2000,
  });
export const updateKeymap = (bindings: Record<string, string | false | null>) =>
  request<Keymap>("/api/keymap", { method: "PATCH", json: { bindings } });
