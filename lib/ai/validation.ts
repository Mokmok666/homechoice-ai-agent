import { AI_ANALYSIS_SCHEMA_VERSION, type AIAnalysisRequest, type AIAnalysisResponse } from "../../types/ai-analysis";
import { DECISION_PRIORITIES, EDUCATION_NEEDS, EDUCATION_STAGES, PURCHASE_PURPOSES, SELECTABLE_COMMUTE_MODES } from "../../types/buyer-preferences";
import { DIMENSION_KEYS } from "../../types/decision";
import { WEB_EVIDENCE_TARGET_DIMENSIONS } from "../web-evidence/types";

export type ValidationResult<T> = { success: true; data: T } | { success: false; errors: string[] };
const RECOMMENDATIONS = ["CONSIDER", "WAIT", "PASS"] as const;
const DIMENSION_STATUSES = ["known", "partial", "unknown"] as const;
const CONFIDENCE_LEVELS = ["provisional", "supported"] as const;
const ERROR_CODES = ["INVALID_REQUEST", "AI_NOT_CONFIGURED", "AI_TIMEOUT", "AI_PROVIDER_ERROR", "INVALID_AI_OUTPUT"] as const;
const FORBIDDEN_ANALYSIS_KEYS = new Set(["score", "matchscore", "overallscore", "ranking", "recommendation", "weight", "weights"]);
const INTERNAL_PRODUCT_LANGUAGE = /Top1|Top2|Decision Engine|排名第一|综合评分模型|AI判断|决策引擎认为|根据模型|当前确定性排序/i;
const INTERNAL_PENDING_LANGUAGE = /结构化事实|外部证据进行AI分析|未来结合.*AI分析/;

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function isFiniteNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value); }
function isNullableNumber(value: unknown): boolean { return value === null || isFiniteNumber(value); }
function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((item) => typeof item === "string"); }
function isOneOf<T extends readonly string[]>(value: unknown, values: T): value is T[number] { return typeof value === "string" && (values as readonly string[]).includes(value); }
function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function hasForbiddenAnalysisKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenAnalysisKey);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(([key, child]) => FORBIDDEN_ANALYSIS_KEYS.has(key.toLowerCase()) || hasForbiddenAnalysisKey(child));
}

function validatePreferences(value: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("context.preferences must be an object"); return; }
  if (!isOneOf(value.purchasePurpose, PURCHASE_PURPOSES)) errors.push("purchasePurpose is invalid");
  if (!isFiniteNumber(value.maximumBudget) || value.maximumBudget <= 0) errors.push("maximumBudget must be positive");
  if (!Array.isArray(value.topPriorities) || value.topPriorities.length !== 3 || !value.topPriorities.every((item) => isOneOf(item, DECISION_PRIORITIES))) errors.push("topPriorities is invalid");
  if (!isOneOf(value.educationNeed, EDUCATION_NEEDS)) errors.push("educationNeed is invalid");
  if (!Array.isArray(value.educationStages) || !value.educationStages.every((item) => isOneOf(item, EDUCATION_STAGES))) errors.push("educationStages is invalid");
  for (const key of ["primaryWorkplace", "partnerWorkplace"] as const) {
    const workplace = value[key];
    if (key === "partnerWorkplace" && workplace === null) continue;
    if (!isRecord(workplace) || !(workplace.label === null || typeof workplace.label === "string") || typeof workplace.confirmed !== "boolean" || !isOneOf(workplace.commuteMode, SELECTABLE_COMMUTE_MODES) || !isNullableNumber(workplace.idealCommuteMinutes) || !isNullableNumber(workplace.maxCommuteMinutes)) {
      errors.push(`${key} is invalid`);
    }
  }
}

