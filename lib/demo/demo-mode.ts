import { loadPersistedBuyerPreferences, type BuyerPreferencesLoadResult } from "@/lib/buyer-preferences-storage";
import { loadProperties } from "@/lib/property-storage";
import {
  createDemoBuyerPreferences,
  createDemoProperties,
  DEMO_PREFERENCES_ID,
} from "./demo-data";
import type { BuyerPreferences, BuyerPreferencesInput } from "@/types/buyer-preferences";
import type { Property } from "@/types/property";

export const DEMO_ACTIVE_STORAGE_KEY = "homechoice.demo.active";
export const DEMO_PREFERENCES_STORAGE_KEY = "homechoice.demo.preferences";
const DEMO_PREFERENCES_VERSION = 1;

interface DemoPreferencesEnvelope {
  version: typeof DEMO_PREFERENCES_VERSION;
  preferences: BuyerPreferences;
}

export function isDemoModeActive(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(DEMO_ACTIVE_STORAGE_KEY) === "true";
}

export async function hasPersistedUserInput(userId: string | null): Promise<boolean> {
  const [properties, preferences] = await Promise.all([
    loadProperties(userId),
    loadPersistedBuyerPreferences(userId),
  ]);
  return properties.length > 0 || preferences.status !== "empty";
}

function readDemoPreferences(): BuyerPreferences | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DEMO_PREFERENCES_STORAGE_KEY);
    if (!raw) return null;
    const envelope = JSON.parse(raw) as Partial<DemoPreferencesEnvelope>;
    const preferences = envelope.preferences;
    if (
      envelope.version !== DEMO_PREFERENCES_VERSION ||
      !preferences ||
      preferences.id !== DEMO_PREFERENCES_ID ||
      typeof preferences.maximumBudget !== "number" ||
      !Number.isFinite(preferences.maximumBudget) ||
      !Array.isArray(preferences.topPriorities) ||
      preferences.topPriorities.length !== 3
    ) return null;
    return preferences;
  } catch {
    return null;
  }
}

function writeDemoPreferences(preferences: BuyerPreferences): void {
  const envelope: DemoPreferencesEnvelope = { version: DEMO_PREFERENCES_VERSION, preferences };
  window.localStorage.setItem(DEMO_PREFERENCES_STORAGE_KEY, JSON.stringify(envelope));
}

export async function getEffectiveProperties(userId: string | null): Promise<Property[]> {
  return isDemoModeActive() ? createDemoProperties() : loadProperties(userId);
}

export async function getEffectiveBuyerPreferences(userId: string | null): Promise<BuyerPreferencesLoadResult> {
  if (!isDemoModeActive()) return loadPersistedBuyerPreferences(userId);
  return { status: "valid", preferences: readDemoPreferences() ?? createDemoBuyerPreferences() };
}

export function saveDemoBuyerPreferences(
  input: BuyerPreferencesInput,
  existingPreferences: BuyerPreferences | null,
): BuyerPreferences {
  const now = new Date().toISOString();
  const preferences: BuyerPreferences = {
    ...input,
    id: DEMO_PREFERENCES_ID,
    createdAt: existingPreferences?.createdAt ?? now,
    updatedAt: now,
  };
  writeDemoPreferences(preferences);
  return preferences;
}

export async function initializeDemoMode(): Promise<void> {
  writeDemoPreferences(createDemoBuyerPreferences());
  window.localStorage.setItem(DEMO_ACTIVE_STORAGE_KEY, "true");
}

export async function exitDemoMode(): Promise<void> {
  window.localStorage.removeItem(DEMO_PREFERENCES_STORAGE_KEY);
  window.localStorage.removeItem(DEMO_ACTIVE_STORAGE_KEY);
}
