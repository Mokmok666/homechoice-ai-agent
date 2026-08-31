import type { BuyerPreferences } from "../../types/buyer-preferences";
import {
  type DecisionEngineInput,
  type DecisionEngineResult,
  type DimensionEvaluation,
  type PropertyDecisionResult,
} from "../../types/decision";
import type { Property } from "../../types/property";
import { calculateConfidence } from "./confidence";
import { createDecisionPropertyView, getInvalidPropertyInputFields } from "./dataQuality";
import { buildEvidenceItems } from "./evidence";
import { evaluateDimensions } from "./scorers";
import { makeRecommendation } from "./recommendation";
import { calculateEffectiveWeights, calculateWeights } from "./weights";
import { DIMENSION_KEYS, type DimensionKey } from "../../types/decision";

export const DECISION_ENGINE_VERSION = "decision-engine-v2.3" as const;

function assertValidInput(properties: Property[], preferences: BuyerPreferences, asOfDate: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDate) || !Number.isFinite(Date.parse(`${asOfDate}T00:00:00Z`))) {
    throw new Error("asOfDate 必须是有效的 YYYY-MM-DD 日期。");
  }
  if (!Number.isFinite(preferences.maximumBudget) || preferences.maximumBudget <= 0) {
    throw new Error("最高预算必须是大于 0 的数字。");
  }
  if (preferences.topPriorities.length !== 3 || new Set(preferences.topPriorities).size !== 3) {
    throw new Error("必须提供 3 个不重复的购房优先级。");
  }
  for (const property of properties) {
    if (!property.id || !Number.isFinite(property.totalPrice) || property.totalPrice <= 0 || !Number.isFinite(property.area) || property.area <= 0) {
      throw new Error("房源缺少有效的编号、预期成交价或面积。");
    }
  }
}

function calculateOverallScore(dimensions: DimensionEvaluation[]): number | null {
  const weighted = dimensions.filter((dimension) => dimension.score !== null && dimension.finalWeight > 0);
  if (weighted.length === 0) return null;
  return Math.round(weighted.reduce((sum, dimension) => sum + dimension.score! * dimension.finalWeight, 0) / 100);
}

interface PreliminaryPropertyResult {
  property: Property;
  decisionProperty: Property;
  invalidInputFields: string[];
  dimensions: DimensionEvaluation[];
  evidenceItems: ReturnType<typeof buildEvidenceItems>;
}

function evaluatePropertyDimensions(
  property: Property,
  input: DecisionEngineInput,
  weights: DecisionEngineResult["weights"],
): PreliminaryPropertyResult {
  const decisionProperty = createDecisionPropertyView(property);
  const invalidInputFields = getInvalidPropertyInputFields(property);
  const dimensions = evaluateDimensions({
    property: decisionProperty,
    preferences: input.preferences,
    asOfDate: input.asOfDate,
    weights,
    geoEvidence: input.geoEvidenceByProperty?.[property.id],
    webEvidence: input.webEvidenceByProperty?.[property.id],
  });
  const evidenceItems = buildEvidenceItems(decisionProperty, input.preferences);
  return { property, decisionProperty, invalidInputFields, dimensions, evidenceItems };
}

function finalizeProperty(
  preliminary: PreliminaryPropertyResult,
  input: DecisionEngineInput,
  effectiveWeights: Record<DimensionKey, number>,
): PropertyDecisionResult {
  const { property, decisionProperty, invalidInputFields, evidenceItems } = preliminary;
  const dimensions = preliminary.dimensions.map((dimension) => ({
    ...dimension,
    finalWeight: effectiveWeights[dimension.key],
  }));
  const overallScore = calculateOverallScore(dimensions);
  const confidence = calculateConfidence(
    dimensions,
    evidenceItems,
    property,
    input.preferences,
    input.asOfDate,
    invalidInputFields,
    input.geoEvidenceByProperty?.[property.id],
  );
  const recommendation = makeRecommendation({
    property: decisionProperty,
    preferences: input.preferences,
    dimensions,
    confidence,
    overallScore,
    propertyCount: input.properties.length,
  });
  return {
    propertyId: property.id,
    overallScore,
    dimensions,
    confidence,
    ...recommendation,
    provisional: confidence.analysisConfidence === "provisional" || input.properties.length < 3,
  };
}

export function runDecisionEngine(input: DecisionEngineInput): DecisionEngineResult {
  assertValidInput(input.properties, input.preferences, input.asOfDate);
  const intendedWeights = calculateWeights(
    input.preferences.purchasePurpose,
    input.preferences.topPriorities,
    input.preferences.educationNeed,
  );
  const preliminary = input.properties.map((property) => evaluatePropertyDimensions(property, input, intendedWeights));
  const effectiveComparableDimensions = DIMENSION_KEYS.filter((key) =>
    intendedWeights[key] > 0 && preliminary.every((candidate) => candidate.dimensions.find((dimension) => dimension.key === key)?.score !== null),
  );
  const weights = calculateEffectiveWeights(intendedWeights, effectiveComparableDimensions);
  const results = preliminary
    .map((candidate) => finalizeProperty(candidate, input, weights))
    .sort((a, b) => {
      const scoreDifference = (b.overallScore ?? -1) - (a.overallScore ?? -1);
      if (scoreDifference !== 0) return scoreDifference;
      const coverageDifference = b.confidence.dataCompletenessPercent - a.confidence.dataCompletenessPercent;
      return coverageDifference !== 0 ? coverageDifference : a.propertyId.localeCompare(b.propertyId);
    });

  return {
    engineVersion: DECISION_ENGINE_VERSION,
    asOfDate: input.asOfDate,
    weights,
    intendedWeights,
    effectiveComparableDimensions,
    results,
    ranking: results.map((result) => result.propertyId),
    rankingProvisional: results.length < 3 || results.some((result) => result.provisional),
  };
}
