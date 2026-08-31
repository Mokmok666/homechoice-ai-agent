import type { DimensionKey } from "./decision";

export type DecisionSignalSource = "user_objective" | "user_reported" | "web" | "amap" | "deterministic";
export type DecisionSignalRole = "deterministic_scoring_input" | "supporting" | "contextual";
export type DecisionSignalStatus = "available" | "unknown" | "conflicting";
export type DecisionSignalComparisonRelation = "top_higher" | "top_lower" | "top_stronger" | "top_weaker" | "equal" | "unknown" | "conflicting";

export interface DecisionSignal {
  key: string;
  label: string;
  dimension: DimensionKey | null;
  role: DecisionSignalRole;
  scoringOwner: DimensionKey | null;
  source: DecisionSignalSource;
  provenanceLabel: string;
  status: DecisionSignalStatus;
  value: string | number | null;
  normalizedValue?: number;
  unit?: string;
  note?: string;
  externalValues?: Array<{ value: string | number; status: string; source: "web" }>;
}

export interface DecisionSignalComparison {
  key: string;
  label: string;
  dimension: DimensionKey | null;
  topCandidateId: string;
  alternativeId: string;
  topValue: string | number | null;
  alternativeValue: string | number | null;
  relation: DecisionSignalComparisonRelation;
  interpretationBoundary: string;
}
