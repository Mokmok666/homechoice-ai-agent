import {
  WEB_EVIDENCE_TARGET_DIMENSIONS,
  type PropertyWebEvidence,
  type WebEvidenceByProperty,
  type WebEvidenceDimensionKey,
} from "./types";
import type { DecisionEngineResult, DimensionEvaluation } from "@/types/decision";

function mergeDimension(dimension: DimensionEvaluation, propertyEvidence: PropertyWebEvidence | undefined): DimensionEvaluation {
  const web = propertyEvidence?.dimensions.find((item) => item.dimensionKey === dimension.key);
  if (!web || web.status === "unavailable" || web.facts.length === 0) return dimension;
  const quality = web.status === "verified" ? 0.85 : 0.6;
  const descriptions = [web.summary].filter((item): item is string => Boolean(item));
  return {
    ...dimension,
    // Web facts enrich evidence only. Without an approved scorer, score and all ranking fields remain untouched.
    status: dimension.status === "unknown" ? "partial" : dimension.status,
    evidence: [
      ...dimension.evidence,
      ...descriptions.map((description) => ({ source: "web" as const, quality, description })),
    ],
  };
}

export function mergeWebEvidenceIntoEngine(engine: DecisionEngineResult, webEvidenceByProperty: WebEvidenceByProperty): DecisionEngineResult {
  return {
    ...engine,
    results: engine.results.map((result) => ({
      ...result,
      dimensions: result.dimensions.map((dimension) => mergeDimension(dimension, webEvidenceByProperty[result.propertyId])),
    })),
  };
}

export function externalEvidenceCoverage(evidence: PropertyWebEvidence | undefined): { completed: number; total: number } {
  return {
    completed: evidence?.dimensions.filter((item) => item.status !== "unavailable" && item.facts.length > 0).length ?? 0,
    total: WEB_EVIDENCE_TARGET_DIMENSIONS.length,
  };
}

export function externalEvidenceCoverageDetails(evidence: PropertyWebEvidence | undefined): {
  completed: number;
  total: number;
  covered: WebEvidenceDimensionKey[];
  uncovered: WebEvidenceDimensionKey[];
} {
  const covered = WEB_EVIDENCE_TARGET_DIMENSIONS.filter((dimensionKey) => {
    const dimension = evidence?.dimensions.find((item) => item.dimensionKey === dimensionKey);
    return Boolean(dimension && dimension.status !== "unavailable" && dimension.facts.length > 0);
  });
  return {
    completed: covered.length,
    total: WEB_EVIDENCE_TARGET_DIMENSIONS.length,
    covered,
    uncovered: WEB_EVIDENCE_TARGET_DIMENSIONS.filter((dimensionKey) => !covered.includes(dimensionKey)),
  };
}
