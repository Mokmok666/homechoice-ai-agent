export const PURCHASE_PURPOSES = [
  "self_use",
  "self_use_and_value",
  "long_term_asset",
] as const;

export const COMMUTE_MODES = [
  "driving",
  "public_transit",
  "both",
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
export type EducationNeed = (typeof EDUCATION_NEEDS)[number];
export type EducationStage = (typeof EDUCATION_STAGES)[number];
export type DecisionPriority = (typeof DECISION_PRIORITIES)[number];

export interface BuyerPreferences {
  id: string;
  purchasePurpose: PurchasePurpose;
  maximumBudget: number;
  primaryWorkLocation: string;
  partnerWorkLocation: string | null;
  commuteMode: CommuteMode;
  idealCommuteMinutes: number | null;
  maxCommuteMinutes: number | null;
  educationNeed: EducationNeed;
  educationStages: EducationStage[];
  topPriorities: DecisionPriority[];
  createdAt: string;
  updatedAt: string;
}

export type BuyerPreferencesInput = Omit<
  BuyerPreferences,
  "id" | "createdAt" | "updatedAt"
>;
