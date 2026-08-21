import type { BuyerPreferences } from "./buyer-preferences";
import type { Property } from "./property";
import type { GeoEvidenceByProperty } from "./geo-evidence";

export const DIMENSION_KEYS = [
  "location_maturity",
  "commute",
  "public_transport",
  "commercial_amenities",
  "education",
  "daily_life_amenities",
  "layout_design",
  "space_match",
  "building_age",
  "community_quality",
  "property_management",
  "budget_match",
  "transaction_price_reasonableness",
  "liquidity",
  "value_preservation",
] as const;

export type DimensionKey = (typeof DIMENSION_KEYS)[number];
export type DimensionType = "fact" | "preference" | "ai";
export type DimensionDataStatus = "known" | "partial" | "unknown";
export type EvidenceStatus = "confirmed" | "ai_inferred" | "optional_confirmation";
export type EvidenceSource =
  | "buyer_preference"
  | "manual"
  | "confirmed_comparable"
  | "amap"
  | "web"
  | "derived";
export type AnalysisConfidence = "provisional" | "supported";
export type Recommendation = "CONSIDER" | "WAIT" | "PASS";

export interface EvidenceItem {
  id: string;
  title: string;
  category: EvidenceStatus;
  description: string;
  source: string;
}

export interface DecisionEvidence {
  source: EvidenceSource;
  quality: number;
  description: string;
}

export interface DimensionEvaluation {
  key: DimensionKey;
  score: number | null;
  status: DimensionDataStatus;
  baseWeight: number;
  finalWeight: number;
  evidenceQuality: number;
  evidence: DecisionEvidence[];
  missingInputs: string[];
}

export interface AIAnalysisProgress {
  completed: number;
  total: number;
  percent: number;
}

export interface DataCompletenessResult {
  percent: number;
  completed: number;
  total: number;
  missingFields: string[];
  sections: {
    basic: number;
    living: number;
    decision: number;
  };
}

export interface ConfidenceResult {
  dataCompletenessPercent: number;
  dataCompleteness: DataCompletenessResult;
  aiAnalysisProgress: AIAnalysisProgress;
  analysisConfidence: AnalysisConfidence;
  evidenceQualityPercent: number;
  recordedInputs: string[];
  aiPendingInputs: string[];
  improvementInputs: string[];
  evidenceItems: EvidenceItem[];
  invalidInputFields: string[];
}

export interface HardMismatch {
  dimension: DimensionKey;
  reason: string;
}

export interface PropertyDecisionResult {
  propertyId: string;
  overallScore: number | null;
  dimensions: DimensionEvaluation[];
  confidence: ConfidenceResult;
  recommendation: Recommendation;
  reasons: string[];
  decisionFactors: string[];
  hardMismatches: HardMismatch[];
  provisional: boolean;
}

export interface DecisionEngineInput {
  properties: Property[];
  preferences: BuyerPreferences;
  asOfDate: string;
  geoEvidenceByProperty?: GeoEvidenceByProperty;
}

export interface DecisionEngineResult {
  engineVersion: "decision-engine-v1";
  asOfDate: string;
  weights: Record<DimensionKey, number>;
  results: PropertyDecisionResult[];
  ranking: string[];
  rankingProvisional: boolean;
}
