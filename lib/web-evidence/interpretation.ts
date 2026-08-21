import { createWebEvidenceInterpretationSignature } from "./interpretation-signature";
import {
  WEB_EVIDENCE_INTERPRETATION_VERSION,
  type PropertyWebEvidence,
  type WebEvidenceInterpretationApiResponse,
} from "./types";

export function hasCurrentWebEvidenceInterpretation(evidence: PropertyWebEvidence): boolean {
  const signature = createWebEvidenceInterpretationSignature(evidence);
  const usable = evidence.dimensions.filter((dimension) => dimension.status !== "unavailable" && dimension.facts.length > 0);
  return evidence.interpretationVersion === WEB_EVIDENCE_INTERPRETATION_VERSION
    && evidence.interpretationSignature === signature
    && usable.every((dimension) => Boolean(dimension.interpretation?.conclusion));
}

export function applyWebEvidenceInterpretation(
  evidence: PropertyWebEvidence,
  response: WebEvidenceInterpretationApiResponse,
): PropertyWebEvidence | null {
  if (!response.ok || response.propertyId !== evidence.propertyId) return null;
  const expectedSignature = createWebEvidenceInterpretationSignature(evidence);
  if (response.interpretationSignature !== expectedSignature) return null;
  const usableKeys = new Set(evidence.dimensions.filter((dimension) => dimension.status !== "unavailable" && dimension.facts.length > 0).map((dimension) => dimension.dimensionKey));
  if (response.dimensions.length !== usableKeys.size || response.dimensions.some((dimension) => !usableKeys.has(dimension.dimensionKey) || !dimension.conclusion.trim() || dimension.conclusion.length > 100 || dimension.supportingFacts.length > 3)) return null;
  const interpretedByKey = new Map(response.dimensions.map((dimension) => [dimension.dimensionKey, dimension]));
  return {
    ...evidence,
    dimensions: evidence.dimensions.map((dimension) => {
      const interpreted = interpretedByKey.get(dimension.dimensionKey);
      return interpreted ? {
        ...dimension,
        interpretation: {
          conclusion: interpreted.conclusion.trim(),
          supportingFacts: interpreted.supportingFacts.map((fact) => fact.trim()),
          generatedAt: response.metadata.generatedAt,
        },
      } : dimension;
    }),
    interpretationVersion: WEB_EVIDENCE_INTERPRETATION_VERSION,
    interpretationSignature: expectedSignature,
  };
}
