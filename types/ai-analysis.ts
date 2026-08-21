import type { AnalysisConfidence, DimensionDataStatus, DimensionKey, Recommendation } from "./decision";
import type { DecisionPriority, EducationNeed, EducationStage, PurchasePurpose, SelectableCommuteMode } from "./buyer-preferences";
import type { AMapRouteMode, CommuteAvailabilityStatus, GeoEvidenceQuality, GeoEvidenceStatus } from "./geo-evidence";

export const AI_ANALYSIS_SCHEMA_VERSION = 2 as const;
export type AIAnalysisStatus = "idle" | "loading" | "completed" | "error" | "stale";

export interface AIComparableTransactionContext { price: number; area: number; transactionDate: string; source: string }
export interface AIPropertyContext {
  propertyId: string;
  name: string | null;
  location: { city: string | null; district: string | null; address: string | null; confirmedLocationName: string | null };
  expectedTransactionPrice: number;
  listingPrice: number | null;
  budgetDifference: number;
  area: number;
  layout: string | null;
  floor: string | null;
  orientation: string | null;
  deliveryYear: number | null;
  schoolInformation: string | null;
  propertyManagementInformation: string | null;
  comparableTransactions: AIComparableTransactionContext[];
}

export interface AIWorkplaceContext {
  label: string | null;
  confirmed: boolean;
  commuteMode: SelectableCommuteMode;
  idealCommuteMinutes: number | null;
  maxCommuteMinutes: number | null;
}
export interface AIBuyerPreferencesContext {
  purchasePurpose: PurchasePurpose;
  maximumBudget: number;
  primaryWorkplace: AIWorkplaceContext;
  partnerWorkplace: AIWorkplaceContext | null;
  educationNeed: EducationNeed;
  educationStages: EducationStage[];
  topPriorities: DecisionPriority[];
}

export interface AIDimensionContext {
  key: DimensionKey;
  label: string;
  score: number | null;
  status: DimensionDataStatus;
  finalWeight: number;
  evidence: Array<{ source: string; quality: number; description: string }>;
  missingInputs: string[];
}
export interface AIDecisionContext {
  rank: number;
  propertyId: string;
  propertyName: string | null;
  matchScore: number | null;
  recommendation: Recommendation;
  provisional: boolean;
  analysisConfidence: AnalysisConfidence;
  dataCompletenessPercent: number;
  reasons: string[];
  decisionFactors: string[];
  hardMismatches: Array<{ dimension: DimensionKey; reason: string }>;
  dimensions: AIDimensionContext[];
  excludedInputFields: string[];
}

export interface AICommutePersonContext {
  destinationLabel: string;
  requestedMode: string;
  modeResults: Partial<Record<AMapRouteMode, { minutes: number; distanceMeters: number }>>;
  selectedMode: AMapRouteMode | null;
  selectedMinutes: number | null;
  idealCommuteMinutes: number | null;
  maxCommuteMinutes: number | null;
  status: CommuteAvailabilityStatus;
}
export interface AIGeoEvidenceContext {
  source: "amap";
  quality: GeoEvidenceQuality;
  status: GeoEvidenceStatus;
  publicTransport: { nearestStationName: string; nearestDistanceMeters: number; stationCountWithin1000m: number } | null;
  commercial: { countWithin1000m: number; hasMajorDestination: boolean; examples: string[] } | null;
  dailyLife: { supermarketCount: number; medicalCount: number; parkCount: number; examples: string[] } | null;
  commute: {
    primary: AICommutePersonContext | null;
    partner: AICommutePersonContext | null;
    familyCommuteScore: number | null;
    observation: string;
  } | null;
}
export interface AIWebEvidenceFactContext {
  claim: string;
  sourceTitle: string;
  sourceDomain: string | null;
  confidence: "high" | "medium" | "low";
  transactionKind: "transaction" | "listing" | "unknown" | null;
}
export interface AIWebDimensionEvidenceContext {
  dimensionKey: DimensionKey;
  status: "verified" | "partial" | "unavailable";
  summary: string | null;
  interpretationConclusion: string | null;
  supportingFacts: string[];
  facts: AIWebEvidenceFactContext[];
}
export interface AIWebEvidenceContext {
  fetchedAt: string;
  dimensions: AIWebDimensionEvidenceContext[];
}
export interface AICandidateDecisionContext {
  property: AIPropertyContext;
  decision: AIDecisionContext;
  geoEvidence: AIGeoEvidenceContext | null;
  webEvidence: AIWebEvidenceContext | null;
}
export interface AIAnalysisContext {
  asOfDate: string;
  decisionVersion: string;
  authoritativeTopPropertyId: string;
  ranking: string[];
  rankingProvisional: boolean;
  preferences: AIBuyerPreferencesContext;
  candidates: AICandidateDecisionContext[];
}
export interface AIAnalysisRequest {
  schemaVersion: typeof AI_ANALYSIS_SCHEMA_VERSION;
  locale: "zh-CN";
  inputSignature: string;
  context: AIAnalysisContext;
}
export interface AIAnalysis {
  topPropertyId: string;
  topPropertyName: string;
  decisionSummary: string;
  pendingEvidence: string[];
  disclaimer: string;
}
export type AIAnalysisErrorCode = "INVALID_REQUEST" | "AI_NOT_CONFIGURED" | "AI_TIMEOUT" | "AI_PROVIDER_ERROR" | "INVALID_AI_OUTPUT";
export type AIAnalysisResponse =
  | { ok: true; analysis: AIAnalysis; metadata: { generatedAt: string; inputSignature: string; provider: "zhipu"; model: string } }
  | { ok: false; error: { code: AIAnalysisErrorCode; message: string; retryable: boolean } };
export interface AIAnalysisStorage {
  schemaVersion: typeof AI_ANALYSIS_SCHEMA_VERSION;
  records: Array<{ inputSignature: string; decisionVersion: string; asOfDate: string; status: Extract<AIAnalysisStatus, "completed" | "stale">; analysis: AIAnalysis; createdAt: string }>;
}
