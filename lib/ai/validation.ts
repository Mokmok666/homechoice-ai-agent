import {
  AI_ANALYSIS_SCHEMA_VERSION,
  type AIAnalysisRequest,
  type AIAnalysisResponse,
  type AICandidateComparisonFacts,
  type AIComparisonRelation,
} from "../../types/ai-analysis";
import { DECISION_PRIORITIES, EDUCATION_NEEDS, EDUCATION_STAGES, PURCHASE_PURPOSES, SELECTABLE_COMMUTE_MODES } from "../../types/buyer-preferences";
import { DIMENSION_KEYS, type DimensionKey } from "../../types/decision";
import { WEB_EVIDENCE_TARGET_DIMENSIONS } from "../web-evidence/types";
import type { DecisionPriority } from "../../types/buyer-preferences";
import type { DecisionEvidencePack } from "../../types/decision-evidence-pack";
import type { KnownDecisionContext } from "../../types/known-decision-context";
import { createAIInputSignature } from "./signature";
import { buildDecisionSignalComparisons, buildPropertyDecisionSignals } from "../decision-signals";
import { calculateEffectiveWeights, getPriorityDimensions } from "../decision/weights";
import { buildKnownDecisionContext } from "./known-decision-context";

export type ValidationResult<T> = { success: true; data: T } | { success: false; errors: string[] };
const RECOMMENDATIONS = ["CONSIDER", "WAIT", "PASS"] as const;
const DIMENSION_STATUSES = ["known", "partial", "unknown"] as const;
const CONFIDENCE_LEVELS = ["provisional", "supported"] as const;
const ERROR_CODES = ["INVALID_REQUEST", "AI_NOT_CONFIGURED", "AI_TIMEOUT", "AI_PROVIDER_ERROR", "INVALID_AI_OUTPUT"] as const;
const FORBIDDEN_ANALYSIS_KEYS = new Set(["score", "matchscore", "overallscore", "ranking", "recommendation", "weight", "weights"]);
const INTERNAL_PRODUCT_LANGUAGE = /Top1|Top2|Decision Engine|排名第一|综合评分模型|AI判断|决策引擎认为|根据模型|当前确定性排序|Evidence Gap|Narrative Facts|candidateComparisons|comparisonFacts|requiredFacts|nextStepFacts|prohibitedClaims|allowedMeaning|relationMeaning|TOP1_BETTER|TOP1_WORSE(?:_BUT_WITHIN_TARGET)?|UNKNOWN|EQUAL|CLOSE|validation|dimension key|internal score type|[a-z]+_[a-z_]+/i;
const INTERNAL_PENDING_LANGUAGE = /结构化事实|外部证据进行AI分析|未来结合.*AI分析/;
const ABSOLUTE_NEGATIVE_LANGUAGE = /不足|较差|明显弱|缺乏|短板|表现差|配套弱|品质不好/;
const UNSUPPORTED_POSITIVE_LANGUAGE = /优秀|良好|较好|很好|更强|更优|更好|优势|领先|成熟|完善|出色|表现好/;
const COMPARISON_RELATIONS = ["TOP1_BETTER", "TOP1_WORSE", "TOP1_WORSE_BUT_WITHIN_TARGET", "EQUAL", "CLOSE", "UNKNOWN"] as const;
const SCORE_COMPARISON_RELATIONS = ["TOP1_BETTER", "TOP1_WORSE", "EQUAL", "CLOSE", "UNKNOWN"] as const;
const COMMUTE_LANGUAGE = /通勤|路程|上下班/;
const COMMUTE_ADVANTAGE_LANGUAGE = /更短|更快|短(?:约)?\d+(?:\.\d+)?分钟|更便利|更匹配|更优|优势|领先|优于/;
const NEGATED_ADVANTAGE_LANGUAGE = /没有.{0,8}优势|并无.{0,8}优势|不具备.{0,8}优势|不能.{0,8}(?:称为|视为).{0,8}优势|不应.{0,8}(?:称为|视为).{0,8}优势/;
const RELATIVE_INEQUALITY_LANGUAGE = /略逊|逊于|不如|优于|领先于|更强|更弱|更好|更差|更便利|优势更明显|明显优势/;
const CANDIDATE_ADVANTAGE_LANGUAGE = /更佳|更优|更强|更好|更便利|更匹配|略胜|略有优势|具有优势|优势明显|领先|优于|得分更高/;
const BUILDING_AREA_RELATIONS = ["TOP1_LARGER", "TOP1_SMALLER", "EQUAL", "UNKNOWN"] as const;
const SPACE_MATCH_CONCLUSION_LANGUAGE = /空间(?:需求)?匹配(?:度)?(?:更|较|略)?(?:优|高|好)|空间匹配(?:方面)?(?:表现)?(?:良好|较好|不错|有优势|无短板)|空间更匹配|更(?:符合|满足).{0,10}(?:家庭|您的|你的)?空间需求|满足(?:了)?(?:您的|你的|家庭).{0,10}空间需求|空间方面.{0,5}略胜|空间(?:更)?适合(?:您|家庭)|空间优势明显|居住空间更适合|(?:面积|平方米).{0,16}(?:更满足|满足.{0,6}需求|使.{0,6}更适合)|更大的面积.{0,12}(?:更适合|更匹配|满足)/;
const LAYOUT_CONCLUSION_LANGUAGE = /户型(?:设计)?(?:更好|更优|更合理|表现良好|较好|符合.{0,8}需求)|(?:空间)?布局(?:更好|更优|更合理|表现良好|较好|符合.{0,8}需求)|使用率更高|居住体验更好/;
const UNCERTAINTY_OR_NEGATION_LANGUAGE = /不能|无法|尚不能|尚无法|暂不能|不代表|并不意味着|不可|尚未明确|证据不足|暂无法判断/;
const CAUTIOUS_EVIDENCE_LANGUAGE = /现有公开资料|目前可查资料|部分证据|初步|倾向|可能|仍需|尚待|待核实|待确认|信息不足|证据不足|来源存在冲突/;
const DECISIVE_LANGUAGE = /压倒性|遥遥领先|大幅领先|显著胜出|毫无悬念|明显碾压/;
const PRIORITY_LANGUAGE: Record<DecisionPriority, RegExp> = {
  commute: /通勤|上下班|路线时间/,
  price: /预算|价格|预期成交价|资金余量/,
  layout_and_space: /户型|空间|面积|房间/,
  community_quality: /小区品质|社区品质|容积率|绿化率|居住密度|小区环境/,
  property_management: /物业|管理服务/,
  education: /教育|学校|学位|入学/,
  commercial_amenities: /商业配套|商业体|商场|购物中心|商业综合体/,
  medical_amenities: /医疗配套|医院|医疗可达性/,
  public_transport: /公共交通|地铁|公交/,
  liquidity: /流动性|挂牌周期|成交活跃|市场供给/,
  value_preservation: /长期价值|保值|价值稳定/,
};
const SUMMARY_REASON_LANGUAGE = [
  /通勤|上下班|路线时间/,
  /预算|预期成交价|资金余量/,
  /户型|空间|面积|房间/,
  /小区品质|社区品质|小区环境|居住密度/,
  /物业|管理服务/,
  /商业配套|商业体|商场|购物中心|商业综合体/,
  /医疗配套|正规医院|医院可达性/,
  /公共交通|地铁|公交/,
  /交付|房龄|楼龄/,
] as const;
const SUMMARY_CONCRETE_DETAIL_LANGUAGE = /\d|你记录的|现场观察|预期成交价|挂牌价|交付|房龄|楼龄|建筑面积|㎡|[一二三四五六]房|商业体|商场|购物中心|正规医院|地铁站|公交站/;

