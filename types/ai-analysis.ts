import type {
  AnalysisConfidence,
  DimensionDataStatus,
  DimensionKey,
  Recommendation,
} from "./decision";
import type {
  CommuteMode,
  DecisionPriority,
  EducationNeed,
  EducationStage,
  PurchasePurpose,
} from "./buyer-preferences";

export const AI_ANALYSIS_SCHEMA_VERSION = 1 as const;

export type AIAnalysisStatus = "idle" | "loading" | "completed" | "error" | "stale";

export type AIInsightDimensionKey =
  | "commercial_amenities"
  | "daily_life_amenities"
  | "community_quality"
  | "liquidity"
  | "value_preservation";

export interface AIComparableTransactionContext {
  price: number;
  area: number;
  transactionDate: string;
  source: string;
}

export interface AIPropertyContext {
  propertyId: string;
  name: string | null;
  location: {
    city: string | null;
    district: string | null;
    address: string | null;
  };
  expectedTransactionPrice: number;
  listingPrice: number | null;
  area: number;
  layout: string | null;
  floor: string | null;
  orientation: string | null;
  deliveryYear: number | null;
  metroDistance: number | null;
  schoolInformation: string | null;
  propertyManagementInformation: string | null;
  comparableTransactions: AIComparableTransactionContext[];
}

export interface AIBuyerPreferencesContext {
  purchasePurpose: PurchasePurpose;
  maximumBudget: number;
  primaryWorkLocation: string | null;
  partnerWorkLocation: string | null;
  commuteMode: CommuteMode;
  idealCommuteMinutes: number | null;
  maxCommuteMinutes: number | null;
  educationNeed: EducationNeed;
  educationStages: EducationStage[];
  topPriorities: DecisionPriority[];
}

export interface AIDimensionContext {
  key: DimensionKey;
  score: number | null;
  status: DimensionDataStatus;
  finalWeight: number;
  evidence: string[];
  missingInputs: string[];
}

export interface AIDecisionContext {
  decisionVersion: string;
  propertyId: string;
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

export interface AIAnalysisContext {
  asOfDate: string;
  property: AIPropertyContext;
  preferences: AIBuyerPreferencesContext;
  decision: AIDecisionContext;
}

export interface AIAnalysisRequest {
  schemaVersion: typeof AI_ANALYSIS_SCHEMA_VERSION;
  locale: "zh-CN";
  inputSignature: string;
  context: AIAnalysisContext;
}

export interface AIAnalysis {
  summary: string;
  strengths: string[];
  tradeoffs: string[];
  confirmationQuestions: string[];
  dimensionInsights: Array<{
    key: AIInsightDimensionKey;
    status: "analyzed" | "insufficient_evidence";
    insight: string;
    basis: string[];
  }>;
  caveats: string[];
  disclaimer: string;
}

export type AIAnalysisErrorCode =
  | "INVALID_REQUEST"
  | "AI_NOT_CONFIGURED"
  | "AI_TIMEOUT"
  | "AI_PROVIDER_ERROR"
  | "INVALID_AI_OUTPUT";

export type AIAnalysisResponse =
  | {
      ok: true;
      analysis: AIAnalysis;
      metadata: {
        generatedAt: string;
        inputSignature: string;
        provider: "zhipu";
        model: string;
      };
    }
  | {
      ok: false;
      error: {
        code: AIAnalysisErrorCode;
        message: string;
        retryable: boolean;
      };
    };

export interface AIAnalysisStorage {
  schemaVersion: typeof AI_ANALYSIS_SCHEMA_VERSION;
  records: Array<{
    inputSignature: string;
    decisionVersion: string;
    asOfDate: string;
    status: Extract<AIAnalysisStatus, "completed" | "stale">;
    analysis: AIAnalysis;
    createdAt: string;
  }>;
}
