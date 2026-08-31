import type { BuyerPreferences } from "@/types/buyer-preferences";
import type { DecisionEngineResult, DimensionEvaluation } from "@/types/decision";
import type { DecisionEvidencePack, EvidencePackComparisonRelation } from "@/types/decision-evidence-pack";
import type { GeoEvidenceByProperty } from "@/types/geo-evidence";
import type { Property } from "@/types/property";
import type { VerifiedEvidenceItem, WebEvidenceByProperty } from "@/lib/web-evidence/types";
import { buildDecisionSignalComparisons, buildPropertyDecisionSignals } from "@/lib/decision-signals";

export interface BuildDecisionEvidencePackInput {
  properties: Property[];
  preferences: BuyerPreferences;
  engine: DecisionEngineResult;
  geoEvidenceByProperty?: GeoEvidenceByProperty;
  webEvidenceByProperty?: WebEvidenceByProperty;
  createdAt?: string;
}

function relation(top: number | null, alternative: number | null): EvidencePackComparisonRelation {
  if (top === null || alternative === null) return "unknown";
  const difference = top - alternative;
  if (difference === 0) return "equal";
  if (Math.abs(difference) < 5) return "close";
  return difference > 0 ? "top_better" : "top_worse";
}

function cloneDimension(dimension: DimensionEvaluation): DimensionEvaluation {
  return {
    ...dimension,
    evidence: dimension.evidence.map((item) => ({ ...item })),
    missingInputs: [...dimension.missingInputs],
  };
}

function verifiedItems(webEvidence: WebEvidenceByProperty[string] | undefined): VerifiedEvidenceItem[] {
  return webEvidence?.dimensions.flatMap((dimension) => dimension.verifiedEvidence ?? []) ?? [];
}

/**
 * Preserves the complete authoritative input and evidence graph for Phase 11C.
 * This intentionally does not depend on Narrative Facts or any AI allowlist projection.
 */
export function buildDecisionEvidencePack(input: BuildDecisionEvidencePackInput): DecisionEvidencePack {
  const propertyById = new Map(input.properties.map((property) => [property.id, property]));
  const resultById = new Map(input.engine.results.map((result) => [result.propertyId, result]));
  if (input.engine.ranking.length === 0) throw new Error("Decision Evidence Pack requires at least one ranked candidate.");
  const candidates = input.engine.ranking.map((propertyId, index) => {
    const property = propertyById.get(propertyId);
    const result = resultById.get(propertyId);
    if (!property || !result) throw new Error(`Decision Evidence Pack candidate ${propertyId} is incomplete.`);
    const webEvidence = input.webEvidenceByProperty?.[propertyId];
    const items = verifiedItems(webEvidence);
    const sources = [...new Map(items.flatMap((item) => item.sources).map((source) => [source.sourceUrl, source] as const)).values()];
    const decisionSignals = buildPropertyDecisionSignals(property, webEvidence);
    return {
      property: {
        ...property,
        comparableTransactions: property.comparableTransactions?.map((item) => ({ ...item })),
        confirmedLocation: property.confirmedLocation ? { ...property.confirmedLocation } : property.confirmedLocation,
      },
      rank: index + 1,
      overallScore: result.overallScore,
      recommendation: result.recommendation,
      dimensionResults: result.dimensions.map(cloneDimension),
      amapEvidence: input.geoEvidenceByProperty?.[propertyId] ?? null,
      webEvidence: webEvidence ?? null,
      scoreableWebEvidence: items.filter((item) => item.evidenceKind === "scoreable" && item.status === "verified"),
      contextualVerifiedEvidence: items.filter((item) => item.evidenceKind === "contextual" && item.status !== "insufficient"),
      sources,
      decisionSignals,
      hardMismatches: result.hardMismatches.map((item) => ({ ...item })),
    };
  });
  const top = candidates[0];
  return {
    version: 1,
    createdAt: input.createdAt ?? new Date().toISOString(),
    buyerContext: {
      ...input.preferences,
      educationStages: [...input.preferences.educationStages],
      topPriorities: [...input.preferences.topPriorities],
      primaryWorkLocationConfirmed: input.preferences.primaryWorkLocationConfirmed ? { ...input.preferences.primaryWorkLocationConfirmed } : input.preferences.primaryWorkLocationConfirmed,
      partnerWorkLocationConfirmed: input.preferences.partnerWorkLocationConfirmed ? { ...input.preferences.partnerWorkLocationConfirmed } : input.preferences.partnerWorkLocationConfirmed,
    },
    priorities: input.preferences.topPriorities.map((priority, index) => ({ priority, rank: index + 1 })),
    candidates,
    weights: { ...input.engine.weights },
    intendedWeights: { ...(input.engine.intendedWeights ?? input.engine.weights) },
    effectiveWeights: { ...input.engine.weights },
    effectiveComparableDimensions: [...(input.engine.effectiveComparableDimensions ?? [])],
    ranking: [...input.engine.ranking],
    topCandidate: { propertyId: top.property.id, rank: 1, overallScore: top.overallScore, recommendation: top.recommendation },
    candidateComparisons: candidates.slice(1).map((alternative) => ({
      topCandidateId: top.property.id,
      alternativeId: alternative.property.id,
      dimensions: top.dimensionResults.map((dimension) => {
        const other = alternative.dimensionResults.find((item) => item.key === dimension.key);
        return {
          dimension: dimension.key,
          topScore: dimension.score,
          alternativeScore: other?.score ?? null,
          relation: relation(dimension.score, other?.score ?? null),
        };
      }),
    })),
    signalComparisons: buildDecisionSignalComparisons(candidates.map((candidate) => ({ propertyId: candidate.property.id, signals: candidate.decisionSignals }))),
  };
}