export interface AINarrativeConsistencyConstraint {
  dimensions: Array<{ key: DimensionKey; label: string; score: number | null; status: "known" | "partial" | "unknown" }>;
  educationNeed: "none" | "current" | "future";
  comparisons?: AICandidateComparisonFacts | null;
  topPropertyName?: string;
  evidencePack?: DecisionEvidencePack;
  effectivePriorities?: DecisionPriority[];
  requireEvidenceGroundedStructure?: boolean;
  knownDecisionContext?: KnownDecisionContext;
}

function hasUnsupportedUnknownConclusion(text: string, language: RegExp): boolean {
  return text
    .split(/[。！？；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .some((clause) => language.test(clause) && !UNCERTAINTY_OR_NEGATION_LANGUAGE.test(clause));
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function visibleTextLength(value: string): number { return Array.from(value.replace(/\s/gu, "")).length; }
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

function normalizeCandidateName(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(/[\p{P}\p{S}\s]/gu, "");
}

function isSameCandidateName(actual: string, expected: string): boolean {
  return normalizeCandidateName(actual) === normalizeCandidateName(expected);
}

function referencesCandidateName(text: string, candidateName: string): boolean {
  const normalizedText = normalizeCandidateName(text);
  const normalizedName = normalizeCandidateName(candidateName);
  if (!normalizedName) return false;
  if (normalizedText.includes(normalizedName)) return true;

  const explicitSegments = candidateName
    .normalize("NFKC")
    .split(/[\s·•・:：/／|｜—–()（）\[\]【】]+/u)
    .map(normalizeCandidateName)
    .filter((segment) => segment.length >= 4);
  if (explicitSegments.some((segment) => normalizedText.includes(segment))) return true;

  const coreSuffix = normalizedName.length > 4 ? normalizedName.slice(-4) : "";
  return coreSuffix.length >= 4 && normalizedText.includes(coreSuffix);
}

function dimensionLanguage(dimensionKey: string, label: string): RegExp {
  if (dimensionKey === "commute") return COMMUTE_LANGUAGE;
  if (dimensionKey === "commercial_amenities") return /商业配套|商业体|商场|购物中心|商业综合体/;
  if (dimensionKey === "medical_amenities") return /医疗配套|正规医院|医院可达性/;
  return new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

function hasTop1CommuteAdvantageClaim(text: string, topPropertyName: string): boolean {
  return text
    .split(/[。！？；\n，,]+/)
    .map((item) => item.trim())
    .filter((item) => COMMUTE_LANGUAGE.test(item) && referencesCandidateName(item, topPropertyName))
    .some((item) => COMMUTE_ADVANTAGE_LANGUAGE.test(item) && !NEGATED_ADVANTAGE_LANGUAGE.test(item));
}

function hasCandidateDimensionAdvantageClaim(text: string, candidateName: string, language: RegExp): boolean {
  return text
    .split(/[。！？；\n，,]+/)
    .map((item) => item.trim())
    .filter((item) => language.test(item) && referencesCandidateName(item, candidateName))
    .some((item) => CANDIDATE_ADVANTAGE_LANGUAGE.test(item) && !NEGATED_ADVANTAGE_LANGUAGE.test(item));
}

function validateRelativeComparisonConsistency(
  decisionSummary: string,
  comparisons: AICandidateComparisonFacts,
  topPropertyName: string,
  errors: string[],
): void {
  const candidateNames = [topPropertyName, comparisons.primaryAlternativeName].filter((name): name is string => Boolean(name));
  if (
    (comparisons.commute.relation === "TOP1_WORSE" || comparisons.commute.relation === "TOP1_WORSE_BUT_WITHIN_TARGET")
    && hasTop1CommuteAdvantageClaim(decisionSummary, topPropertyName)
  ) {
    errors.push("analysis.decisionSummary reverses deterministic commute comparison");
  }

  const clauses = decisionSummary.split(/[。！？；\n]+/).map((item) => item.trim()).filter(Boolean);
  const commuteClauses = clauses.filter((clause) => COMMUTE_LANGUAGE.test(clause));
  if (
    (comparisons.commute.relation === "TOP1_WORSE" || comparisons.commute.relation === "TOP1_WORSE_BUT_WITHIN_TARGET")
    && commuteClauses.some((clause) => /相当|基本一致|接近|差异有限/.test(clause) && candidateNames.every((name) => referencesCandidateName(clause, name)))
  ) {
    errors.push("analysis.decisionSummary treats a worse commute as equal");
  }
  if (
    comparisons.commute.top1TargetStatus === "WITHIN_IDEAL"
    && commuteClauses.some((clause) => /(?:高于|超过|超出|略高于).{0,8}理想/.test(clause))
  ) {
    errors.push("analysis.decisionSummary contradicts commute ideal threshold");
  }
  if (
    comparisons.budgetMatch.relation !== "EQUAL"
    && comparisons.budgetMatch.relation !== "CLOSE"
    && clauses.some((clause) => /预算|预期成交价|资金余量/.test(clause) && /表现相当|基本相当|差异有限|基本一致/.test(clause))
  ) {
    errors.push("analysis.decisionSummary treats a material budget difference as equal");
  }
  if (
    comparisons.primaryAlternativeName
    && comparisons.budgetMatch.top2BudgetMargin >= 0
    && clauses.some((clause) => referencesCandidateName(clause, comparisons.primaryAlternativeName!) && /超出.{0,8}预算|超预算/.test(clause))
  ) {
    errors.push("analysis.decisionSummary contradicts alternative budget boundary");
  }
  for (const dimension of comparisons.dimensions) {
    const language = dimensionLanguage(dimension.dimensionKey, dimension.label);
    if (
      dimension.relation === "TOP1_BETTER"
      && comparisons.primaryAlternativeName
      && hasCandidateDimensionAdvantageClaim(decisionSummary, comparisons.primaryAlternativeName, language)
    ) {
      errors.push(`analysis.decisionSummary reverses deterministic ${dimension.label} comparison`);
      continue;
    }
    if (
      dimension.relation === "TOP1_WORSE"
      && hasCandidateDimensionAdvantageClaim(decisionSummary, topPropertyName, language)
    ) {
      errors.push(`analysis.decisionSummary reverses deterministic ${dimension.label} comparison`);
      continue;
    }
    if (dimension.relation !== "EQUAL" && dimension.relation !== "UNKNOWN") continue;
    const contradictory = clauses.some((clause) =>
      language.test(clause)
      && candidateNames.some((name) => referencesCandidateName(clause, name))
      && RELATIVE_INEQUALITY_LANGUAGE.test(clause));
    if (contradictory) {
      errors.push(`analysis.decisionSummary makes unsupported ${dimension.relation.toLowerCase()} ${dimension.label} comparison`);
    }
  }
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

function expectedScoreRelation(top1Score: number | null, top2Score: number | null): Exclude<AIComparisonRelation, "TOP1_WORSE_BUT_WITHIN_TARGET"> {
  if (top1Score === null || top2Score === null) return "UNKNOWN";
  const difference = top1Score - top2Score;
  if (difference === 0) return "EQUAL";
  if (Math.abs(difference) < 5) return "CLOSE";
  return difference > 0 ? "TOP1_BETTER" : "TOP1_WORSE";
}

function validateCandidateComparisons(value: unknown, candidates: unknown[], errors: string[]): void {
  if (candidates.length < 2) {
    if (value !== null) errors.push("candidateComparisons must be null for a single candidate");
    return;
  }
  const top1Candidate = isRecord(candidates[0]) ? candidates[0] : null;
  const top1 = top1Candidate && isRecord(top1Candidate.decision) ? top1Candidate.decision : null;
  const top1Property = top1Candidate && isRecord(top1Candidate.property) ? top1Candidate.property : null;
  const top2Candidate = isRecord(candidates[1]) ? candidates[1] : null;
  const top2 = top2Candidate && isRecord(top2Candidate.decision) ? top2Candidate.decision : null;
  const top2Property = top2Candidate && isRecord(top2Candidate.property) ? top2Candidate.property : null;
  if (!isRecord(value) || !top1 || !top2 || !top1Property || !top2Property) {
    errors.push("candidateComparisons is invalid");
    return;
  }
  if (
    value.primaryAlternativeId !== top2Property.propertyId
    || !(value.primaryAlternativeName === null || typeof value.primaryAlternativeName === "string")
    || (typeof top2Property.name === "string" && typeof value.primaryAlternativeName === "string" && !isSameCandidateName(value.primaryAlternativeName, top2Property.name))
  ) {
    errors.push("candidateComparisons alternative must equal candidates[1]");
  }

  if (!Array.isArray(value.dimensions) || value.dimensions.length !== DIMENSION_KEYS.length) {
    errors.push("candidateComparisons.dimensions must contain all 15 dimensions");
  } else {
    const top1Dimensions = new Map(
      Array.isArray(top1.dimensions)
        ? top1.dimensions.flatMap((dimension) => isRecord(dimension) && isOneOf(dimension.key, DIMENSION_KEYS) ? [[dimension.key, dimension] as const] : [])
        : [],
    );
    const top2Dimensions = new Map(
      Array.isArray(top2.dimensions)
        ? top2.dimensions.flatMap((dimension) => isRecord(dimension) && isOneOf(dimension.key, DIMENSION_KEYS) ? [[dimension.key, dimension] as const] : [])
        : [],
    );
    value.dimensions.forEach((dimension, index) => {
      if (!isRecord(dimension) || !isOneOf(dimension.dimensionKey, DIMENSION_KEYS) || !isNonEmptyString(dimension.label) || !isOneOf(dimension.relation, SCORE_COMPARISON_RELATIONS) || !isNullableNumber(dimension.top1Score) || !isNullableNumber(dimension.top2Score)) {
        errors.push(`candidateComparisons.dimensions[${index}] is invalid`);
        return;
      }
      const expectedTop1 = top1Dimensions.get(dimension.dimensionKey)?.score;
      const expectedTop2 = top2Dimensions.get(dimension.dimensionKey)?.score;
      const expectedRelation = dimension.dimensionKey === "budget_match"
        && isFiniteNumber(top1Property.expectedTransactionPrice)
        && isFiniteNumber(top2Property.expectedTransactionPrice)
        ? top1Property.expectedTransactionPrice === top2Property.expectedTransactionPrice
          ? "EQUAL"
          : Math.abs(top1Property.expectedTransactionPrice - top2Property.expectedTransactionPrice) <= 1
            ? "CLOSE"
            : top1Property.expectedTransactionPrice < top2Property.expectedTransactionPrice ? "TOP1_BETTER" : "TOP1_WORSE"
        : expectedScoreRelation(dimension.top1Score as number | null, dimension.top2Score as number | null);
      if (dimension.top1Score !== expectedTop1 || dimension.top2Score !== expectedTop2 || dimension.relation !== expectedRelation) {
        errors.push(`candidateComparisons.dimensions[${index}] contradicts candidate scores`);
      }
    });
  }

  const commute = value.commute;
  if (!isRecord(commute) || !isOneOf(commute.relation, COMPARISON_RELATIONS) || !["WITHIN_IDEAL", "WITHIN_MAX", "OUTSIDE_MAX", "UNKNOWN"].includes(String(commute.top1TargetStatus)) || !["top1PrimaryMinutes", "top1PartnerMinutes", "top2PrimaryMinutes", "top2PartnerMinutes", "primaryIdealMinutes", "primaryMaxMinutes", "partnerIdealMinutes", "partnerMaxMinutes"].every((key) => isNullableNumber(commute[key]))) {
    errors.push("candidateComparisons.commute is invalid");
  }
  const budget = value.budgetMatch;
  if (!isRecord(budget) || !isOneOf(budget.relation, SCORE_COMPARISON_RELATIONS) || !["maximumBudget", "top1ExpectedTransactionPrice", "top2ExpectedTransactionPrice", "top1BudgetMargin", "top2BudgetMargin"].every((key) => isFiniteNumber(budget[key]))) {
    errors.push("candidateComparisons.budgetMatch is invalid");
  } else if (
    budget.top1ExpectedTransactionPrice !== top1Property.expectedTransactionPrice
    || budget.top2ExpectedTransactionPrice !== top2Property.expectedTransactionPrice
    || budget.top1BudgetMargin !== (budget.maximumBudget as number) - (budget.top1ExpectedTransactionPrice as number)
    || budget.top2BudgetMargin !== (budget.maximumBudget as number) - (budget.top2ExpectedTransactionPrice as number)
  ) {
    errors.push("candidateComparisons.budgetMatch contradicts candidate prices");
  }
  const buildingArea = value.buildingArea;
  if (!isRecord(buildingArea) || !isOneOf(buildingArea.relation, BUILDING_AREA_RELATIONS) || !isNullableNumber(buildingArea.top1SquareMeters) || !isNullableNumber(buildingArea.top2SquareMeters)) {
    errors.push("candidateComparisons.buildingArea is invalid");
  } else {
    const top1Area = top1Property.area as number;
    const top2Area = top2Property.area as number;
    const expectedAreaRelation = top1Area === top2Area ? "EQUAL" : top1Area > top2Area ? "TOP1_LARGER" : "TOP1_SMALLER";
    if (buildingArea.top1SquareMeters !== top1Area || buildingArea.top2SquareMeters !== top2Area || buildingArea.relation !== expectedAreaRelation) {
      errors.push("candidateComparisons.buildingArea contradicts candidate areas");
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
    validateCandidateComparisons(value.candidateComparisons, value.candidates, errors);
  }
}

function validateEvidencePack(value: unknown, context: unknown, effectivePriorities: unknown, errors: string[]): void {
  if (!isRecord(value) || value.version !== 1 || !isRecord(context)) {
    errors.push("evidencePack is invalid");
    return;
  }
  const ranking = Array.isArray(context.ranking) ? context.ranking : [];
  const packRanking = Array.isArray(value.ranking) && value.ranking.every(isNonEmptyString) ? value.ranking : [];
  if (JSON.stringify(packRanking) !== JSON.stringify(ranking)) errors.push("evidencePack ranking must equal deterministic ranking");
  if (!isRecord(value.buyerContext) || !Array.isArray(value.priorities) || !isRecord(value.topCandidate) || !Array.isArray(value.candidates) || !Array.isArray(value.candidateComparisons) || !Array.isArray(value.signalComparisons) || !isRecord(value.weights)) {
    errors.push("evidencePack structure is incomplete");
    return;
  }
  const buyerPriorities = Array.isArray(value.buyerContext.topPriorities) ? value.buyerContext.topPriorities : [];
  const packPriorities = value.priorities.map((item) => isRecord(item) ? item.priority : null);
  if (JSON.stringify(packPriorities) !== JSON.stringify(buyerPriorities)) errors.push("evidencePack priorities are inconsistent");
  const contextPreferences = isRecord(context.preferences) ? context.preferences : null;
  if (
    !contextPreferences
    || value.buyerContext.purchasePurpose !== contextPreferences.purchasePurpose
    || value.buyerContext.maximumBudget !== contextPreferences.maximumBudget
    || value.buyerContext.educationNeed !== contextPreferences.educationNeed
    || JSON.stringify(buyerPriorities) !== JSON.stringify(contextPreferences.topPriorities)
  ) {
    errors.push("evidencePack buyer context contradicts analysis context");
  }
  if (value.topCandidate.propertyId !== packRanking[0] || value.topCandidate.rank !== 1) errors.push("evidencePack Top1 is inconsistent");
  if (value.candidates.length !== packRanking.length) errors.push("evidencePack candidates must match ranking");
  const packCandidates = value.candidates;
  packCandidates.forEach((candidate, index) => {
    if (!isRecord(candidate) || !isRecord(candidate.property) || candidate.property.id !== packRanking[index] || candidate.rank !== index + 1 || !isOneOf(candidate.recommendation, RECOMMENDATIONS)) {
      errors.push(`evidencePack.candidates[${index}] is invalid`);
      return;
    }
    const packDimensions = Array.isArray(candidate.dimensionResults) ? candidate.dimensionResults : [];
    if (packDimensions.length !== DIMENSION_KEYS.length) {
      errors.push(`evidencePack.candidates[${index}] must contain all 15 dimensions`);
    }
    const contextCandidate = Array.isArray(context.candidates) && isRecord(context.candidates[index])
      ? context.candidates[index]
      : null;
    const contextDecision = contextCandidate && isRecord(contextCandidate.decision) ? contextCandidate.decision : null;
    const contextProperty = contextCandidate && isRecord(contextCandidate.property) ? contextCandidate.property : null;
    if (
      !contextDecision
      || !contextProperty
      || candidate.property.name !== contextProperty.name
      || candidate.property.totalPrice !== contextProperty.expectedTransactionPrice
      || (candidate.property.listingPrice ?? null) !== contextProperty.listingPrice
      || candidate.property.area !== contextProperty.area
      || candidate.overallScore !== contextDecision.matchScore
      || candidate.recommendation !== contextDecision.recommendation
      || !Array.isArray(contextDecision.dimensions)
      || JSON.stringify(packDimensions.map((dimension) => isRecord(dimension)
        ? { key: dimension.key, score: dimension.score, status: dimension.status }
        : null)) !== JSON.stringify(contextDecision.dimensions.map((dimension) => isRecord(dimension)
        ? { key: dimension.key, score: dimension.score, status: dimension.status }
        : null))
    ) {
      errors.push(`evidencePack.candidates[${index}] contradicts deterministic results`);
    }
    if (!(candidate.amapEvidence === null || isRecord(candidate.amapEvidence)) || !(candidate.webEvidence === null || isRecord(candidate.webEvidence)) || !Array.isArray(candidate.scoreableWebEvidence) || !Array.isArray(candidate.contextualVerifiedEvidence) || !Array.isArray(candidate.sources) || !Array.isArray(candidate.decisionSignals)) {
      errors.push(`evidencePack.candidates[${index}] evidence is invalid`);
    }
    if (isRecord(candidate.property) && Array.isArray(candidate.decisionSignals)) {
      const expectedSignals = buildPropertyDecisionSignals(
        candidate.property as unknown as import("../../types/property").Property,
        isRecord(candidate.webEvidence) ? candidate.webEvidence as unknown as import("../web-evidence/types").PropertyWebEvidence : undefined,
      );
      if (JSON.stringify(candidate.decisionSignals) !== JSON.stringify(expectedSignals)) errors.push(`evidencePack.candidates[${index}] decision signals are inconsistent`);
    }
    for (const item of [...(candidate.scoreableWebEvidence as unknown[] ?? []), ...(candidate.contextualVerifiedEvidence as unknown[] ?? [])]) {
      if (!isRecord(item) || !isNonEmptyString(item.propertyId) || !isOneOf(item.dimension, WEB_EVIDENCE_TARGET_DIMENSIONS) || !["verified", "partially_verified", "conflicting", "insufficient"].includes(String(item.status)) || !["high", "medium", "low"].includes(String(item.confidence)) || !Array.isArray(item.sources)) {
        errors.push(`evidencePack.candidates[${index}] verified evidence is invalid`);
      }
    }
  });
  const topCandidate = packCandidates[0];
  if (isRecord(topCandidate) && isRecord(topCandidate.property) && topCandidate.property.id !== value.topCandidate.propertyId) errors.push("evidencePack Top1 candidate is inconsistent");
  if (packRanking.length > 1) {
    if (value.candidateComparisons.length !== packRanking.length - 1) errors.push("evidencePack comparisons are incomplete");
    value.candidateComparisons.forEach((comparison, index) => {
      if (!isRecord(comparison) || comparison.topCandidateId !== packRanking[0] || comparison.alternativeId !== packRanking[index + 1] || !Array.isArray(comparison.dimensions) || comparison.dimensions.length !== DIMENSION_KEYS.length) {
        errors.push(`evidencePack.candidateComparisons[${index}] is invalid`);
        return;
      }
      const topDimensions = isRecord(packCandidates[0]) && Array.isArray(packCandidates[0].dimensionResults) ? packCandidates[0].dimensionResults : [];
      const alternative = packCandidates[index + 1];
      const alternativeDimensions = isRecord(alternative) && Array.isArray(alternative.dimensionResults) ? alternative.dimensionResults : [];
      comparison.dimensions.forEach((dimension, dimensionIndex) => {
        const topDimension = topDimensions[dimensionIndex];
        const alternativeDimension = alternativeDimensions[dimensionIndex];
        if (!isRecord(dimension) || !isRecord(topDimension) || !isRecord(alternativeDimension)) return;
        const topScore = typeof topDimension.score === "number" ? topDimension.score : null;
        const alternativeScore = typeof alternativeDimension.score === "number" ? alternativeDimension.score : null;
        const difference = topScore === null || alternativeScore === null ? null : topScore - alternativeScore;
        const expectedRelation = difference === null ? "unknown" : difference === 0 ? "equal" : Math.abs(difference) < 5 ? "close" : difference > 0 ? "top_better" : "top_worse";
        if (dimension.dimension !== topDimension.key || dimension.topScore !== topScore || dimension.alternativeScore !== alternativeScore || dimension.relation !== expectedRelation) {
          errors.push(`evidencePack.candidateComparisons[${index}].dimensions[${dimensionIndex}] contradicts deterministic results`);
        }
      });
    });
  }
  const expectedSignalComparisons = buildDecisionSignalComparisons(packCandidates.flatMap((candidate) =>
    isRecord(candidate) && isRecord(candidate.property) && isNonEmptyString(candidate.property.id) && Array.isArray(candidate.decisionSignals)
      ? [{ propertyId: candidate.property.id, signals: candidate.decisionSignals as unknown as import("../../types/decision-signals").DecisionSignal[] }]
      : []));
  if (JSON.stringify(value.signalComparisons) !== JSON.stringify(expectedSignalComparisons)) errors.push("evidencePack signal comparisons are inconsistent");
  if (!isRecord(value.intendedWeights) || !isRecord(value.effectiveWeights) || !Array.isArray(value.effectiveComparableDimensions)) {
    errors.push("evidencePack comparable-weight metadata is incomplete");
  } else {
    const intended = value.intendedWeights as Record<DimensionKey, number>;
    const expectedComparable = DIMENSION_KEYS.filter((key) =>
      typeof intended[key] === "number" && intended[key] > 0 && packCandidates.every((candidate) =>
        isRecord(candidate) && Array.isArray(candidate.dimensionResults) && candidate.dimensionResults.some((dimension) => isRecord(dimension) && dimension.key === key && typeof dimension.score === "number")),
    );
    if (JSON.stringify(value.effectiveComparableDimensions) !== JSON.stringify(expectedComparable)) errors.push("evidencePack comparable dimensions contradict candidate coverage");
    const expectedWeights = calculateEffectiveWeights(intended, expectedComparable);
    for (const key of DIMENSION_KEYS) {
      const actual = value.effectiveWeights[key];
      const legacy = value.weights[key];
      if (typeof actual !== "number" || typeof legacy !== "number" || Math.abs(actual - expectedWeights[key]) > 0.0001 || Math.abs(legacy - expectedWeights[key]) > 0.0001) {
        errors.push(`evidencePack effective weight for ${key} is inconsistent`);
        break;
      }
    }
  }
  const validEffective = Array.isArray(effectivePriorities) && effectivePriorities.every((item) => isOneOf(item, DECISION_PRIORITIES));
  if (!validEffective) errors.push("effectivePriorities is invalid");
  else {
    const educationNeed = value.buyerContext.educationNeed;
    const comparable = new Set(Array.isArray(value.effectiveComparableDimensions) ? value.effectiveComparableDimensions : []);
    const expected = buyerPriorities.filter((priority) => {
      if (educationNeed === "none" && priority === "education") return false;
      return getPriorityDimensions(priority as DecisionPriority).some((dimension) => comparable.has(dimension));
    });
    if (JSON.stringify(effectivePriorities) !== JSON.stringify(expected)) errors.push("effectivePriorities must reflect buyer priorities and comparable evidence");
  }
}

function validateKnownDecisionContext(value: unknown, evidencePack: unknown, errors: string[]): void {
  if (!isRecord(value) || value.version !== 1 || !isRecord(evidencePack)) {
    errors.push("knownDecisionContext is invalid");
    return;
  }
  const ranking = Array.isArray(value.ranking) ? value.ranking : [];
  const packRanking = Array.isArray(evidencePack.ranking) ? evidencePack.ranking : [];
  if (JSON.stringify(ranking) !== JSON.stringify(packRanking)) errors.push("knownDecisionContext ranking is inconsistent");
  if (!isRecord(value.authoritativeTop1) || value.authoritativeTop1.propertyId !== packRanking[0]) errors.push("knownDecisionContext Top1 is inconsistent");
  if (!Array.isArray(value.effectiveComparableDimensions) || !isRecord(value.intendedWeights) || !isRecord(value.effectiveWeights) || !Array.isArray(value.candidates) || !Array.isArray(value.decisiveKnownFactors) || !Array.isArray(value.attentionCandidates)) {
    errors.push("knownDecisionContext structure is incomplete");
    return;
  }
  const comparable = new Set(value.effectiveComparableDimensions);
  const effectiveWeights = value.effectiveWeights as Record<string, unknown>;
  const effectiveTotal = DIMENSION_KEYS.reduce((sum, key) => sum + (typeof effectiveWeights[key] === "number" ? effectiveWeights[key] as number : 0), 0);
  if (Math.abs(effectiveTotal - 100) > 0.0001) errors.push("knownDecisionContext effective weights must sum to 100");
  value.decisiveKnownFactors.forEach((factor, index) => {
    if (!isRecord(factor) || !isOneOf(factor.dimension, DIMENSION_KEYS) || !comparable.has(factor.dimension)) errors.push(`knownDecisionContext.decisiveKnownFactors[${index}] is not comparable`);
  });
  try {
    const expected = buildKnownDecisionContext(evidencePack as unknown as DecisionEvidencePack);
    if (JSON.stringify(value) !== JSON.stringify(expected)) errors.push("knownDecisionContext contradicts the canonical evidence pack");
  } catch {
    errors.push("knownDecisionContext cannot be rebuilt from the canonical evidence pack");
  }
}

export function validateAIAnalysisRequest(value: unknown): ValidationResult<AIAnalysisRequest> {
  const errors: string[] = [];
  if (!isRecord(value)) return { success: false, errors: ["request must be an object"] };
  if (value.schemaVersion !== AI_ANALYSIS_SCHEMA_VERSION) errors.push("schemaVersion is unsupported");
  if (value.locale !== "zh-CN") errors.push("locale must be zh-CN");
  if (!isNonEmptyString(value.inputSignature)) errors.push("inputSignature is required");
  validateContext(value.context, errors);
  validateEvidencePack(value.evidencePack, value.context, value.effectivePriorities, errors);
  validateKnownDecisionContext(value.knownDecisionContext, value.evidencePack, errors);
  if (
    isRecord(value.context)
    && isRecord(value.evidencePack)
    && Array.isArray(value.effectivePriorities)
    && isNonEmptyString(value.inputSignature)
    && createAIInputSignature(
      value.context as unknown as AIAnalysisRequest["context"],
      value.evidencePack as unknown as DecisionEvidencePack,
      value.effectivePriorities as DecisionPriority[],
      value.knownDecisionContext as unknown as AIAnalysisRequest["knownDecisionContext"],
    ) !== value.inputSignature
  ) {
    errors.push("inputSignature does not match authoritative request data");
  }
  return errors.length ? { success: false, errors } : { success: true, data: value as unknown as AIAnalysisRequest };
}

function collectAllowedNumbers(value: unknown, output: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) { output.add(value); return; }
  if (typeof value === "string") {
    for (const match of value.matchAll(/(?<![A-Za-z_])\d+(?:\.\d+)?/g)) output.add(Number(match[0]));
    return;
  }
  if (Array.isArray(value)) { value.forEach((item) => collectAllowedNumbers(item, output)); return; }
  if (isRecord(value)) Object.values(value).forEach((item) => collectAllowedNumbers(item, output));
}

function validateNumericGrounding(text: string, pack: DecisionEvidencePack, errors: string[]): void {
  const allowed = new Set<number>();
  collectAllowedNumbers(pack, allowed);
  const prices = pack.candidates.map((candidate) => candidate.property.totalPrice);
  const areas = pack.candidates.map((candidate) => candidate.property.area);
  const budget = pack.buyerContext.maximumBudget;
  for (const price of prices) allowed.add(Math.abs(budget - price));
  for (let left = 0; left < prices.length; left += 1) for (let right = left + 1; right < prices.length; right += 1) allowed.add(Math.abs(prices[left] - prices[right]));
  for (let left = 0; left < areas.length; left += 1) for (let right = left + 1; right < areas.length; right += 1) allowed.add(Math.round(Math.abs(areas[left] - areas[right]) * 10) / 10);
  for (const token of text.match(/(?<![A-Za-z_])\d+(?:\.\d+)?/g) ?? []) {
    const numeric = Number(token);
    if (![...allowed].some((item) => Math.abs(item - numeric) < 0.001)) {
      errors.push("analysis contains a numeric fact absent from authoritative evidence");
      break;
    }
  }
}

function textForAnalysis(analysis: Record<string, unknown>): string {
  return [
    analysis.decisionSummary,
    analysis.whyWinner,
    analysis.tradeoff,
    ...(Array.isArray(analysis.decisionFactors) ? analysis.decisionFactors.flatMap((item) => isRecord(item) ? [item.comparison, item.verdict, item.reasoning] : []) : []),
    ...(Array.isArray(analysis.attentionItems) ? analysis.attentionItems : []),
    ...(Array.isArray(analysis.topPriorityAnalysis) ? analysis.topPriorityAnalysis.map((item) => isRecord(item) ? item.analysis : "") : []),
    ...(Array.isArray(analysis.additionalInsight) ? analysis.additionalInsight : []),
    ...(Array.isArray(analysis.risksOrUnknowns) ? analysis.risksOrUnknowns : []),
    ...(Array.isArray(analysis.pendingEvidence) ? analysis.pendingEvidence : []),
  ].filter((item): item is string => typeof item === "string").join("\n");
}

function validateEvidenceGrounding(analysis: Record<string, unknown>, consistency: AINarrativeConsistencyConstraint, errors: string[]): void {
  const pack = consistency.evidencePack;
  const effectivePriorities = consistency.effectivePriorities ?? [];
  if (!pack) return;
  const fullText = textForAnalysis(analysis);
  validateNumericGrounding(fullText, pack, errors);

  if (consistency.requireEvidenceGroundedStructure) {
    const knownContext = consistency.knownDecisionContext;
    const summary = typeof analysis.decisionSummary === "string" ? analysis.decisionSummary.trim() : "";
    if (/\n\s*\n/.test(summary) || /(?:^|\n)\s*(?:[-*•]|\d+[.、])/.test(summary) || /推荐结论\s*[：:]|关键决策依据\s*[：:]|为什么最终推荐|关键取舍\s*[：:]|风险与待确认\s*[：:]|下一步建议\s*[：:]/.test(summary)) {
      errors.push("analysis.decisionSummary must be one natural paragraph rather than a sectioned report");
    }
    const uncertaintyClauses = summary
      .split(/[。！？；\n]+/)
      .filter((clause) => /缺少|不足以判断|尚待确认|无法判断|待补充|需要补齐/.test(clause));
    if (uncertaintyClauses.length >= 2) errors.push("analysis.decisionSummary must not become a missing-data report");
    if (Array.isArray(analysis.pendingEvidence) && analysis.pendingEvidence.length > 0) errors.push("analysis.pendingEvidence must be empty for the final summary");
    if (knownContext && knownContext.buyer.usableTop3.length > 0) {
      const referencesCurrentPriority = knownContext.buyer.usableTop3.some((priority) => PRIORITY_LANGUAGE[priority.priority].test(summary));
      if (!referencesCurrentPriority) errors.push("analysis.decisionSummary does not reflect any usable current priority");
    } else if (effectivePriorities.length > 0 && !effectivePriorities.some((priority) => PRIORITY_LANGUAGE[priority].test(summary))) {
      errors.push("analysis.decisionSummary does not reflect current buyer preferences");
    }
  }

  if (pack.candidates.length > 1) {
    const topScore = pack.candidates[0].overallScore;
    const alternativeScore = pack.candidates[1].overallScore;
    if (topScore !== null && alternativeScore !== null && Math.abs(topScore - alternativeScore) < 5 && DECISIVE_LANGUAGE.test(fullText)) {
      errors.push("analysis exaggerates a close deterministic ranking");
    }
  }

  for (const candidate of pack.candidates) {
    const listingPrice = candidate.property.listingPrice;
    if (listingPrice === null || listingPrice === undefined || listingPrice === candidate.property.totalPrice) continue;
    const listingToken = String(listingPrice);
    const clauses = fullText.split(/[。！？；\n]+/).filter((clause) => clause.includes(listingToken));
    const mislabelsListingPrice = clauses.some((clause) => {
      if (/挂牌/.test(clause)) return false;
      const escaped = listingToken.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`(?:成交(?:价)?|网签(?:价)?)\\s*(?:约)?\\s*${escaped}(?:\\s*万)?|${escaped}\\s*(?:万(?:元)?)?\\s*(?:的)?(?:成交价|成交|网签价|网签)`).test(clause);
    });
    if (mislabelsListingPrice) errors.push("analysis confuses listing price with transaction price");
  }

  const webItems = pack.candidates.flatMap((candidate) =>
    (candidate.webEvidence?.dimensions.flatMap((dimension) => dimension.verifiedEvidence ?? []) ?? [])
      .map((item) => ({ candidate, item })));
  for (const { candidate, item } of webItems) {
    const valueText = String(item.value);
    if (valueText.length < 2 || !fullText.includes(valueText)) continue;
    const clauses = fullText.split(/[。！？；\n]+/).filter((clause) => clause.includes(valueText));
    const independentlyGrounded = JSON.stringify({
      property: candidate.property,
      amapEvidence: candidate.amapEvidence,
      decisionSignals: candidate.decisionSignals.filter((signal) => signal.status === "available"),
      scoreableWebEvidence: candidate.scoreableWebEvidence,
    }).includes(valueText);
    if (item.status === "partially_verified" && clauses.some((clause) =>
      !CAUTIOUS_EVIDENCE_LANGUAGE.test(clause)
      && !/你(?:所)?记录|用户记录|现场观察|看房观察|主观体验/.test(clause)
      && !independentlyGrounded)) {
      errors.push(`analysis presents partially verified ${item.dimension} evidence as confirmed`);
    }
    if (item.status === "conflicting" && clauses.some((clause) => !/冲突|不一致|尚无法判断|无法确认/.test(clause) || UNSUPPORTED_POSITIVE_LANGUAGE.test(clause))) {
      errors.push(`analysis uses conflicting ${item.dimension} evidence as a conclusion`);
    }
    if (item.status === "insufficient" && clauses.some((clause) => !UNCERTAINTY_OR_NEGATION_LANGUAGE.test(clause) && !CAUTIOUS_EVIDENCE_LANGUAGE.test(clause))) {
      errors.push(`analysis uses insufficient ${item.dimension} evidence as confirmed`);
    }
  }

  const topCandidate = pack.candidates[0];
  const topName = topCandidate?.property.name ?? "";
  for (const candidate of pack.candidates) {
    for (const signal of candidate.decisionSignals) {
      const clauses = fullText.split(/[。！？；\n]+/).filter((clause) => clause.includes(signal.label));
      if (signal.source === "user_reported" && signal.status === "available" && clauses.some((clause) =>
        UNSUPPORTED_POSITIVE_LANGUAGE.test(clause) && !/你(?:所)?记录|用户记录|现场观察|看房观察|主观体验/.test(clause))) {
        errors.push(`analysis presents user-reported ${signal.key} as externally verified`);
      }
      if (signal.status === "conflicting" && clauses.some((clause) => UNSUPPORTED_POSITIVE_LANGUAGE.test(clause) || /确定|确认无误|已经证实/.test(clause))) {
        errors.push(`analysis resolves conflicting ${signal.key} without authority`);
      }
    }
  }
  for (const comparison of pack.signalComparisons) {
    const alternative = pack.candidates.find((candidate) => candidate.property.id === comparison.alternativeId);
    if (!alternative || !topName) continue;
    const language = new RegExp(comparison.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (comparison.relation === "top_weaker" && hasCandidateDimensionAdvantageClaim(fullText, topName, language)) {
      errors.push(`analysis reverses user-reported ${comparison.key} comparison`);
    }
    if (comparison.relation === "top_stronger" && hasCandidateDimensionAdvantageClaim(fullText, alternative.property.name, language)) {
      errors.push(`analysis reverses user-reported ${comparison.key} comparison`);
    }
    if (["top_higher", "top_lower", "conflicting"].includes(comparison.relation)) {
      const clauses = fullText.split(/[。！？；\n]+/).filter((clause) => language.test(clause));
      if (clauses.some((clause) => CANDIDATE_ADVANTAGE_LANGUAGE.test(clause) && !/仅|只|不能|不代表|并不意味着/.test(clause))) {
        errors.push(`analysis turns factual ${comparison.key} difference into an unsupported advantage`);
      }
    }
  }
}

function validateAnalysis(
  analysis: unknown,
  errors: string[],
  expectedTopPropertyId?: string,
  expectedTopPropertyName?: string,
  expectedAlternativeNames: string[] = [],
  requiresCommuteBoundaryNuance = false,
  consistency?: AINarrativeConsistencyConstraint,
): void {
  if (!isRecord(analysis)) { errors.push("analysis must be an object"); return; }
  if (!hasOnlyKeys(analysis, ["topPropertyId", "topPropertyName", "decisionSummary", "decisionFactors", "whyWinner", "attentionItems", "topPriorityAnalysis", "tradeoff", "additionalInsight", "risksOrUnknowns", "pendingEvidence", "disclaimer"])) errors.push("analysis contains unexpected fields");
  if (hasForbiddenAnalysisKey(analysis)) errors.push("analysis must not contain scores, ranking, recommendation or weights");
  if (!isNonEmptyString(analysis.topPropertyId) || (expectedTopPropertyId && analysis.topPropertyId !== expectedTopPropertyId)) errors.push("analysis.topPropertyId must equal deterministic Top1");
  if (!isNonEmptyString(analysis.topPropertyName) || (expectedTopPropertyName && !isSameCandidateName(analysis.topPropertyName, expectedTopPropertyName))) errors.push("analysis.topPropertyName must map to deterministic Top1 name");
  if (!isNonEmptyString(analysis.decisionSummary)) {
    errors.push("analysis.decisionSummary must be a non-empty string");
  } else {
    const decisionSummary = analysis.decisionSummary;
    const allAnalysisText = textForAnalysis(analysis);
    if (INTERNAL_PRODUCT_LANGUAGE.test(allAnalysisText)) errors.push("analysis contains internal product language");
    if (consistency?.knownDecisionContext && visibleTextLength(decisionSummary) > 200) errors.push("analysis.decisionSummary must not exceed 200 visible characters");
    if (consistency?.knownDecisionContext && /\r|\n/.test(decisionSummary)) errors.push("analysis.decisionSummary must be one paragraph");
    if (consistency?.knownDecisionContext) {
      if (/(?:匹配度|评分|得分).{0,8}\d+(?:\.\d+)?%|\d+(?:\.\d+)?%.{0,8}(?:匹配度|评分|得分)/.test(decisionSummary)) errors.push("analysis.decisionSummary must not expose scores");
      const reasonCount = SUMMARY_REASON_LANGUAGE.filter((language) => language.test(decisionSummary)).length;
      if (reasonCount < 2) errors.push("analysis.decisionSummary must contain at least two grounded reasons");
      if (!SUMMARY_CONCRETE_DETAIL_LANGUAGE.test(decisionSummary)) errors.push("analysis.decisionSummary must include concrete grounded detail");
    }
    if (requiresCommuteBoundaryNuance && /均.{0,8}(?:理想时间|理想通勤|理想范围)|(?:都|均)在.{0,6}理想/.test(decisionSummary)) errors.push("analysis.decisionSummary misstates commute threshold");
    if (consistency) {
      const clauses = allAnalysisText.split(/[。！？；\n]+/).map((item) => item.trim()).filter(Boolean);
      for (const dimension of consistency.dimensions) {
        const related = clauses.filter((clause) => clause.includes(dimension.label));
        if (dimension.score !== null && dimension.score >= 80 && related.some((clause) => ABSOLUTE_NEGATIVE_LANGUAGE.test(clause))) {
          errors.push(`analysis.decisionSummary contradicts high ${dimension.label} score`);
        }
        if ((dimension.score === null || dimension.status === "unknown") && related.some((clause) => /表现差|配套弱|品质不好|明显弱|较差|短板/.test(clause))) {
          errors.push(`analysis.decisionSummary treats unknown ${dimension.label} as negative`);
        }
        if ((dimension.score === null || dimension.status === "unknown") && related.some((clause) => UNSUPPORTED_POSITIVE_LANGUAGE.test(clause) && !UNCERTAINTY_OR_NEGATION_LANGUAGE.test(clause))) {
          errors.push(`analysis.decisionSummary treats unknown ${dimension.label} as confirmed positive`);
        }
      }
      if (consistency.educationNeed === "none") {
        const educationClauses = clauses.filter((clause) => /教育|学校|学位|入学/.test(clause));
        if (educationClauses.length > 0 || (Array.isArray(analysis.pendingEvidence) && analysis.pendingEvidence.some((item) => typeof item === "string" && /教育|学校|学位|入学/.test(item)))) {
          errors.push("analysis must omit education when educationNeed is none");
        }
      }
      const spaceMatch = consistency.dimensions.find((dimension) => dimension.key === "space_match");
      if ((spaceMatch?.score === null || spaceMatch?.status === "unknown") && hasUnsupportedUnknownConclusion(allAnalysisText, SPACE_MATCH_CONCLUSION_LANGUAGE)) {
        errors.push("analysis.decisionSummary infers household space match from unknown evidence");
      }
      const layoutDesign = consistency.dimensions.find((dimension) => dimension.key === "layout_design");
      if ((layoutDesign?.score === null || layoutDesign?.status === "unknown") && hasUnsupportedUnknownConclusion(allAnalysisText, LAYOUT_CONCLUSION_LANGUAGE)) {
        errors.push("analysis.decisionSummary infers layout quality from unknown evidence");
      }
      if (consistency.comparisons && consistency.topPropertyName) {
        validateRelativeComparisonConsistency(
          allAnalysisText,
          consistency.comparisons,
          consistency.topPropertyName,
          errors,
        );
      }
      validateEvidenceGrounding(analysis, consistency, errors);
    }
  }
  if (!isStringArray(analysis.pendingEvidence) || analysis.pendingEvidence.length > 5 || analysis.pendingEvidence.some((item) => !isNonEmptyString(item)) || !isNonEmptyString(analysis.disclaimer)) {
    errors.push("analysis evidence or disclaimer is invalid");
  } else if (analysis.pendingEvidence.some((item) => INTERNAL_PRODUCT_LANGUAGE.test(item) || INTERNAL_PENDING_LANGUAGE.test(item))) {
    errors.push("analysis.pendingEvidence contains internal product language");
  }
}

export function validateAIAnalysisResponse(
  value: unknown,
  expectedTopPropertyId?: string,
  expectedTopPropertyName?: string,
  expectedAlternativeNames: string[] = [],
  requiresCommuteBoundaryNuance = false,
  consistency?: AINarrativeConsistencyConstraint,
): ValidationResult<AIAnalysisResponse> {
  const errors: string[] = [];
  if (!isRecord(value) || typeof value.ok !== "boolean") return { success: false, errors: ["response must contain boolean ok"] };
  if (value.ok) {
    validateAnalysis(value.analysis, errors, expectedTopPropertyId, expectedTopPropertyName, expectedAlternativeNames, requiresCommuteBoundaryNuance, consistency);
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
