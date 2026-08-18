import { createDecisionPropertyView, validateTextField } from "../decision/dataQuality";
import type {
  AIAnalysisContext,
  AIBuyerPreferencesContext,
  AIDecisionContext,
  AIPropertyContext,
} from "../../types/ai-analysis";
import type { BuyerPreferences } from "../../types/buyer-preferences";
import type { Property } from "../../types/property";
import type { PropertyDecisionResult } from "../../types/decision";

export interface AIInputProjectorInput {
  property: Property;
  preferences: BuyerPreferences;
  decisionResult: PropertyDecisionResult;
  decisionVersion: string;
  asOfDate: string;
}

function safeText(value: string | null | undefined): string | null {
  return validateTextField(value).status === "valid" ? value!.trim() : null;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function projectProperty(property: Property): AIPropertyContext {
  const safeProperty = createDecisionPropertyView(property);

  return {
    propertyId: property.id,
    name: safeText(property.name),
    location: {
      city: safeText(safeProperty.city),
      district: safeText(safeProperty.district),
      address: safeText(safeProperty.address),
    },
    expectedTransactionPrice: property.totalPrice,
    listingPrice: finiteOrNull(property.listingPrice),
    area: property.area,
    layout: safeText(safeProperty.layout),
    floor: safeText(property.floor),
    orientation: property.orientation === "other"
      ? safeText(property.customOrientation)
      : property.orientation ?? null,
    deliveryYear: finiteOrNull(property.deliveryYear),
    metroDistance: finiteOrNull(safeProperty.metroDistance),
    schoolInformation: safeText(safeProperty.schoolInformation),
    propertyManagementInformation: safeText(safeProperty.propertyManagementInformation),
    comparableTransactions: (safeProperty.comparableTransactions ?? [])
      .filter(
        (item) =>
          item.confirmed &&
          Number.isFinite(item.price) &&
          item.price > 0 &&
          Number.isFinite(item.area) &&
          item.area > 0 &&
          /^\d{4}-\d{2}-\d{2}$/.test(item.transactionDate) &&
          validateTextField(item.source).status === "valid",
      )
      .map((item) => ({
        price: item.price,
        area: item.area,
        transactionDate: item.transactionDate,
        source: item.source.trim(),
      })),
  };
}

function projectPreferences(preferences: BuyerPreferences): AIBuyerPreferencesContext {
  return {
    purchasePurpose: preferences.purchasePurpose,
    maximumBudget: preferences.maximumBudget,
    primaryWorkLocation: safeText(preferences.primaryWorkLocation),
    partnerWorkLocation: safeText(preferences.partnerWorkLocation),
    commuteMode: preferences.commuteMode,
    idealCommuteMinutes: finiteOrNull(preferences.idealCommuteMinutes),
    maxCommuteMinutes: finiteOrNull(preferences.maxCommuteMinutes),
    educationNeed: preferences.educationNeed,
    educationStages: [...preferences.educationStages],
    topPriorities: [...preferences.topPriorities],
  };
}

function projectDecision(
  decisionResult: PropertyDecisionResult,
  decisionVersion: string,
): AIDecisionContext {
  return {
    decisionVersion,
    propertyId: decisionResult.propertyId,
    matchScore: finiteOrNull(decisionResult.overallScore),
    recommendation: decisionResult.recommendation,
    provisional: decisionResult.provisional,
    analysisConfidence: decisionResult.confidence.analysisConfidence,
    dataCompletenessPercent: decisionResult.confidence.dataCompletenessPercent,
    reasons: decisionResult.reasons.filter((item) => safeText(item) !== null),
    decisionFactors: decisionResult.decisionFactors.filter((item) => safeText(item) !== null),
    hardMismatches: decisionResult.hardMismatches
      .filter((item) => safeText(item.reason) !== null)
      .map((item) => ({ dimension: item.dimension, reason: item.reason.trim() })),
    dimensions: decisionResult.dimensions.map((dimension) => ({
      key: dimension.key,
      score: finiteOrNull(dimension.score),
      status: dimension.status,
      finalWeight: dimension.finalWeight,
      evidence: dimension.evidence
        .map((item) => safeText(item.description))
        .filter((item): item is string => item !== null),
      missingInputs: dimension.missingInputs
        .map((item) => safeText(item))
        .filter((item): item is string => item !== null),
    })),
    excludedInputFields: [...decisionResult.confidence.invalidInputFields],
  };
}

/**
 * Projects authoritative product data into a strict AI-safe allowlist.
 * Storage metadata, images, source flags, prompts and credentials are never copied.
 */
export function projectAIAnalysisContext(input: AIInputProjectorInput): AIAnalysisContext {
  if (input.property.id !== input.decisionResult.propertyId) {
    throw new Error("Property and DecisionResult do not refer to the same property.");
  }

  return {
    asOfDate: input.asOfDate,
    property: projectProperty(input.property),
    preferences: projectPreferences(input.preferences),
    decision: projectDecision(input.decisionResult, input.decisionVersion),
  };
}
