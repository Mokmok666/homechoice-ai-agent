import {
  WEB_EVIDENCE_TARGET_DIMENSIONS,
  type PropertyWebEvidence,
  type WebEvidenceByProperty,
  type WebEvidenceDimensionKey,
} from "./types";
import type { DecisionEngineResult, DimensionEvaluation } from "@/types/decision";

function mergeDimension(dimension: DimensionEvaluation, propertyEvidence: PropertyWebEvidence | undefined): DimensionEvaluation {
  // Long-term value is derived from existing scored structural dimensions.
  // Web context may still be available to AI, but it is not an independent source for this dimension.
  if (dimension.key === "value_preservation") return dimension;
  const web = propertyEvidence?.dimensions.find((item) => item.dimensionKey === dimension.key);
  if (!web || web.status === "unavailable" || web.facts.length === 0) return dimension;
  const quality = web.status === "verified" ? 0.85 : 0.6;
  const descriptions = [web.interpretation?.conclusion ?? web.summary].filter((item): item is string => Boolean(item));
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

interface ExternalEvidenceCoverageOptions { educationApplicable?: boolean }

export function externalEvidenceCoverageDimensions(options: ExternalEvidenceCoverageOptions = {}): WebEvidenceDimensionKey[] {
  return WEB_EVIDENCE_TARGET_DIMENSIONS.filter((key) =>
    key !== "value_preservation" && (key !== "education" || options.educationApplicable !== false)
  );
}

export function externalEvidenceCoverage(evidence: PropertyWebEvidence | undefined, options: ExternalEvidenceCoverageOptions = {}): { completed: number; total: number } {
  const dimensions = externalEvidenceCoverageDimensions(options);
  return {
    completed: dimensions.filter((key) => {
      const item = evidence?.dimensions.find((dimension) => dimension.dimensionKey === key);
      return Boolean(item && item.status !== "unavailable" && item.facts.length > 0);
    }).length,
    total: dimensions.length,
  };
}

export function externalEvidenceCoverageDetails(evidence: PropertyWebEvidence | undefined, options: ExternalEvidenceCoverageOptions = {}): {
  completed: number;
  total: number;
  covered: WebEvidenceDimensionKey[];
  uncovered: WebEvidenceDimensionKey[];
} {
  const dimensions = externalEvidenceCoverageDimensions(options);
  const covered = dimensions.filter((dimensionKey) => {
    const dimension = evidence?.dimensions.find((item) => item.dimensionKey === dimensionKey);
    return Boolean(dimension && dimension.status !== "unavailable" && dimension.facts.length > 0);
  });
  return {
    completed: covered.length,
    total: dimensions.length,
    covered,
    uncovered: dimensions.filter((dimensionKey) => !covered.includes(dimensionKey)),
  };
}