function validateCandidate(value: unknown, index: number, errors: string[]): void {
  if (!isRecord(value) || !isRecord(value.property) || !isRecord(value.decision)) { errors.push(`candidates[${index}] is invalid`); return; }
  const property = value.property;
  const decision = value.decision;
  if (!isNonEmptyString(property.propertyId) || !isFiniteNumber(property.expectedTransactionPrice) || property.expectedTransactionPrice <= 0 || !isFiniteNumber(property.area) || property.area <= 0 || !isFiniteNumber(property.budgetDifference)) errors.push(`candidates[${index}].property is invalid`);
  if (!isNonEmptyString(decision.propertyId) || decision.propertyId !== property.propertyId || !Number.isInteger(decision.rank) || (decision.rank as number) !== index + 1 || !isNullableNumber(decision.matchScore) || !isOneOf(decision.recommendation, RECOMMENDATIONS) || !isOneOf(decision.analysisConfidence, CONFIDENCE_LEVELS) || typeof decision.provisional !== "boolean" || !isFiniteNumber(decision.dataCompletenessPercent)) errors.push(`candidates[${index}].decision is invalid`);
  if (!Array.isArray(decision.dimensions) || decision.dimensions.length !== DIMENSION_KEYS.length) {
    errors.push(`candidates[${index}].dimensions must contain all 15 dimensions`);
  } else {
    const keys = decision.dimensions.map((item) => isRecord(item) ? item.key : null);
    if (!DIMENSION_KEYS.every((key) => keys.includes(key))) errors.push(`candidates[${index}].dimensions are incomplete`);
    decision.dimensions.forEach((dimension, dimensionIndex) => {
      if (!isRecord(dimension) || !isOneOf(dimension.key, DIMENSION_KEYS) || !isNonEmptyString(dimension.label) || !isNullableNumber(dimension.score) || !isOneOf(dimension.status, DIMENSION_STATUSES) || !isFiniteNumber(dimension.finalWeight) || !Array.isArray(dimension.evidence) || !isStringArray(dimension.missingInputs)) errors.push(`candidates[${index}].dimensions[${dimensionIndex}] is invalid`);
    });
  }
  if (!(value.geoEvidence === null || isRecord(value.geoEvidence))) errors.push(`candidates[${index}].geoEvidence is invalid`);
  if (value.webEvidence !== null) {
    if (!isRecord(value.webEvidence) || typeof value.webEvidence.fetchedAt !== "string" || !Array.isArray(value.webEvidence.dimensions)) {
      errors.push(`candidates[${index}].webEvidence is invalid`);
    } else {
      value.webEvidence.dimensions.forEach((dimension, evidenceIndex) => {
        if (!isRecord(dimension) || !WEB_EVIDENCE_TARGET_DIMENSIONS.includes(dimension.dimensionKey as never) || !["verified", "partial", "unavailable"].includes(String(dimension.status)) || !(dimension.summary === null || typeof dimension.summary === "string") || !(dimension.interpretationConclusion === null || typeof dimension.interpretationConclusion === "string") || !isStringArray(dimension.supportingFacts) || !Array.isArray(dimension.facts)) {
          errors.push(`candidates[${index}].webEvidence.dimensions[${evidenceIndex}] is invalid`);
          return;
        }
        dimension.facts.forEach((fact, factIndex) => {
          if (!isRecord(fact) || !isNonEmptyString(fact.claim) || !isNonEmptyString(fact.sourceTitle) || !(fact.sourceDomain === null || typeof fact.sourceDomain === "string") || !["high", "medium", "low"].includes(String(fact.confidence)) || !(fact.transactionKind === null || ["transaction", "listing", "unknown"].includes(String(fact.transactionKind)))) {
            errors.push(`candidates[${index}].webEvidence.dimensions[${evidenceIndex}].facts[${factIndex}] is invalid`);
          }
        });
      });
    }
  }
}

function validateContext(value: unknown, errors: string[]): void {
  if (!isRecord(value)) { errors.push("context must be an object"); return; }
  if (!isNonEmptyString(value.asOfDate) || !/^\d{4}-\d{2}-\d{2}$/.test(value.asOfDate)) errors.push("asOfDate is invalid");
  if (!isNonEmptyString(value.decisionVersion) || !isNonEmptyString(value.authoritativeTopPropertyId)) errors.push("decision identity is invalid");
  const ranking = Array.isArray(value.ranking) && value.ranking.every(isNonEmptyString) ? value.ranking : null;
  if (!ranking || ranking.length === 0 || ranking[0] !== value.authoritativeTopPropertyId) errors.push("ranking is invalid");
  if (typeof value.rankingProvisional !== "boolean") errors.push("rankingProvisional is invalid");
  validatePreferences(value.preferences, errors);
  if (!Array.isArray(value.candidates) || value.candidates.length !== (ranking?.length ?? -1)) errors.push("candidates must match ranking");
  else {
    value.candidates.forEach((candidate, index) => validateCandidate(candidate, index, errors));
    const candidateIds = value.candidates.map((candidate) => isRecord(candidate) && isRecord(candidate.property) ? candidate.property.propertyId : null);
    if (!ranking?.every((id, index) => candidateIds[index] === id)) errors.push("candidate order must equal deterministic ranking");
  }
}

