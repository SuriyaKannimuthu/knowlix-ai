// The user's model choice and their own provider API keys, kept in the browser.
//
// Keys live in sessionStorage (cleared when the tab closes) unless the user opts
// into "remember on this device", which moves them to localStorage. They are only
// ever sent to the Knowlix API, with each question, in the X-LLM-API-Key header.

import type { LLMProviderId } from "./types";

export type ModelChoice =
  | { provider: "default"; model: null }
  | { provider: LLMProviderId; model: string | null };

export interface LLMSettings {
  choice: ModelChoice;
  keys: Partial<Record<LLMProviderId, string>>;
  remembered: Partial<Record<LLMProviderId, boolean>>;
}

const PROVIDERS: LLMProviderId[] = ["anthropic", "openai", "gemini"];
const CHOICE_KEY = "knowlix.llm.choice";
const keyName = (provider: LLMProviderId) => `knowlix.llm.key.${provider}`;
const EMPTY: LLMSettings = { choice: { provider: "default", model: null }, keys: {}, remembered: {} };

const listeners = new Set<() => void>();
let state: LLMSettings | null = null;

function storage(kind: "local" | "session"): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

function load(): LLMSettings {
  if (typeof window === "undefined") return EMPTY;
  const loaded: LLMSettings = { choice: EMPTY.choice, keys: {}, remembered: {} };
  try {
    const raw = storage("local")?.getItem(CHOICE_KEY);
    const parsed = raw ? (JSON.parse(raw) as ModelChoice) : null;
    if (parsed && ["anthropic", "openai", "gemini"].includes(parsed.provider)) loaded.choice = parsed;
  } catch {
    // Ignore malformed or unavailable storage.
  }
  for (const provider of PROVIDERS) {
    try {
      const remembered = storage("local")?.getItem(keyName(provider));
      const session = storage("session")?.getItem(keyName(provider));
      if (remembered) {
        loaded.keys[provider] = remembered;
        loaded.remembered[provider] = true;
      } else if (session) {
        loaded.keys[provider] = session;
      }
    } catch {
      // Ignore.
    }
  }
  return loaded;
}

function commit(next: LLMSettings) {
  state = next;
  listeners.forEach((listener) => listener());
}

export function getLlmSettings(): LLMSettings {
  if (state === null) state = load();
  return state;
}

export function getServerLlmSettings(): LLMSettings {
  return EMPTY;
}

export function subscribeLlmSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setModelChoice(choice: ModelChoice) {
  try {
    storage("local")?.setItem(CHOICE_KEY, JSON.stringify(choice));
  } catch {
    // Choice still applies for this session.
  }
  commit({ ...getLlmSettings(), choice });
}

export function setProviderKey(provider: LLMProviderId, key: string, remember: boolean) {
  const value = key.trim();
  const local = storage("local");
  const session = storage("session");
  try {
    local?.removeItem(keyName(provider));
    session?.removeItem(keyName(provider));
    if (value) (remember ? local : session)?.setItem(keyName(provider), value);
  } catch {
    // Fall back to memory only.
  }
  const current = getLlmSettings();
  const keys = { ...current.keys };
  const remembered = { ...current.remembered };
  if (value) keys[provider] = value;
  else delete keys[provider];
  remembered[provider] = Boolean(value) && remember;
  commit({ ...current, keys, remembered });
}

export function clearProviderKey(provider: LLMProviderId) {
  setProviderKey(provider, "", false);
}
