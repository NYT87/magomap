import type { ApiErrorCode } from "@magomap/domain";

export class UnauthorizedError extends Error {
  constructor() {
    super("Signed out");
  }
}

export class NetworkError extends Error {
  constructor(cause?: unknown) {
    super("Network unavailable", { cause });
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: ApiErrorCode;
  readonly body: unknown;
  constructor(status: number, body: unknown) {
    const code =
      body && typeof body === "object" && "error" in body
        ? ((body as { error: ApiErrorCode }).error ?? undefined)
        : undefined;
    super(`API ${status}${code ? ` ${code}` : ""}`);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

/** Fetches a same-origin API path with the session cookie; JSON in, JSON out. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init, headers });
  } catch (error) {
    throw new NetworkError(error);
  }
  if (res.status === 401) throw new UnauthorizedError();
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new ApiError(res.status, body);
  return body as T;
}