export function validateAIAnalysisRequest(value: unknown): ValidationResult<AIAnalysisRequest> {
  const errors: string[] = [];
  if (!isRecord(value)) return { success: false, errors: ["request must be an object"] };
  if (value.schemaVersion !== AI_ANALYSIS_SCHEMA_VERSION) errors.push("schemaVersion is unsupported");
  if (value.locale !== "zh-CN") errors.push("locale must be zh-CN");
  if (!isNonEmptyString(value.inputSignature)) errors.push("inputSignature is required");
  validateContext(value.context, errors);
  return errors.length ? { success: false, errors } : { success: true, data: value as unknown as AIAnalysisRequest };
}

function validateAnalysis(
  analysis: unknown,
  errors: string[],
  expectedTopPropertyId?: string,
  expectedTopPropertyName?: string,
  expectedAlternativeNames: string[] = [],
  requiresCommuteBoundaryNuance = false,
): void {
  if (!isRecord(analysis)) { errors.push("analysis must be an object"); return; }
  if (!hasOnlyKeys(analysis, ["topPropertyId", "topPropertyName", "decisionSummary", "pendingEvidence", "disclaimer"])) errors.push("analysis contains unexpected fields");
  if (hasForbiddenAnalysisKey(analysis)) errors.push("analysis must not contain scores, ranking, recommendation or weights");
  if (!isNonEmptyString(analysis.topPropertyId) || (expectedTopPropertyId && analysis.topPropertyId !== expectedTopPropertyId)) errors.push("analysis.topPropertyId must equal deterministic Top1");
  if (!isNonEmptyString(analysis.topPropertyName) || (expectedTopPropertyName && analysis.topPropertyName !== expectedTopPropertyName)) errors.push("analysis.topPropertyName must equal deterministic Top1 name");
  if (!isNonEmptyString(analysis.decisionSummary) || /[\r\n]/.test(analysis.decisionSummary)) {
    errors.push("analysis.decisionSummary must be one paragraph");
  } else {
    const decisionSummary = analysis.decisionSummary;
    const sentenceCount = (decisionSummary.match(/[。！？]/g) ?? []).length;
    if (sentenceCount < 3 || sentenceCount > 7) errors.push("analysis.decisionSummary sentence structure is unreasonable");
    if (decisionSummary.length < 80 || decisionSummary.length > 650) errors.push("analysis.decisionSummary length is unreasonable");
    if (INTERNAL_PRODUCT_LANGUAGE.test(decisionSummary)) errors.push("analysis.decisionSummary contains internal product language");
    if (expectedAlternativeNames.length > 0 && !expectedAlternativeNames.some((name) => decisionSummary.includes(name))) errors.push("analysis.decisionSummary must compare an authoritative alternative");
    if (requiresCommuteBoundaryNuance && /均.{0,8}(?:理想时间|理想通勤|理想范围)|(?:都|均)在.{0,6}理想/.test(decisionSummary)) errors.push("analysis.decisionSummary misstates commute threshold");
  }
  if (!isStringArray(analysis.pendingEvidence) || analysis.pendingEvidence.length > 3 || analysis.pendingEvidence.some((item) => INTERNAL_PRODUCT_LANGUAGE.test(item) || INTERNAL_PENDING_LANGUAGE.test(item)) || !isNonEmptyString(analysis.disclaimer)) errors.push("analysis evidence or disclaimer is invalid");
}

export function validateAIAnalysisResponse(
  value: unknown,
  expectedTopPropertyId?: string,
  expectedTopPropertyName?: string,
  expectedAlternativeNames: string[] = [],
  requiresCommuteBoundaryNuance = false,
): ValidationResult<AIAnalysisResponse> {
  const errors: string[] = [];
  if (!isRecord(value) || typeof value.ok !== "boolean") return { success: false, errors: ["response must contain boolean ok"] };
  if (value.ok) {
    validateAnalysis(value.analysis, errors, expectedTopPropertyId, expectedTopPropertyName, expectedAlternativeNames, requiresCommuteBoundaryNuance);
    const metadata = value.metadata;
    if (!isRecord(metadata) || !isNonEmptyString(metadata.generatedAt) || !isNonEmptyString(metadata.inputSignature) || metadata.provider !== "zhipu" || !isNonEmptyString(metadata.model)) errors.push("response metadata is invalid");
  } else {
    const error = value.error;
    if (!isRecord(error) || !isOneOf(error.code, ERROR_CODES) || !isNonEmptyString(error.message) || typeof error.retryable !== "boolean") errors.push("response error is invalid");
  }
  return errors.length ? { success: false, errors } : { success: true, data: value as unknown as AIAnalysisResponse };
}

export function isAIAnalysisRequest(value: unknown): value is AIAnalysisRequest { return validateAIAnalysisRequest(value).success; }
export function isAIAnalysisResponse(value: unknown): value is AIAnalysisResponse { return validateAIAnalysisResponse(value).success; }
