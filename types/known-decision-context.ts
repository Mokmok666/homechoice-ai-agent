import type { DecisionPriority } from "./buyer-preferences";
import type { DimensionDataStatus, DimensionKey, Recommendation } from "./decision";
import type { DecisionSignal } from "./decision-signals";
import type { PropertyGeoEvidence } from "./geo-evidence";
import type { VerifiedEvidenceItem } from "../lib/web-evidence/types";

export interface KnownDecisionDimension {
  dimension: DimensionKey;
  label: string;
  score: number;
  status: Exclude<DimensionDataStatus, "unknown">;
  intendedWeight: number;
  effectiveWeight: number;
  evidence: Array<{ source: string; quality: number; description: string }>;
}

export interface KnownDecisionCandidate {
  propertyId: string;
  propertyName: string;
  rank: number;
  overallScore: number | null;
  recommendation: Recommendation;
  propertyFacts: {
    expectedTransactionPrice: number;
    listingPrice: number | null;
    area: number;
    layout: string;
    deliveryYear: number | null;
    city: string;
    district: string;
  };
  comparableDimensions: KnownDecisionDimension[];
  structuredSignals: DecisionSignal[];
  amapEvidence: Partial<PropertyGeoEvidence> | null;
  verifiedWebEvidence: VerifiedEvidenceItem[];
  partialWebEvidence: VerifiedEvidenceItem[];
}

export interface KnownDecisionFactor {
  dimension: DimensionKey;
  label: string;
  priorityRank: 1 | 2 | 3 | null;
  effectiveWeight: number;
  topScore: number;
  alternativeScore: number | null;
  relation: "top_better" | "top_worse" | "equal" | "close" | "single_candidate";
  impact: number;
}

export interface KnownDecisionAttention {
  dimension: DimensionKey;
  label: string;
  reason: string;
  priorityRank: 1 | 2 | 3 | null;
  kind: "material_uncertainty" | "hard_constraint";
}

export interface KnownDecisionContext {
  version: 1;
  buyer: {
    purchasePurpose: string;
    maximumBudget: number;
    originalTop3: DecisionPriority[];
    usableTop3: Array<{ priority: DecisionPriority; rank: 1 | 2 | 3; dimensions: DimensionKey[] }>;
    educationNeed: string;
  };
  ranking: string[];
  authoritativeTop1: { propertyId: string; propertyName: string; score: number | null; recommendation: Recommendation };
  intendedWeights: Record<DimensionKey, number>;
  effectiveWeights: Record<DimensionKey, number>;
  effectiveComparableDimensions: DimensionKey[];
  candidates: KnownDecisionCandidate[];
  decisiveKnownFactors: KnownDecisionFactor[];
  attentionCandidates: KnownDecisionAttention[];
  rankingIsClose: boolean;
}
