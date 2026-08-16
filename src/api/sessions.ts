import { request, websocketUrl } from "./client";
import type { Session } from "@/domain/types";

export const sessionsApi = {
  get: (id: string) => request<Session>(`/api/sessions/${id}`),
  update: (id: string, json: unknown) => request<Session>(`/api/sessions/${id}`, { method: "PATCH", json }),
  delete: (id: string) => request(`/api/sessions/${id}`, { method: "DELETE" }),
  close: (id: string) => request(`/api/sessions/${id}/close`, { method: "POST" }),
  open: (id: string) => request<Session>(`/api/sessions/${id}/open`, { method: "POST" }),
  stop: (id: string) => request(`/api/sessions/${id}/stop`, { method: "POST" }),
  restart: (id: string) => request<Session>(`/api/sessions/${id}/restart`, { method: "POST" }),
  terminalSocketUrl: (id: string) => websocketUrl(`/api/sessions/${id}/terminal?takeover=true`),
};
