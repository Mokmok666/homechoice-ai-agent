import { getSupabaseClient } from "./client";
import type { Json } from "@/types/database";
import type { DecisionHistoryRecord } from "@/types/decision-history";

function clientOrThrow() {
  const client = getSupabaseClient();
  if (!client) throw new Error("SUPABASE_UNAVAILABLE");
  return client;
}

export async function listCloudHistory(userId: string): Promise<unknown[]> {
  const { data, error } = await clientOrThrow()
    .from("decision_history")
    .select("data")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw error;
  return data.map((row) => row.data);
}

export async function insertCloudHistory(userId: string, record: DecisionHistoryRecord): Promise<void> {
  const { error } = await clientOrThrow().from("decision_history").insert({
    user_id: userId,
    history_id: record.id,
    data: record as unknown as Json,
    created_at: record.createdAt,
  });
  if (error) throw error;
}

export async function upsertCloudHistoryForMigration(userId: string, record: DecisionHistoryRecord): Promise<void> {
  const { error } = await clientOrThrow().from("decision_history").upsert({
    user_id: userId,
    history_id: record.id,
    data: record as unknown as Json,
    created_at: record.createdAt,
  }, { onConflict: "user_id,history_id", ignoreDuplicates: true });
  if (error) throw error;
}

export async function deleteCloudHistory(userId: string, historyId: string): Promise<void> {
  const { error } = await clientOrThrow()
    .from("decision_history")
    .delete()
    .eq("user_id", userId)
    .eq("history_id", historyId);
  if (error) throw error;
}
