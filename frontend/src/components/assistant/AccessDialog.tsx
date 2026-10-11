"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, errorMessage } from "@/lib/api";
import type { DocumentRecord, Share, Visibility } from "@/lib/types";

/** Owner-only: switch visibility and grant or revoke per-user access. */
export function AccessDialog({
  document,
  onClose,
  onUpdated,
}: {
  document: DocumentRecord;
  onClose: () => void;
  onUpdated: (doc: DocumentRecord) => void;
}) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const visibility = document.visibility ?? "private";

  useEffect(() => {
    let cancelled = false;
    api
      .listShares(document.id)
      .then((list) => !cancelled && setShares(list))
      .catch((err) => !cancelled && setError(errorMessage(err)));
    return () => {
      cancelled = true;
    };
  }, [document.id]);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setVisibility = (value: Visibility) =>
    run(async () => onUpdated(await api.updateDocument(document.id, { visibility: value })));

  const share = (event: FormEvent) => {
    event.preventDefault();
    const target = email.trim();
    if (!target) return;
    void run(async () => {
      const created = await api.shareDocument(document.id, target);
      setShares((list) => [...(list ?? []), created]);
      setEmail("");
    });
  };

  const revoke = (userId: string) =>
    run(async () => {
      await api.revokeShare(document.id, userId);
      setShares((list) => (list ?? []).filter((s) => s.user_id !== userId));
    });

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-3 sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-scrim backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="access-title"
        tabIndex={-1}
        className="relative w-full max-w-md rounded-card bg-surface p-6 shadow-[0_40px_90px_-30px_rgba(0,0,0,0.55)] outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-muted">Manage access</p>
            <h2 id="access-title" className="mt-1 truncate text-lg font-medium tracking-[-0.02em]">
              {document.filename}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <fieldset className="mt-6">
          <legend className="text-sm font-medium">Visibility</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(
              [
                ["private", "Private", "You and people you share with"],
                ["organization", "Organization", "Everyone signed in"],
              ] as const
            ).map(([value, label, hint]) => (
              <button
                key={value}
                type="button"
                disabled={busy}
                aria-pressed={visibility === value}
                onClick={() => visibility !== value && void setVisibility(value)}
                className={`rounded-2xl border px-3 py-2.5 text-left transition-colors ${
                  visibility === value ? "border-ink bg-panel" : "border-line hover:border-line-strong"
                }`}
              >
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-0.5 block text-[0.72rem] leading-snug text-muted">{hint}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <form onSubmit={share} className="mt-6">
          <label htmlFor="share-email" className="text-sm font-medium">
            Share with a person
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="share-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
              className="min-w-0 flex-1 rounded-full border border-line-strong bg-panel px-4 py-2 text-sm outline-none focus:border-ink focus-visible:outline-none"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-full bg-ink px-4 py-2 text-sm text-surface disabled:opacity-50"
            >
              Share
            </button>
          </div>
        </form>

        {error ? (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        ) : null}

        <div className="mt-5">
          <p className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-muted">
            People with access
          </p>
          {shares === null ? (
            <div className="mt-2 h-10 animate-pulse rounded-xl bg-line/60" />
          ) : shares.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Only you.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {shares.map((s) => (
                <li key={s.user_id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0 truncate text-sm">{s.full_name || s.email}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void revoke(s.user_id)}
                    className="shrink-0 font-mono text-[0.7rem] text-muted hover:text-ink"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
