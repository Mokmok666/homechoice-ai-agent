import {
  COMMUTE_MODES,
  DECISION_PRIORITIES,
  EDUCATION_NEEDS,
  EDUCATION_STAGES,
  PURCHASE_PURPOSES,
  SELECTABLE_COMMUTE_MODES,
  type BuyerPreferences,
  type BuyerPreferencesInput,
  type ConfirmedWorkLocation,
} from "@/types/buyer-preferences";

export const BUYER_PREFERENCES_STORAGE_KEY = "homechoice.buyer-preferences.v1";
const SCHEMA_VERSION = 1;
const LEGACY_EDUCATION_IMPORTANCE_LEVELS = [
  "none",
  "future",
  "important",
  "very_important",
] as const;

interface BuyerPreferencesEnvelope {
  schemaVersion: typeof SCHEMA_VERSION;
  preferences: BuyerPreferences;
}

export type BuyerPreferencesLoadResult =
  | { status: "empty" }
  | { status: "valid"; preferences: BuyerPreferences }
  | { status: "invalid"; message: string };

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && values.includes(value as T[number]);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalNullableFiniteNumber(value: unknown): boolean {
  return value === undefined || isNullableFiniteNumber(value);
}

function isConfirmedWorkLocation(value: unknown): value is ConfirmedWorkLocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.name === "string" && Boolean(item.name.trim()) &&
    typeof item.formattedAddress === "string" && Boolean(item.formattedAddress.trim()) &&
    (item.poiId === undefined || typeof item.poiId === "string") &&
    (item.province === undefined || typeof item.province === "string") &&
    (item.city === undefined || typeof item.city === "string") &&
    (item.district === undefined || typeof item.district === "string") &&
    typeof item.lng === "number" && Number.isFinite(item.lng) && item.lng >= -180 && item.lng <= 180 &&
    typeof item.lat === "number" && Number.isFinite(item.lat) && item.lat >= -90 && item.lat <= 90 &&
    item.source === "amap" && item.confirmedByUser === true &&
    typeof item.confirmedAt === "string" && Number.isFinite(Date.parse(item.confirmedAt));
}

function sanitizeOptionalLocations(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const sanitized = { ...(value as Record<string, unknown>) };
  if (Array.isArray(sanitized.topPriorities)) {
    sanitized.topPriorities = sanitized.topPriorities.map((priority) =>
      priority === "daily_life_amenities" ? "medical_amenities" : priority,
    );
  }
  if (!(sanitized.primaryWorkLocationConfirmed === undefined || sanitized.primaryWorkLocationConfirmed === null || isConfirmedWorkLocation(sanitized.primaryWorkLocationConfirmed))) {
    delete sanitized.primaryWorkLocationConfirmed;
  }
  if (!(sanitized.partnerWorkLocationConfirmed === undefined || sanitized.partnerWorkLocationConfirmed === null || isConfirmedWorkLocation(sanitized.partnerWorkLocationConfirmed))) {
    delete sanitized.partnerWorkLocationConfirmed;
  }
  return sanitized;
}

function isBuyerPreferences(value: unknown): value is BuyerPreferences {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<BuyerPreferences>;

  if (
    typeof item.id !== "string" ||
    !item.id ||
    !isOneOf(item.purchasePurpose, PURCHASE_PURPOSES) ||
    typeof item.maximumBudget !== "number" ||
    !Number.isFinite(item.maximumBudget) ||
    item.maximumBudget <= 0 ||
    typeof item.primaryWorkLocation !== "string" ||
    !(typeof item.partnerWorkLocation === "string" || item.partnerWorkLocation === null) ||
    !(item.primaryWorkLocationConfirmed === undefined || item.primaryWorkLocationConfirmed === null || isConfirmedWorkLocation(item.primaryWorkLocationConfirmed)) ||
    !(item.partnerWorkLocationConfirmed === undefined || item.partnerWorkLocationConfirmed === null || isConfirmedWorkLocation(item.partnerWorkLocationConfirmed)) ||
    !isOneOf(item.commuteMode, COMMUTE_MODES) ||
    !isNullableFiniteNumber(item.idealCommuteMinutes) ||
    !isNullableFiniteNumber(item.maxCommuteMinutes) ||
    !(item.primaryCommuteMode === undefined || isOneOf(item.primaryCommuteMode, SELECTABLE_COMMUTE_MODES)) ||
    !isOptionalNullableFiniteNumber(item.primaryIdealCommuteMinutes) ||
    !isOptionalNullableFiniteNumber(item.primaryMaxCommuteMinutes) ||
    !(item.partnerCommuteMode === undefined || item.partnerCommuteMode === null || isOneOf(item.partnerCommuteMode, SELECTABLE_COMMUTE_MODES)) ||
    !isOptionalNullableFiniteNumber(item.partnerIdealCommuteMinutes) ||
    !isOptionalNullableFiniteNumber(item.partnerMaxCommuteMinutes) ||
    !isOneOf(item.educationNeed, EDUCATION_NEEDS) ||
    !Array.isArray(item.educationStages) ||
    !item.educationStages.every((stage) => isOneOf(stage, EDUCATION_STAGES)) ||
    !Array.isArray(item.topPriorities) ||
    item.topPriorities.length !== 3 ||
    new Set(item.topPriorities).size !== item.topPriorities.length ||
    !item.topPriorities.every((priority) => isOneOf(priority, DECISION_PRIORITIES)) ||
    typeof item.createdAt !== "string" ||
    typeof item.updatedAt !== "string"
  ) {
    return false;
  }


  const primaryMode = item.primaryCommuteMode ?? (item.commuteMode === "both" ? "flexible" : item.commuteMode);
  const primaryIdeal = item.primaryIdealCommuteMinutes ?? item.idealCommuteMinutes;
  const primaryMaximum = item.primaryMaxCommuteMinutes ?? item.maxCommuteMinutes;

  if (primaryMode === "not_important") {
    if (primaryIdeal !== null || primaryMaximum !== null) return false;
  } else if (
    !item.primaryWorkLocation.trim() ||
    primaryIdeal === null ||
    primaryMaximum === null ||
    primaryIdeal < 0 ||
    primaryMaximum < primaryIdeal
  ) {
    return false;
  }


  if (item.partnerWorkLocation?.trim()) {
    const partnerMode = item.partnerCommuteMode ?? primaryMode;
    const partnerIdeal = item.partnerIdealCommuteMinutes ?? primaryIdeal;
    const partnerMaximum = item.partnerMaxCommuteMinutes ?? primaryMaximum;
    if (partnerMode === "not_important" || partnerIdeal === null || partnerMaximum === null || partnerIdeal < 0 || partnerMaximum < partnerIdeal) return false;
  }

  if (item.educationNeed === "none") return item.educationStages.length === 0;
  if (item.educationNeed === "current") return item.educationStages.length > 0;
  return true;
}

