import { getSupabaseClient } from "./client";
import type { BuyerPreferences } from "@/types/buyer-preferences";
import type { Json } from "@/types/database";

function clientOrThrow() {
  const client = getSupabaseClient();
  if (!client) throw new Error("SUPABASE_UNAVAILABLE");
  return client;
}

export async function getCloudPreferences(userId: string): Promise<unknown | null> {
  const { data, error } = await clientOrThrow()
    .from("buyer_preferences")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data?.data ?? null;
}

export async function upsertCloudPreferences(userId: string, preferences: BuyerPreferences): Promise<void> {
  const { error } = await clientOrThrow().from("buyer_preferences").upsert({
    user_id: userId,
    data: preferences as unknown as Json,
    created_at: preferences.createdAt,
    updated_at: preferences.updatedAt,
  }, { onConflict: "user_id" });
  if (error) throw error;
}
