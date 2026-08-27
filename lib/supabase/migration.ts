import { loadBuyerPreferences } from "@/lib/buyer-preferences-storage";
import { getDecisionHistory } from "@/lib/decision-history-storage";
import { getProperties, replaceLocalProperties } from "@/lib/property-storage";
import { listCloudHistory, upsertCloudHistoryForMigration } from "./history-repository";
import { getCloudPreferences, upsertCloudPreferences } from "./preferences-repository";
import { listCloudProperties, upsertCloudProperty } from "./property-repository";

export const SUPABASE_MIGRATION_KEY = "homechoice.supabase.migration.v1";

export async function migrateLocalStorageToSupabase(userId: string): Promise<void> {
  const migrationAlreadyComplete = window.localStorage.getItem(SUPABASE_MIGRATION_KEY) === "complete";
  const localProperties = getProperties();
  const localPreferences = loadBuyerPreferences();
  const localHistory = getDecisionHistory();

  const [cloudProperties, cloudPreferences, cloudHistory] = await Promise.all([
    listCloudProperties(userId),
    getCloudPreferences(userId),
    listCloudHistory(userId),
  ]);

  if (!migrationAlreadyComplete && cloudProperties.length === 0 && localProperties.length > 0) {
    await Promise.all(localProperties.map((property) => upsertCloudProperty(userId, property)));
  } else if (cloudProperties.length > 0) {
    replaceLocalProperties(cloudProperties);
  }

  if (!migrationAlreadyComplete && cloudPreferences === null && localPreferences.status === "valid") {
    await upsertCloudPreferences(userId, localPreferences.preferences);
  }

  if (!migrationAlreadyComplete && cloudHistory.length === 0 && localHistory.length > 0) {
    await Promise.all(localHistory.map((record) => upsertCloudHistoryForMigration(userId, record)));
  }

  window.localStorage.setItem(SUPABASE_MIGRATION_KEY, "complete");
}
