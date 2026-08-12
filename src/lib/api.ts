const API_BASE = import.meta.env.VITE_TREEFOLD_API_BASE || "http://127.0.0.1:7331";

type ErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = value.error;
  return Boolean(
    error
      && typeof error === "object"
      && "code" in error
      && typeof error.code === "string"
      && "message" in error
      && typeof error.message === "string",
  );
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      `Server returned invalid JSON (${response.status})`,
    );
  }
}

export async function api<T = void>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers,
    });
  } catch (cause) {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      cause instanceof Error ? cause.message : "Network request failed",
      cause,
    );
  }

  if (response.status === 204) return undefined as T;

  const body = await readJson(response);
  if (!response.ok) {
    if (isErrorBody(body)) {
      throw new ApiError(
        response.status,
        body.error.code,
        body.error.message,
        body.error.details,
      );
    }

    throw new ApiError(
      response.status,
      "HTTP_ERROR",
      `Request failed: ${response.status}`,
      body,
    );
  }

  return body as T;
}
