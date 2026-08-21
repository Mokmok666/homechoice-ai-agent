export const PURCHASE_PURPOSES = [
  "self_use",
  "self_use_and_value",
  "long_term_asset",
] as const;

export const COMMUTE_MODES = [
  "driving",
  "public_transit",
  "walking",
  "cycling",
  "flexible",
  "both",
  "not_important",
] as const;

export const SELECTABLE_COMMUTE_MODES = [
  "driving",
  "public_transit",
  "walking",
  "cycling",
  "flexible",
  "not_important",
] as const;

export const EDUCATION_NEEDS = [
  "none",
  "current",
  "future",
] as const;

export const EDUCATION_STAGES = [
  "kindergarten",
  "primary_school",
  "middle_school",
  "high_school",
] as const;

export const DECISION_PRIORITIES = [
  "commute",
  "price",
  "layout_and_space",
  "community_quality",
  "property_management",
  "education",
  "commercial_amenities",
  "public_transport",
  "liquidity",
  "value_preservation",
] as const;

export type PurchasePurpose = (typeof PURCHASE_PURPOSES)[number];
export type CommuteMode = (typeof COMMUTE_MODES)[number];
export type SelectableCommuteMode = (typeof SELECTABLE_COMMUTE_MODES)[number];
export type EducationNeed = (typeof EDUCATION_NEEDS)[number];
export type EducationStage = (typeof EDUCATION_STAGES)[number];
export type DecisionPriority = (typeof DECISION_PRIORITIES)[number];

export interface ConfirmedWorkLocation {
  poiId?: string;
  name: string;
  formattedAddress: string;
  province?: string;
  city?: string;
  district?: string;
  lng: number;
  lat: number;
  source: "amap";
  confirmedByUser: boolean;
  confirmedAt: string;
}

export interface BuyerPreferences {
  id: string;
  purchasePurpose: PurchasePurpose;
  maximumBudget: number;
  primaryWorkLocation: string;
  partnerWorkLocation: string | null;
  primaryWorkLocationConfirmed?: ConfirmedWorkLocation | null;
  partnerWorkLocationConfirmed?: ConfirmedWorkLocation | null;
  primaryCommuteMode?: SelectableCommuteMode;
  primaryIdealCommuteMinutes?: number | null;
  primaryMaxCommuteMinutes?: number | null;
  partnerCommuteMode?: SelectableCommuteMode | null;
  partnerIdealCommuteMinutes?: number | null;
  partnerMaxCommuteMinutes?: number | null;
  /** Legacy primary-commute mirrors retained for persisted data and existing consumers. */
  commuteMode: CommuteMode;
  idealCommuteMinutes: number | null;
  maxCommuteMinutes: number | null;
  educationNeed: EducationNeed;
  educationStages: EducationStage[];
  topPriorities: DecisionPriority[];
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedCommutePreference {
  workLocation: string;
  confirmedLocation?: ConfirmedWorkLocation;
  mode: SelectableCommuteMode;
  idealMinutes: number | null;
  maxMinutes: number | null;
}

function normalizeLegacyMode(mode: CommuteMode): SelectableCommuteMode {
  return mode === "both" ? "flexible" : mode;
}

export function resolvePrimaryCommutePreference(
  preferences: BuyerPreferences,
): ResolvedCommutePreference {
  return {
    workLocation: preferences.primaryWorkLocation.trim(),
    ...(preferences.primaryWorkLocationConfirmed?.confirmedByUser ? { confirmedLocation: preferences.primaryWorkLocationConfirmed } : {}),
    mode: preferences.primaryCommuteMode ?? normalizeLegacyMode(preferences.commuteMode),
    idealMinutes: preferences.primaryIdealCommuteMinutes ?? preferences.idealCommuteMinutes,
    maxMinutes: preferences.primaryMaxCommuteMinutes ?? preferences.maxCommuteMinutes,
  };
}

export function resolvePartnerCommutePreference(
  preferences: BuyerPreferences,
): ResolvedCommutePreference | null {
  const workLocation = preferences.partnerWorkLocation?.trim() ?? "";
  if (!workLocation) return null;
  const primary = resolvePrimaryCommutePreference(preferences);
  return {
    workLocation,
    ...(preferences.partnerWorkLocationConfirmed?.confirmedByUser ? { confirmedLocation: preferences.partnerWorkLocationConfirmed } : {}),
    mode: preferences.partnerCommuteMode ?? primary.mode,
    idealMinutes: preferences.partnerIdealCommuteMinutes ?? primary.idealMinutes,
    maxMinutes: preferences.partnerMaxCommuteMinutes ?? primary.maxMinutes,
  };
}

export type BuyerPreferencesInput = Omit<
  BuyerPreferences,
  "id" | "createdAt" | "updatedAt"
>;
