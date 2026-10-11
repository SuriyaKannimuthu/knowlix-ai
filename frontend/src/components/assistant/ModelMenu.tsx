"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { api, API_MODE, errorMessage } from "@/lib/api";
import {
  clearProviderKey,
  getLlmSettings,
  getServerLlmSettings,
  setModelChoice,
  setProviderKey,
  subscribeLlmSettings,
  type ModelChoice,
} from "@/lib/llm-settings";
import type { LLMProviderId, LLMProviderInfo, LLMProvidersResponse } from "@/lib/types";

const SHORT_NAME: Record<LLMProviderId, string> = { anthropic: "Claude", openai: "OpenAI", gemini: "Gemini" };
const CUSTOM = "__custom__";

type Verify =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "ok"; count: number }
  | { status: "error"; message: string };

export function useLlmSettings() {
  return useSyncExternalStore(subscribeLlmSettings, getLlmSettings, getServerLlmSettings);
}

function providerInfo(providers: LLMProvidersResponse | null, id: string | undefined) {
  return providers?.providers.find((p) => p.id === id);
}

function labelFor(providers: LLMProvidersResponse | null, provider: string, model: string): string {
  return providerInfo(providers, provider)?.models.find((m) => m.id === model)?.label ?? model;
}

/** The provider that will answer: the chosen one, or the server default's. */
export function effectiveProvider(
  choice: ModelChoice,
  providers: LLMProvidersResponse | null,
): LLMProviderInfo | undefined {
  return providerInfo(providers, choice.provider === "default" ? providers?.default.provider : choice.provider);
}

export function choiceLabel(choice: ModelChoice, providers: LLMProvidersResponse | null): string {
  if (choice.provider === "default") {
    const d = providers?.default;
    return d && providerInfo(providers, d.provider) ? labelFor(providers, d.provider, d.model) : "Server default";
  }
  const info = providerInfo(providers, choice.provider);
  return labelFor(providers, choice.provider, choice.model ?? info?.default_model ?? choice.provider);
}

/** True when the answering provider has neither a user key nor a server key. */
export function needsKey(
  choice: ModelChoice,
  keys: Partial<Record<LLMProviderId, string>>,
  providers: LLMProvidersResponse | null,
): boolean {
  if (API_MODE === "mock") return false; // the demo answers from sample data without any model
  const info = effectiveProvider(choice, providers);
  return Boolean(info && !keys[info.id] && !info.server_key_configured);
}

