import type { BuyerPreferences, DecisionPriority } from "./buyer-preferences";
import type { DecisionEngineResult, DimensionEvaluation, DimensionKey, Recommendation } from "./decision";
import type { PropertyGeoEvidence } from "./geo-evidence";
import type { Property } from "./property";
import type { PropertyWebEvidence, VerifiedEvidenceItem, VerifiedEvidenceSource } from "../lib/web-evidence/types";
import type { DecisionSignal, DecisionSignalComparison } from "./decision-signals";

export type EvidencePackComparisonRelation = "top_better" | "top_worse" | "equal" | "close" | "unknown";

export interface DecisionEvidencePackComparison {
  topCandidateId: string;
  alternativeId: string;
  dimensions: Array<{
    dimension: DimensionKey;
    topScore: number | null;
    alternativeScore: number | null;
    relation: EvidencePackComparisonRelation;
  }>;
}

export interface DecisionEvidencePackCandidate {
  property: Property;
  rank: number;
  overallScore: number | null;
  recommendation: Recommendation;
  dimensionResults: DimensionEvaluation[];
  amapEvidence: PropertyGeoEvidence | null;
  webEvidence: PropertyWebEvidence | null;
  scoreableWebEvidence: VerifiedEvidenceItem[];
  contextualVerifiedEvidence: VerifiedEvidenceItem[];
  sources: VerifiedEvidenceSource[];
  decisionSignals: DecisionSignal[];
  hardMismatches?: Array<{ dimension: DimensionKey; reason: string }>;
}

export interface DecisionEvidencePack {
  version: 1;
  createdAt: string;
  buyerContext: BuyerPreferences;
  priorities: Array<{ priority: DecisionPriority; rank: number }>;
  candidates: DecisionEvidencePackCandidate[];
  weights: DecisionEngineResult["weights"];
  intendedWeights?: DecisionEngineResult["weights"];
  effectiveWeights?: DecisionEngineResult["weights"];
  effectiveComparableDimensions?: DimensionKey[];
  ranking: string[];
  topCandidate: { propertyId: string; rank: 1; overallScore: number | null; recommendation: Recommendation };
  candidateComparisons: DecisionEvidencePackComparison[];
  signalComparisons: DecisionSignalComparison[];
}
