let API_BASE = import.meta.env.FE_API_BASE || "http://127.0.0.1:15001";

export function setApiBase(apiBase: string): void {
  API_BASE = apiBase.replace(/\/$/, "");
}

type ErrorBody = { error: { code: string; message: string; details?: unknown } };

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
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

async function responseBody(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(response.status, "INVALID_RESPONSE", `Server returned invalid JSON (${response.status})`);
  }
}

export async function request<T = void>(path: string, options: RequestOptions = {}): Promise<T> {
  const { json, ...init } = options;
  const headers = new Headers(init.headers);
  if (json !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
      body: json === undefined ? undefined : JSON.stringify(json),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new ApiError(0, "NETWORK_ERROR", cause instanceof Error ? cause.message : "Network request failed", cause);
  }
  const body = await responseBody(response);
  if (!response.ok) {
    if (isErrorBody(body)) throw new ApiError(response.status, body.error.code, body.error.message, body.error.details);
    throw new ApiError(response.status, "HTTP_ERROR", `Request failed: ${response.status}`, body);
  }
  return body as T;
}

export function websocketUrl(path: string): string {
  const url = new URL(path, API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}
