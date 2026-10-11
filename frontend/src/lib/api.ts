import { getToken, setToken } from "./auth";
import { API_BASE_URL, API_MODE } from "./config";
import { mockApi } from "./mock-api";
import type {
  AuthResponse,
  CalibrateResponse,
  ChatOptions,
  ChatRequest,
  ChatResponse,
  DocumentRecord,
  HealthResponse,
  KnowlixApi,
  LLMProviderId,
  LLMProvidersResponse,
  RequestOptions,
  Share,
  UploadOptions,
  User,
  VerifyKeyResponse,
} from "./types";

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something went wrong. Please try again.";
}

const UNREACHABLE = "Could not reach the Knowlix AI API. Is the FastAPI server running?";

/** FastAPI errors arrive as `{ detail: string }` or, for 422s, `{ detail: [{ msg, loc }] }`. */
function formatDetail(body: unknown): string | null {
  if (!body || typeof body !== "object" || !("detail" in body)) return null;
  const { detail } = body as { detail: unknown };
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (!item || typeof item !== "object" || !("msg" in item)) return String(item);
        const msg = String(item.msg).replace(/^Value error, /, "");
        const loc = "loc" in item && Array.isArray(item.loc) ? item.loc.at(-1) : null;
        return loc && typeof loc === "string" ? `${loc}: ${msg}` : msg;
      })
      .join("; ");
  }
  return null;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** An expired or revoked token signs the user out everywhere. */
function handleUnauthorized(status: number, path: string) {
  if (status === 401 && !path.startsWith("/auth/login") && getToken()) setToken(null);
}

/** Abort when either the caller's signal fires or the timeout elapses. */
function withTimeout(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forward = () => controller.abort();
  if (signal?.aborted) controller.abort();
  signal?.addEventListener("abort", forward, { once: true });
  return {
    signal: controller.signal,
    didTimeOut: () => timedOut,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    },
  };
}

async function request<T>(
  path: string,
  init: RequestInit & { timeoutMs?: number; json?: unknown } = {},
): Promise<T> {
  const { timeoutMs = 30_000, signal, headers, json, ...rest } = init;
  const guard = withTimeout(signal ?? undefined, timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...rest,
      body: json === undefined ? rest.body : JSON.stringify(json),
      signal: guard.signal,
      headers: {
        Accept: "application/json",
        ...(json === undefined ? {} : { "Content-Type": "application/json" }),
        ...authHeaders(),
        ...headers,
      },
    });
  } catch (error) {
    if (guard.didTimeOut()) throw new ApiError("The server took too long to respond.", 408);
    if (isAbortError(error)) throw error;
    throw new ApiError(UNREACHABLE, 0);
  } finally {
    guard.dispose();
  }

  if (!response.ok) {
    handleUnauthorized(response.status, path);
    const body = parseJson(await response.text());
    let message = formatDetail(body) ?? `Request failed with status ${response.status}.`;
    if (response.status === 429) {
      const retry = response.headers.get("Retry-After");
      if (retry) message = `${message} (retry in ${retry}s)`;
    }
    throw new ApiError(message, response.status);
  }
  if (response.status === 204) return undefined as T;
  return parseJson(await response.text()) as T;
}

function storeSession(auth: AuthResponse): AuthResponse {
  setToken(auth.access_token);
  return auth;
}

const liveApi: KnowlixApi = {
  requiresAuth: true,

  health(options?: RequestOptions) {
    return request<HealthResponse>("/health", { signal: options?.signal, timeoutMs: 8_000 });
  },

  // OAuth2 password flow: form-encoded, with the email in `username`.
  async login(email: string, password: string) {
    const body = new URLSearchParams({ username: email, password });
    return storeSession(
      await request<AuthResponse>("/auth/login", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      }),
    );
  },

  async register(email: string, password: string, fullName?: string) {
    return storeSession(
      await request<AuthResponse>("/auth/register", {
        method: "POST",
        json: { email, password, full_name: fullName || null },
      }),
    );
  },

  me() {
    return request<User>("/auth/me");
  },

  listDocuments(options?: RequestOptions) {
    return request<DocumentRecord[]>("/documents", { signal: options?.signal });
  },

  // XHR rather than fetch so we can report upload progress.
  uploadDocument(file: File, options: UploadOptions = {}) {
    return new Promise<DocumentRecord>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${API_BASE_URL}/documents/upload`);
      xhr.setRequestHeader("Accept", "application/json");
      const token = getToken();
      if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.timeout = 180_000;

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) options.onProgress?.(event.loaded / event.total);
      };
      xhr.onload = () => {
        const body = parseJson(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(body as DocumentRecord);
        } else {
          handleUnauthorized(xhr.status, "/documents/upload");
          reject(
            new ApiError(formatDetail(body) ?? `Upload failed with status ${xhr.status}.`, xhr.status),
          );
        }
      };
      xhr.onerror = () => reject(new ApiError(UNREACHABLE, 0));
      xhr.ontimeout = () => reject(new ApiError("The upload timed out.", 408));
      xhr.onabort = () => reject(new DOMException("Upload cancelled", "AbortError"));
      options.signal?.addEventListener("abort", () => xhr.abort(), { once: true });

      const form = new FormData();
      form.append("file", file);
      if (options.tags?.length) form.append("tags", options.tags.join(","));
      if (options.visibility) form.append("visibility", options.visibility);
      xhr.send(form);
    });
  },

  updateDocument(id, patch) {
    return request<DocumentRecord>(`/documents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: patch,
    });
  },

  calibrateDocuments(all = false) {
    return request<CalibrateResponse>(`/documents/calibrate${all ? "?all=true" : ""}`, { method: "POST" });
  },

  async deleteDocument(id: string) {
    await request<void>(`/documents/${encodeURIComponent(id)}`, { method: "DELETE" });
  },

  listShares(id: string) {
    return request<Share[]>(`/documents/${encodeURIComponent(id)}/shares`);
  },

  shareDocument(id: string, email: string) {
    return request<Share>(`/documents/${encodeURIComponent(id)}/shares`, {
      method: "POST",
      json: { email },
    });
  },

  async revokeShare(id: string, userId: string) {
    await request<void>(
      `/documents/${encodeURIComponent(id)}/shares/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    );
  },

  async chat(body: ChatRequest, options?: ChatOptions) {
    const response = await request<ChatResponse>("/chat", {
      method: "POST",
      json: body,
      signal: options?.signal,
      // The user's provider key travels only in this header, never in the body.
      headers: options?.llmKey ? { "X-LLM-API-Key": options.llmKey } : undefined,
      timeoutMs: 180_000,
    });
    return { ...response, sources: Array.isArray(response?.sources) ? response.sources : [] };
  },

  llmProviders() {
    return request<LLMProvidersResponse>("/llm/providers");
  },

  verifyLlmKey(provider: LLMProviderId, key: string) {
    return request<VerifyKeyResponse>("/llm/verify", {
      method: "POST",
      json: { provider },
      headers: { "X-LLM-API-Key": key },
    });
  },
};

export const api: KnowlixApi = API_MODE === "live" ? liveApi : mockApi;
export { API_MODE };
