import { frontendLogger } from "@/lib/logger";
import i18n from "@/i18n";

let API_BASE = import.meta.env.VITE_TREEFOLD_API_BASE || "http://127.0.0.1:15001";

export function setApiBase(apiBase: string): void {
  API_BASE = apiBase.replace(/\/$/, "");
}

export function apiUrl(path: string): string {
  return new URL(path, API_BASE).toString();
}

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type RequestOptions = Omit<RequestInit, "body"> & { json?: unknown };

function isErrorBody(value: unknown): value is ErrorBody {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = value.error;
  return Boolean(error && typeof error === "object" && "code" in error
    && typeof error.code === "string" && "message" in error && typeof error.message === "string");
}

async function responseBody(response: Response, requestId: string): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(response.status, "INVALID_RESPONSE", i18n.t("feedback.invalidResponse", { status: response.status }), undefined, requestId);
  }
}

export async function request<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, ...init } = options;
  const headers = new Headers(init.headers);
  if (json !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const requestId = crypto.randomUUID();
  headers.set("X-Request-ID", requestId);
  const method = (init.method ?? "GET").toUpperCase();
  const label = `${method} ${new URL(apiUrl(path)).pathname}`;
  const started = performance.now();
  let activeId: string = requestId;
  let status = 0;
  try {
    let response: Response;
    try {
      response = await fetch(`${API_BASE}${path}`, {
        ...init, headers, body: json === undefined ? undefined : JSON.stringify(json),
      });
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
      throw new ApiError(0, "NETWORK_ERROR", cause instanceof Error ? cause.message : i18n.t("feedback.networkError"), cause, activeId);
    }
    status = response.status;
    const returnedId = response.headers.get("X-Request-ID");
    if (returnedId && /^[A-Za-z0-9_-]{1,128}$/.test(returnedId)) activeId = returnedId;
    const body = await responseBody(response, activeId);
    if (!response.ok) {
      if (isErrorBody(body)) throw new ApiError(status, body.error.code, body.error.message, body.error.details, activeId);
      throw new ApiError(status, "HTTP_ERROR", i18n.t("feedback.httpError", { status }), body, activeId);
    }
    const level = ["GET", "HEAD", "OPTIONS"].includes(method) ? "debug" : "info";
    frontendLogger[level](`request_id=${activeId} HTTP ${label} status=${status} elapsed_ms=${Math.round(performance.now() - started)}`);
    return body as T;
  } catch (cause) {
    const aborted = cause instanceof DOMException && cause.name === "AbortError";
    const level = aborted ? "debug" : status >= 500 || status === 0 ? "error" : "warn";
    frontendLogger[level](`request_id=${activeId} HTTP ${label} status=${status} outcome=${aborted ? "aborted" : "failed"} elapsed_ms=${Math.round(performance.now() - started)}`);
    throw cause;
  }
}

/** One ID per logical stream; EventSource automatic reconnects reuse that ID. */
export function streamUrl(path: string): string {
  const url = new URL(apiUrl(path));
  const id = crypto.randomUUID();
  url.searchParams.set("request_id", id);
  frontendLogger.debug(`request_id=${id} Stream connecting ${url.pathname}`);
  return url.toString();
}

export function websocketUrl(path: string): string {
  const url = new URL(streamUrl(path));
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function logStreamState(rawUrl: string, state: "open" | "error" | "closed"): void {
  const url = new URL(rawUrl);
  frontendLogger[state === "error" ? "warn" : "debug"](`request_id=${url.searchParams.get("request_id")} Stream ${state} ${url.pathname}`);
}
