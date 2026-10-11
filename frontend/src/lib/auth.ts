// Access-token storage. localStorage keeps the session across reloads; every
// access is guarded because storage can be unavailable (private mode, policies).

const KEY = "knowlix.token";
const listeners = new Set<() => void>();
let memoryToken: string | null = null;

export function getToken(): string | null {
  try {
    return window.localStorage.getItem(KEY) ?? memoryToken;
  } catch {
    return memoryToken;
  }
}

export function setToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) window.localStorage.setItem(KEY, token);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Fall back to the in-memory copy.
  }
  listeners.forEach((listener) => listener());
}

/** Subscribe to sign-in / sign-out (including a 401 from the API). */
export function onTokenChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
