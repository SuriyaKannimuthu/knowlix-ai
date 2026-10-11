"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { getToken, onTokenChange } from "@/lib/auth";
import type { User } from "@/lib/types";
import { AuthScreen } from "./AuthScreen";
import { Workspace } from "./Workspace";

const noopSubscribe = () => () => {};

/** Signs the user in (live mode) and then shows the workspace. */
export function AssistantApp() {
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const token = useSyncExternalStore(onTokenChange, getToken, () => null);
  const [session, setSession] = useState<{ token: string | null; user: User } | null>(null);
  // Only trust the profile loaded for the current token.
  const user = session && session.token === token ? session.user : null;

  useEffect(() => {
    if (!token && api.requiresAuth) return;
    let cancelled = false;
    api
      .me()
      .then((me) => !cancelled && setSession({ token, user: me }))
      .catch(() => {
        // A stale token is cleared by the API client on 401; other errors keep the session.
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (!hydrated) return null;
  if (api.requiresAuth && !token) return <AuthScreen />;
  // Remount on account switch so no state leaks between users.
  return <Workspace key={token ?? "demo"} user={user} />;
}


