import {
  AI_ANALYSIS_SCHEMA_VERSION,
  type AIAnalysisRequest,
  type AIAnalysisResponse,
} from "../../types/ai-analysis";
import {
  COMMUTE_MODES,
  DECISION_PRIORITIES,
  EDUCATION_NEEDS,
  EDUCATION_STAGES,
  PURCHASE_PURPOSES,
} from "../../types/buyer-preferences";
import { DIMENSION_KEYS } from "../../types/decision";

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: string[] };

const RECOMMENDATIONS = ["CONSIDER", "WAIT", "PASS"] as const;
const DIMENSION_STATUSES = ["known", "partial", "unknown"] as const;
const CONFIDENCE_LEVELS = ["provisional", "supported"] as const;
const INSIGHT_KEYS = [
  "commercial_amenities",
  "daily_life_amenities",
  "community_quality",
  "liquidity",
  "value_preservation",
] as const;
const ERROR_CODES = [
  "INVALID_REQUEST",
  "AI_NOT_CONFIGURED",
  "AI_TIMEOUT",
  "AI_PROVIDER_ERROR",
  "INVALID_AI_OUTPUT",
] as const;
const FORBIDDEN_ANALYSIS_KEYS = new Set([
  "score",
  "matchscore",
  "overallscore",
  "ranking",
  "recommendation",
  "weight",
  "weights",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || isFiniteNumber(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

function hasForbiddenAnalysisKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenAnalysisKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, child]) => FORBIDDEN_ANALYSIS_KEYS.has(key.toLowerCase()) || hasForbiddenAnalysisKey(child),
  );
}

function validateContext(context: unknown, errors: string[]): void {
  if (!isRecord(context)) {
    errors.push("context must be an object");
    return;
  }

  if (!isNonEmptyString(context.asOfDate) || !/^\d{4}-\d{2}-\d{2}$/.test(context.asOfDate)) {
    errors.push("context.asOfDate must use YYYY-MM-DD");
  }

  const property = context.property;
  if (!isRecord(property)) {
    errors.push("context.property must be an object");
  } else {
    if (!isNonEmptyString(property.propertyId)) errors.push("propertyId is required");
    if (!isNullableString(property.name)) errors.push("property.name must be a string or null");
    if (!isFiniteNumber(property.expectedTransactionPrice) || property.expectedTransactionPrice <= 0) {
      errors.push("property.expectedTransactionPrice must be positive");
    }
    if (!isFiniteNumber(property.area) || property.area <= 0) errors.push("property.area must be positive");
    if (!isNullableFiniteNumber(property.listingPrice)) errors.push("property.listingPrice is invalid");
    if (!isNullableFiniteNumber(property.deliveryYear)) errors.push("property.deliveryYear is invalid");
    if (!isNullableFiniteNumber(property.metroDistance)) errors.push("property.metroDistance is invalid");
    if (!isRecord(property.location)) {
      errors.push("property.location must be an object");
    } else if (
      !isNullableString(property.location.city) ||
      !isNullableString(property.location.district) ||
      !isNullableString(property.location.address)
    ) {
      errors.push("property.location contains invalid fields");
    }
    if (!Array.isArray(property.comparableTransactions)) {
      errors.push("property.comparableTransactions must be an array");
    } else {
      property.comparableTransactions.forEach((item, index) => {
        if (
          !isRecord(item) ||
          !isFiniteNumber(item.price) ||
          item.price <= 0 ||
          !isFiniteNumber(item.area) ||
          item.area <= 0 ||
          !isNonEmptyString(item.transactionDate) ||
          !isNonEmptyString(item.source)
        ) {
          errors.push(`property.comparableTransactions[${index}] is invalid`);
        }
      });
    }
  }

  const preferences = context.preferences;
  if (!isRecord(preferences)) {
    errors.push("context.preferences must be an object");
  } else {
    if (!isOneOf(preferences.purchasePurpose, PURCHASE_PURPOSES)) errors.push("purchasePurpose is invalid");
    if (!isFiniteNumber(preferences.maximumBudget) || preferences.maximumBudget <= 0) {
      errors.push("maximumBudget must be positive");
    }
    if (!isOneOf(preferences.commuteMode, COMMUTE_MODES)) errors.push("commuteMode is invalid");
    if (!isOneOf(preferences.educationNeed, EDUCATION_NEEDS)) errors.push("educationNeed is invalid");
    if (
      !Array.isArray(preferences.educationStages) ||
      !preferences.educationStages.every((item) => isOneOf(item, EDUCATION_STAGES))
    ) {
      errors.push("educationStages is invalid");
    }
    if (
      !Array.isArray(preferences.topPriorities) ||
      !preferences.topPriorities.every((item) => isOneOf(item, DECISION_PRIORITIES))
    ) {
      errors.push("topPriorities is invalid");
    }
  }

  const decision = context.decision;
  if (!isRecord(decision)) {
    errors.push("context.decision must be an object");
  } else {
    if (!isNonEmptyString(decision.decisionVersion)) errors.push("decisionVersion is required");
    if (!isNonEmptyString(decision.propertyId)) errors.push("decision.propertyId is required");
    if (!isNullableFiniteNumber(decision.matchScore)) errors.push("decision.matchScore is invalid");
    if (!isOneOf(decision.recommendation, RECOMMENDATIONS)) errors.push("recommendation is invalid");
    if (typeof decision.provisional !== "boolean") errors.push("decision.provisional must be boolean");
    if (!isOneOf(decision.analysisConfidence, CONFIDENCE_LEVELS)) errors.push("analysisConfidence is invalid");
    if (!isFiniteNumber(decision.dataCompletenessPercent)) errors.push("dataCompletenessPercent is invalid");
    if (!isStringArray(decision.reasons) || !isStringArray(decision.decisionFactors)) {
      errors.push("decision reasons or factors are invalid");
    }
    if (!Array.isArray(decision.dimensions)) {
      errors.push("decision.dimensions must be an array");
    } else {
      decision.dimensions.forEach((item, index) => {
        if (
          !isRecord(item) ||
          !isOneOf(item.key, DIMENSION_KEYS) ||
          !isNullableFiniteNumber(item.score) ||
          !isOneOf(item.status, DIMENSION_STATUSES) ||
          !isFiniteNumber(item.finalWeight) ||
          !isStringArray(item.evidence) ||
          !isStringArray(item.missingInputs)
        ) {
          errors.push(`decision.dimensions[${index}] is invalid`);
        }
      });
    }
  }
}

