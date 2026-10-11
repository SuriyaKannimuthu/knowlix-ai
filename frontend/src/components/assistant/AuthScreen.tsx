"use client";

import { useState, type FormEvent } from "react";
import { DotGlyph } from "@/components/site/DotGlyph";
import { Logo } from "@/components/site/Logo";
import { ThemeToggle } from "@/components/site/ThemeToggle";
import { api, errorMessage } from "@/lib/api";

export function AuthScreen() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const registering = mode === "register";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      // On success the token store notifies the page, which swaps in the workspace.
      if (registering) await api.register(email.trim(), password, fullName.trim());
      else await api.login(email.trim(), password);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const field =
    "mt-1.5 w-full rounded-2xl border border-line-strong bg-panel px-4 py-3 text-[0.95rem] outline-none transition-colors placeholder:text-faint focus:border-ink focus-visible:outline-none";

  return (
    <div className="flex min-h-[100svh] p-3 md:p-4">
      <div className="relative flex flex-1 flex-col overflow-hidden rounded-card bg-surface">
        <div className="flex items-center justify-between px-6 pt-6 md:px-10 md:pt-8">
          <Logo />
          <ThemeToggle />
        </div>

        <div className="flex flex-1 items-center justify-center px-5 py-12">
          <div className="w-full max-w-sm">
            <DotGlyph name={registering ? "document" : "shield"} size={52} className="text-ink" />
            <h1 className="mt-7 text-[2rem] font-medium leading-[1.05] tracking-[-0.035em]">
              <span className="block text-muted">{registering ? "Create your" : "Welcome back."}</span>
              <span className="block">{registering ? "Knowlix account." : "Sign in to continue."}</span>
            </h1>
            <p className="mt-3 text-sm text-muted">
              Your documents are private to you unless you share them.
            </p>

            <form onSubmit={submit} className="mt-8 space-y-4">
              {registering ? (
                <label className="block text-sm">
                  Name <span className="text-faint">(optional)</span>
                  <input
                    className={field}
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    autoComplete="name"
                    maxLength={200}
                  />
                </label>
              ) : null}
              <label className="block text-sm">
                Email
                <input
                  className={field}
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@company.com"
                />
              </label>
              <label className="block text-sm">
                Password
                <input
                  className={field}
                  type="password"
                  required
                  minLength={registering ? 8 : undefined}
                  maxLength={128}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={registering ? "new-password" : "current-password"}
                  placeholder={registering ? "At least 8 characters" : undefined}
                />
              </label>

              {error ? (
                <p role="alert" className="rounded-xl bg-panel px-3 py-2 text-sm text-danger">
                  {error}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-full bg-ink px-5 py-3 text-[0.95rem] font-medium text-surface shadow-[0_10px_24px_-10px_rgba(0,0,0,0.65)] transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
              >
                {busy ? "Please wait…" : registering ? "Create account" : "Sign in"}
              </button>
            </form>

            <p className="mt-6 text-center text-sm text-muted">
              {registering ? "Already have an account?" : "New to Knowlix?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setMode(registering ? "login" : "register");
                  setError(null);
                }}
                className="font-medium text-ink underline underline-offset-4"
              >
                {registering ? "Sign in" : "Create an account"}
              </button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
