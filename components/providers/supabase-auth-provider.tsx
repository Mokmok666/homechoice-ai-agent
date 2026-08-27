"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { getSupabaseClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { migrateLocalStorageToSupabase } from "@/lib/supabase/migration";

interface SupabaseAuthState {
  authReady: boolean;
  userId: string | null;
  supabaseAvailable: boolean;
}

const SupabaseAuthContext = createContext<SupabaseAuthState>({
  authReady: false,
  userId: null,
  supabaseAvailable: false,
});

let initializationPromise: Promise<SupabaseAuthState> | null = null;

async function initializeSupabaseAuth(): Promise<SupabaseAuthState> {
  if (!isSupabaseConfigured) return { authReady: true, userId: null, supabaseAvailable: false };
  const client = getSupabaseClient();
  if (!client) return { authReady: true, userId: null, supabaseAvailable: false };

  try {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    let userId = sessionData.session?.user.id ?? null;
    if (!userId) {
      const { data, error } = await client.auth.signInAnonymously();
      if (error) throw error;
      userId = data.user?.id ?? null;
    }
    if (!userId) throw new Error("Anonymous sign-in did not return a user.");
    await migrateLocalStorageToSupabase(userId);
    return { authReady: true, userId, supabaseAvailable: true };
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      const message = error instanceof Error ? error.message : "Anonymous sign-in is disabled or unavailable.";
      console.warn("Supabase initialization failed; using LocalStorage fallback.", message);
    }
    return { authReady: true, userId: null, supabaseAvailable: false };
  }
}

export function SupabaseAuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SupabaseAuthState>({
    authReady: !isSupabaseConfigured,
    userId: null,
    supabaseAvailable: false,
  });

  useEffect(() => {
    let active = true;
    initializationPromise ??= initializeSupabaseAuth();
    void initializationPromise.then((nextState) => {
      if (active) setState(nextState);
    });
    return () => { active = false; };
  }, []);

  const value = useMemo(() => state, [state]);
  return <SupabaseAuthContext.Provider value={value}>{children}</SupabaseAuthContext.Provider>;
}

export function useSupabaseAuth(): SupabaseAuthState {
  return useContext(SupabaseAuthContext);
}