export function validateAIAnalysisRequest(value: unknown): ValidationResult<AIAnalysisRequest> {
  const errors: string[] = [];
  if (!isRecord(value)) return { success: false, errors: ["request must be an object"] };
  if (value.schemaVersion !== AI_ANALYSIS_SCHEMA_VERSION) errors.push("schemaVersion is unsupported");
  if (value.locale !== "zh-CN") errors.push("locale must be zh-CN");
  if (!isNonEmptyString(value.inputSignature)) errors.push("inputSignature is required");
  validateContext(value.context, errors);
  return errors.length === 0
    ? { success: true, data: value as unknown as AIAnalysisRequest }
    : { success: false, errors };
}

function validateAnalysis(analysis: unknown, errors: string[]): void {
  if (!isRecord(analysis)) {
    errors.push("analysis must be an object");
    return;
  }
  if (hasForbiddenAnalysisKey(analysis)) {
    errors.push("analysis must not contain scores, ranking, recommendation or weights");
  }
  if (!isNonEmptyString(analysis.summary)) errors.push("analysis.summary is required");
  if (
    !isStringArray(analysis.strengths) ||
    !isStringArray(analysis.tradeoffs) ||
    !isStringArray(analysis.confirmationQuestions) ||
    !isStringArray(analysis.caveats) ||
    !isNonEmptyString(analysis.disclaimer)
  ) {
    errors.push("analysis text collections are invalid");
  }
  if (!Array.isArray(analysis.dimensionInsights)) {
    errors.push("analysis.dimensionInsights must be an array");
  } else {
    analysis.dimensionInsights.forEach((item, index) => {
      if (
        !isRecord(item) ||
        !isOneOf(item.key, INSIGHT_KEYS) ||
        !isOneOf(item.status, ["analyzed", "insufficient_evidence"] as const) ||
        !isNonEmptyString(item.insight) ||
        !isStringArray(item.basis)
      ) {
        errors.push(`analysis.dimensionInsights[${index}] is invalid`);
      }
    });
  }
}

export function validateAIAnalysisResponse(value: unknown): ValidationResult<AIAnalysisResponse> {
  const errors: string[] = [];
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return { success: false, errors: ["response must contain boolean ok"] };
  }

  if (value.ok) {
    validateAnalysis(value.analysis, errors);
    const metadata = value.metadata;
    if (
      !isRecord(metadata) ||
      !isNonEmptyString(metadata.generatedAt) ||
      !isNonEmptyString(metadata.inputSignature) ||
      metadata.provider !== "zhipu" ||
      !isNonEmptyString(metadata.model)
    ) {
      errors.push("response metadata is invalid");
    }
  } else {
    const error = value.error;
    if (
      !isRecord(error) ||
      !isOneOf(error.code, ERROR_CODES) ||
      !isNonEmptyString(error.message) ||
      typeof error.retryable !== "boolean"
    ) {
      errors.push("response error is invalid");
    }
  }

  return errors.length === 0
    ? { success: true, data: value as unknown as AIAnalysisResponse }
    : { success: false, errors };
}

export function isAIAnalysisRequest(value: unknown): value is AIAnalysisRequest {
  return validateAIAnalysisRequest(value).success;
}

export function isAIAnalysisResponse(value: unknown): value is AIAnalysisResponse {
  return validateAIAnalysisResponse(value).success;
}