function migrateLegacyBuyerPreferences(value: unknown): BuyerPreferences | null {
  if (!value || typeof value !== "object") return null;
  const legacy = value as Record<string, unknown>;
  if (!isOneOf(legacy.educationImportance, LEGACY_EDUCATION_IMPORTANCE_LEVELS)) return null;

  const educationNeed = legacy.educationImportance === "none"
    ? "none"
    : legacy.educationImportance === "future"
      ? "future"
      : "current";
  const migrated: Record<string, unknown> = { ...legacy, educationNeed };
  delete migrated.educationImportance;
  return isBuyerPreferences(migrated) ? migrated : null;
}

export function loadBuyerPreferences(): BuyerPreferencesLoadResult {
  if (typeof window === "undefined") return { status: "empty" };

  try {
    const storedValue = window.localStorage.getItem(BUYER_PREFERENCES_STORAGE_KEY);
    if (storedValue === null) return { status: "empty" };
    const envelope = JSON.parse(storedValue) as Partial<BuyerPreferencesEnvelope>;
    if (envelope.schemaVersion !== SCHEMA_VERSION) {
      return {
        status: "invalid",
        message: "已保存的偏好数据格式无效。请重新填写；下次保存会覆盖这份数据。",
      };
    }
    const sanitizedPreferences = sanitizeOptionalLocations(envelope.preferences);
    if (isBuyerPreferences(sanitizedPreferences)) {
      return { status: "valid", preferences: sanitizedPreferences };
    }

    const migratedPreferences = migrateLegacyBuyerPreferences(envelope.preferences);
    if (migratedPreferences) {
      const migratedEnvelope: BuyerPreferencesEnvelope = {
        schemaVersion: SCHEMA_VERSION,
        preferences: migratedPreferences,
      };
      window.localStorage.setItem(
        BUYER_PREFERENCES_STORAGE_KEY,
        JSON.stringify(migratedEnvelope),
      );
      return { status: "valid", preferences: migratedPreferences };
    }

    return {
      status: "invalid",
      message: "已保存的偏好数据格式无效。请重新填写；下次保存会覆盖这份数据。",
    };
  } catch {
    return {
      status: "invalid",
      message: "已保存的偏好数据无法读取。请重新填写；下次保存会覆盖这份数据。",
    };
  }
}

function createId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `buyer-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function saveBuyerPreferences(
  input: BuyerPreferencesInput,
  existingPreferences: BuyerPreferences | null = null,
): BuyerPreferences {
  if (typeof window === "undefined") {
    throw new Error("偏好只能在浏览器中保存。");
  }

  const now = new Date().toISOString();
  const preferences: BuyerPreferences = {
    ...input,
    id: existingPreferences?.id ?? createId(),
    createdAt: existingPreferences?.createdAt ?? now,
    updatedAt: now,
  };
  const envelope: BuyerPreferencesEnvelope = {
    schemaVersion: SCHEMA_VERSION,
    preferences,
  };
  window.localStorage.setItem(BUYER_PREFERENCES_STORAGE_KEY, JSON.stringify(envelope));
  return preferences;
}
