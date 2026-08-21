import type { BuyerPreferences } from "../../types/buyer-preferences";
import type { ConfidenceResult, DimensionEvaluation, EvidenceItem } from "../../types/decision";
import type { Property } from "../../types/property";
import type { PropertyGeoEvidence } from "../../types/geo-evidence";
import { calculateDataCompleteness } from "./completeness";
import { DIMENSION_TYPES } from "./dimensions";

const STATUS_FACTOR = { known: 1, partial: 0.5, unknown: 0 } as const;

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function calculateConfidence(
  dimensions: DimensionEvaluation[],
  evidenceItems: EvidenceItem[],
  property: Property,
  preferences: BuyerPreferences,
  asOfDate: string,
  invalidInputFields: string[],
  geoEvidence?: PropertyGeoEvidence,
): ConfidenceResult {
  const currentPhaseDimensions = dimensions.filter(
    (dimension) => DIMENSION_TYPES[dimension.key] !== "ai" || dimension.evidence.some((item) => item.source === "amap"),
  );
  const eligibleWeight = currentPhaseDimensions.reduce((sum, dimension) => sum + dimension.finalWeight, 0);
  const coveredWeight = currentPhaseDimensions.reduce(
    (sum, dimension) => sum + dimension.finalWeight * STATUS_FACTOR[dimension.status],
    0,
  );
  const analysisCoverage = eligibleWeight === 0 ? 0 : (coveredWeight / eligibleWeight) * 100;
  const qualityNumerator = currentPhaseDimensions.reduce(
    (sum, dimension) => sum + dimension.finalWeight * STATUS_FACTOR[dimension.status] * dimension.evidenceQuality,
    0,
  );
  const evidenceQuality = coveredWeight === 0 ? 0 : (qualityNumerator / coveredWeight) * 100;

  const recordedInputs = unique(evidenceItems.filter((item) => item.category === "confirmed").map((item) => item.title));
  const aiPendingInputs = unique(evidenceItems.filter((item) => item.category === "ai_inferred").map((item) => item.title));
  const improvementInputs = unique(evidenceItems.filter((item) => item.category === "optional_confirmation").map((item) => item.title));
  const aiDimensions = dimensions.filter((dimension) => DIMENSION_TYPES[dimension.key] === "ai");
  const completedAIDimensions = aiDimensions.filter(
    (dimension) => dimension.status !== "unknown" && dimension.evidence.some((item) => item.source !== "amap"),
  ).length;
  const aiAnalysisProgress = {
    completed: completedAIDimensions,
    total: aiDimensions.length,
    percent: aiDimensions.length === 0 ? 100 : Math.round((completedAIDimensions / aiDimensions.length) * 100),
  };
  const dataCompleteness = calculateDataCompleteness(property, preferences, asOfDate, geoEvidence);

  return {
    dataCompletenessPercent: dataCompleteness.percent,
    dataCompleteness,
    aiAnalysisProgress,
    analysisConfidence: analysisCoverage >= 80 && evidenceQuality >= 70 ? "supported" : "provisional",
    evidenceQualityPercent: Math.round(evidenceQuality),
    recordedInputs,
    aiPendingInputs,
    improvementInputs,
    evidenceItems,
    invalidInputFields,
  };
}
