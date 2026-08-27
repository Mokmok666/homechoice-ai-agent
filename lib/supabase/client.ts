import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
const SUPABASE_REQUEST_TIMEOUT_MS = 8_000;

let browserClient: SupabaseClient<Database> | null = null;

async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(init?.signal?.reason);
  init?.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = window.setTimeout(() => controller.abort("SUPABASE_TIMEOUT"), SUPABASE_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
    init?.signal?.removeEventListener("abort", forwardAbort);
  }
}

export function getSupabaseClient(): SupabaseClient<Database> | null {
  if (typeof window === "undefined" || !isSupabaseConfigured) return null;
  if (!browserClient) {
    browserClient = createClient<Database>(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
      global: { fetch: fetchWithTimeout },
    });
  }
  return browserClient;
}
