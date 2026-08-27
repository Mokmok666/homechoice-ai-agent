import { getSupabaseClient } from "./client";
import type { Json } from "@/types/database";
import type { Property } from "@/types/property";

function clientOrThrow() {
  const client = getSupabaseClient();
  if (!client) throw new Error("SUPABASE_UNAVAILABLE");
  return client;
}

export async function listCloudProperties(userId: string): Promise<unknown[]> {
  const { data, error } = await clientOrThrow()
    .from("properties")
    .select("data")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data.map((row) => row.data);
}

export async function upsertCloudProperty(userId: string, property: Property): Promise<void> {
  const { error } = await clientOrThrow().from("properties").upsert({
    user_id: userId,
    property_id: property.id,
    data: property as unknown as Json,
    created_at: property.createdAt,
    updated_at: property.updatedAt,
  }, { onConflict: "user_id,property_id" });
  if (error) throw error;
}

export async function deleteCloudProperty(userId: string, propertyId: string): Promise<void> {
  const { error } = await clientOrThrow()
    .from("properties")
    .delete()
    .eq("user_id", userId)
    .eq("property_id", propertyId);
  if (error) throw error;
}
