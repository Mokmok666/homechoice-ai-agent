import { WEB_EVIDENCE_INTERPRETATION_VERSION, type PropertyWebEvidence } from "./types";

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

export function createWebEvidenceInterpretationSignature(evidence: PropertyWebEvidence): string {
  const material = {
    propertyIdentitySignature: evidence.propertyIdentitySignature,
    providerId: evidence.providerId ?? null,
    evidenceVersion: evidence.version,
    interpretationVersion: WEB_EVIDENCE_INTERPRETATION_VERSION,
    dimensions: evidence.dimensions.map((dimension) => ({
      dimensionKey: dimension.dimensionKey,
      status: dimension.status,
      facts: dimension.facts.map((fact) => ({
        claim: fact.claim,
        sourceUrl: fact.sourceUrl,
        sourceDomain: fact.sourceDomain ?? null,
        publishedAt: fact.publishedAt ?? null,
        confidence: fact.confidence,
        transactionKind: fact.transactionKind ?? null,
      })),
    })),
  };
  return `web-interpretation-v${WEB_EVIDENCE_INTERPRETATION_VERSION}-${hash(JSON.stringify(material))}`;
}