export function ModelMenu({
  providers,
  open,
  onOpenChange: setOpen,
}: {
  providers: LLMProvidersResponse | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const settings = useLlmSettings();
  const { choice, keys, remembered } = settings;
  const [showKey, setShowKey] = useState(false);
  const [verify, setVerify] = useState<Verify>({ status: "idle" });
  const [liveModels, setLiveModels] = useState<Partial<Record<LLMProviderId, string[]>>>({});
  const [customMode, setCustomMode] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  const isDefault = choice.provider === "default";
  const active = effectiveProvider(choice, providers);
  const missingKey = needsKey(choice, keys, providers);

  const selectProvider = (provider: ModelChoice["provider"]) => {
    setVerify({ status: "idle" });
    setCustomMode(false);
    setShowKey(false);
    setModelChoice(provider === "default" ? { provider, model: null } : { provider, model: null });
  };

  const runVerify = async () => {
    if (!active) return;
    const key = keys[active.id];
    if (!key) {
      setVerify({ status: "error", message: "Enter a key first." });
      return;
    }
    setVerify({ status: "checking" });
    try {
      const result = await api.verifyLlmKey(active.id, key);
      setLiveModels((all) => ({ ...all, [active.id]: result.models }));
      setVerify({ status: "ok", count: result.models.length });
    } catch (error) {
      setVerify({ status: "error", message: errorMessage(error) });
    }
  };

  const options: { id: string; label: string }[] = active
    ? [
        ...active.models,
        ...(liveModels[active.id] ?? [])
          .filter((id) => !active.models.some((m) => m.id === id))
          .map((id) => ({ id, label: id })),
      ]
    : [];
  const currentModel = !active
    ? ""
    : isDefault
      ? (providers?.default.model ?? active.default_model)
      : (choice.model ?? active.default_model);
  const isCustom = !isDefault && (customMode || (active !== undefined && !options.some((o) => o.id === currentModel)));

  const providerButton = (value: ModelChoice["provider"], title: string, hint: string, disabled = false) => (
    <button
      key={value}
      type="button"
      role="radio"
      aria-checked={choice.provider === value}
      disabled={disabled}
      onClick={() => selectProvider(value)}
      className={`rounded-2xl border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        choice.provider === value ? "border-ink bg-surface" : "border-line hover:border-line-strong"
      }`}
    >
      <span className="block text-[0.82rem] font-medium">{title}</span>
      <span className="block truncate font-mono text-[0.6rem] text-muted">{hint}</span>
    </button>
  );

  const defaultInfo = providerInfo(providers, providers?.default.provider);
  const defaultHint = defaultInfo
    ? labelFor(providers, defaultInfo.id, providers?.default.model ?? defaultInfo.default_model)
    : "configured on the server";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Choose the model that writes answers"
        className={`flex h-9 max-w-[52vw] items-center gap-2 rounded-full border px-3 text-sm transition sm:max-w-[20rem] sm:px-3.5 ${
          missingKey
            ? "border-ink bg-ink text-surface shadow-[0_8px_18px_-10px_rgba(0,0,0,0.6)] hover:-translate-y-px"
            : "border-line-strong hover:border-ink"
        }`}
      >
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
          <rect x="3.5" y="3.5" width="9" height="9" rx="2" />
          <path d="M6 1.5v2M10 1.5v2M6 12.5v2M10 12.5v2M1.5 6h2M1.5 10h2M12.5 6h2M12.5 10h2" strokeLinecap="round" />
        </svg>
        <span
          className={`hidden shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.14em] sm:inline ${
            missingKey ? "text-faint" : "text-muted"
          }`}
        >
          Model
        </span>
        <span className="truncate">{choiceLabel(choice, providers)}</span>
        {missingKey ? (
          <span className="shrink-0 rounded-full bg-surface px-1.5 py-px font-mono text-[0.58rem] text-ink">
            add key
          </span>
        ) : null}
        <svg viewBox="0 0 16 16" className="h-3 w-3 shrink-0 opacity-60" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="m4 6 4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Model settings"
          className="fixed inset-x-3 top-16 z-30 max-h-[80svh] overflow-y-auto rounded-3xl border border-line bg-panel p-4 shadow-[0_24px_60px_-30px_rgba(0,0,0,0.45)] sm:absolute sm:inset-x-auto sm:left-0 sm:top-full sm:mt-2 sm:w-[24rem]"
        >
          <p className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted">Answer with</p>
          <div role="radiogroup" aria-label="Provider" className="mt-2 grid grid-cols-2 gap-1.5">
            {providerButton("default", "Server default", defaultHint)}
            {(providers?.providers ?? []).map((p) =>
              providerButton(
                p.id,
                p.name,
                p.server_key_configured ? "server key available" : "your API key",
                !providers?.allow_user_keys && !p.server_key_configured,
              ),
            )}
          </div>

          {active ? (
            <div className="mt-4 space-y-3 border-t border-line pt-4">
              {isDefault ? (
                <p className="text-sm">
                  <span className="font-medium">{active.name}</span>
                  <span className="text-muted"> · {labelFor(providers, active.id, currentModel)}</span>
                </p>
              ) : (
                <>
                  <label className="block text-sm">
                    <span className="font-medium">Model</span>
                    <select
                      value={isCustom ? CUSTOM : currentModel}
                      onChange={(event) => {
                        if (event.target.value === CUSTOM) {
                          setCustomMode(true);
                          return;
                        }
                        setCustomMode(false);
                        setModelChoice({ provider: active.id, model: event.target.value });
                      }}
                      className="mt-1.5 w-full rounded-full border border-line-strong bg-panel px-3.5 py-2 text-sm outline-none focus:border-ink"
                    >
                      {options.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.label}
                        </option>
                      ))}
                      <option value={CUSTOM}>Custom model ID…</option>
                    </select>
                  </label>
                  {isCustom ? (
                    <input
                      aria-label="Custom model ID"
                      value={choice.model ?? ""}
                      onChange={(event) =>
                        setModelChoice({ provider: active.id, model: event.target.value.trim() || null })
                      }
                      placeholder={active.default_model}
                      spellCheck={false}
                      className="w-full rounded-full border border-line-strong bg-panel px-3.5 py-2 font-mono text-xs outline-none focus:border-ink"
                    />
                  ) : null}
                </>
              )}

              <div>
                <div className="flex items-baseline justify-between">
                  <label htmlFor="llm-key" className="text-sm font-medium">
                    {SHORT_NAME[active.id]} API key
                    {active.server_key_configured ? <span className="font-normal text-muted"> (optional)</span> : null}
                  </label>
                  <a
                    href={active.key_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[0.65rem] text-muted underline underline-offset-4 hover:text-ink"
                  >
                    get a key ↗
                  </a>
                </div>
                <div className="mt-1.5 flex gap-1.5">
                  <input
                    id="llm-key"
                    type={showKey ? "text" : "password"}
                    value={keys[active.id] ?? ""}
                    onChange={(event) => {
                      setVerify({ status: "idle" });
                      setProviderKey(active.id, event.target.value, Boolean(remembered[active.id]));
                    }}
                    placeholder={active.key_prefix ? `${active.key_prefix}…` : "Paste your key"}
                    autoComplete="off"
                    spellCheck={false}
                    className="min-w-0 flex-1 rounded-full border border-line-strong bg-panel px-3.5 py-2 font-mono text-xs outline-none focus:border-ink"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey((v) => !v)}
                    className="shrink-0 rounded-full border border-line-strong px-3 font-mono text-[0.65rem] hover:border-ink"
                    aria-label={showKey ? "Hide key" : "Show key"}
                  >
                    {showKey ? "hide" : "show"}
                  </button>
                </div>
                {active.server_key_configured && !keys[active.id] ? (
                  <p className="mt-1.5 text-xs text-muted">The server has a key for this provider; yours is optional.</p>
                ) : null}

                <label className="mt-2.5 flex items-start gap-2 text-xs text-ink-soft">
                  <input
                    type="checkbox"
                    checked={Boolean(remembered[active.id])}
                    disabled={!keys[active.id]}
                    onChange={(event) => setProviderKey(active.id, keys[active.id] ?? "", event.target.checked)}
                    className="mt-0.5 accent-ink"
                  />
                  <span>
                    Remember on this device
                    <span className="block text-[0.68rem] text-muted">
                      Otherwise the key is forgotten when you close this tab.
                    </span>
                  </span>
                </label>

                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void runVerify()}
                    disabled={verify.status === "checking" || !keys[active.id]}
                    className="rounded-full bg-ink px-3.5 py-1.5 text-xs text-surface disabled:opacity-40"
                  >
                    {verify.status === "checking" ? "Checking…" : "Verify key"}
                  </button>
                  {keys[active.id] ? (
                    <button
                      type="button"
                      onClick={() => {
                        clearProviderKey(active.id);
                        setVerify({ status: "idle" });
                      }}
                      className="font-mono text-[0.68rem] text-muted hover:text-ink"
                    >
                      remove key
                    </button>
                  ) : null}
                </div>
                {verify.status === "ok" ? (
                  <p role="status" className="mt-2 text-xs text-ink">
                    ✓ Key works · {verify.count} models available to it
                  </p>
                ) : verify.status === "error" ? (
                  <p role="alert" className="mt-2 text-xs text-danger">
                    {verify.message}
                  </p>
                ) : null}
              </div>
            </div>
          ) : null}

          <p className="mt-4 border-t border-line pt-3 text-[0.68rem] leading-relaxed text-muted">
            {API_MODE === "mock"
              ? "Demo mode answers from sample passages; your choice applies once the FastAPI backend is connected."
              : "Your key is sent only to the Knowlix API with each question, used for that request, and never stored on the server. Verifying lists models and costs nothing."}
          </p>
          <div className="mt-3 flex justify-end">
            <button type="button" onClick={() => setOpen(false)} className="rounded-full bg-ink px-3 py-1 text-xs text-surface">
              Done
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
