import { createPropertyIdentitySignature, projectWebEvidencePropertyIdentity } from "@/lib/web-evidence/query-builder";
import { buildDimensionWebEvidenceSummary } from "@/lib/web-evidence/normalize";
import { createWebEvidenceInterpretationSignature } from "@/lib/web-evidence/interpretation-signature";
import {
  WEB_EVIDENCE_INTERPRETATION_VERSION,
  WEB_EVIDENCE_TARGET_DIMENSIONS,
  WEB_EVIDENCE_LEGACY_PROVIDER_ID,
  WEB_EVIDENCE_PROVIDER_ID,
  WEB_EVIDENCE_VERSION,
  type DimensionWebEvidence,
  type PropertyWebEvidence,
  type WebEvidenceByProperty,
  type WebEvidenceFact,
  type WebEvidenceInterpretation,
} from "@/lib/web-evidence/types";
import type { Property } from "@/types/property";

export const WEB_EVIDENCE_STORAGE_KEY = "homechoice.web-evidence.v1";
export const WEB_EVIDENCE_TTL_MS = 48 * 60 * 60 * 1000;

interface WebEvidenceEnvelope { version: 1; entries: PropertyWebEvidence[] }
export interface CachedWebEvidence { evidence: PropertyWebEvidence | null; stale: boolean }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseFact(value: unknown): WebEvidenceFact | null {
  if (!isRecord(value) || typeof value.claim !== "string" || typeof value.sourceTitle !== "string" || typeof value.sourceUrl !== "string" || typeof value.fetchedAt !== "string" || !["high", "medium", "low"].includes(String(value.confidence))) return null;
  if (!/^https?:\/\//i.test(value.sourceUrl)) return null;
  return {
    claim: value.claim,
    sourceTitle: value.sourceTitle,
    sourceUrl: value.sourceUrl,
    ...(typeof value.value === "string" || typeof value.value === "number" ? { value: value.value } : {}),
    ...(typeof value.sourceDomain === "string" ? { sourceDomain: value.sourceDomain } : {}),
    ...(typeof value.publishedAt === "string" ? { publishedAt: value.publishedAt } : {}),
    fetchedAt: value.fetchedAt,
    confidence: value.confidence as WebEvidenceFact["confidence"],
    ...(["transaction", "listing", "unknown"].includes(String(value.transactionKind)) ? { transactionKind: value.transactionKind as WebEvidenceFact["transactionKind"] } : {}),
  };
}

function parseInterpretation(value: unknown): WebEvidenceInterpretation | null {
  if (!isRecord(value) || typeof value.conclusion !== "string" || !value.conclusion.trim() || value.conclusion.length > 100 || !Array.isArray(value.supportingFacts) || value.supportingFacts.length > 3 || !value.supportingFacts.every((item) => typeof item === "string") || typeof value.generatedAt !== "string") return null;
  return { conclusion: value.conclusion.trim(), supportingFacts: value.supportingFacts.map((item) => item.trim()), generatedAt: value.generatedAt };
}

function parseDimension(value: unknown): DimensionWebEvidence | null {
  if (!isRecord(value) || !WEB_EVIDENCE_TARGET_DIMENSIONS.includes(value.dimensionKey as never) || !["verified", "partial", "unavailable"].includes(String(value.status)) || !Array.isArray(value.facts)) return null;
  const facts = value.facts.map(parseFact).filter((fact): fact is WebEvidenceFact => fact !== null);
  const dimensionKey = value.dimensionKey as DimensionWebEvidence["dimensionKey"];
  const status = value.status as DimensionWebEvidence["status"];
  const interpretation = parseInterpretation(value.interpretation);
  return {
    dimensionKey,
    status,
    // Rebuild the concise presentation summary so legacy verbose/generic cache remains readable.
    summary: buildDimensionWebEvidenceSummary(dimensionKey, status, facts),
    facts,
    ...(interpretation ? { interpretation } : {}),
  };
}

function parseEvidence(value: unknown): PropertyWebEvidence | null {
  if (!isRecord(value) || value.version !== WEB_EVIDENCE_VERSION || typeof value.propertyId !== "string" || typeof value.propertyIdentitySignature !== "string" || typeof value.fetchedAt !== "string" || !Array.isArray(value.dimensions)) return null;
  const dimensions = value.dimensions.map(parseDimension).filter((item): item is DimensionWebEvidence => item !== null);
  if (dimensions.length !== WEB_EVIDENCE_TARGET_DIMENSIONS.length) return null;
  const baseEvidence: PropertyWebEvidence = {
    propertyId: value.propertyId,
    propertyIdentitySignature: value.propertyIdentitySignature,
    dimensions,
    fetchedAt: value.fetchedAt,
    version: WEB_EVIDENCE_VERSION,
    ...([WEB_EVIDENCE_PROVIDER_ID, WEB_EVIDENCE_LEGACY_PROVIDER_ID].includes(value.providerId as never)
      ? { providerId: value.providerId as PropertyWebEvidence["providerId"] }
      : {}),
  };
  const hasValidInterpretation = value.interpretationVersion === WEB_EVIDENCE_INTERPRETATION_VERSION
    && typeof value.interpretationSignature === "string"
    && value.interpretationSignature === createWebEvidenceInterpretationSignature(baseEvidence);
  if (hasValidInterpretation) {
    return { ...baseEvidence, interpretationVersion: WEB_EVIDENCE_INTERPRETATION_VERSION, interpretationSignature: value.interpretationSignature as string };
  }
  return { ...baseEvidence, dimensions: baseEvidence.dimensions.map(({ interpretation: _interpretation, ...dimension }) => dimension) };
}

function readEnvelope(): WebEvidenceEnvelope {
  if (typeof window === "undefined") return { version: 1, entries: [] };
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(WEB_EVIDENCE_STORAGE_KEY) ?? "null");
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) return { version: 1, entries: [] };
    return { version: 1, entries: parsed.entries.map(parseEvidence).filter((item): item is PropertyWebEvidence => item !== null) };
  } catch { return { version: 1, entries: [] }; }
}

function writeEnvelope(envelope: WebEvidenceEnvelope): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(WEB_EVIDENCE_STORAGE_KEY, JSON.stringify(envelope));
}

export function loadCachedPropertyWebEvidence(property: Property, nowMs = Date.now()): CachedWebEvidence {
  const signature = createPropertyIdentitySignature(projectWebEvidencePropertyIdentity(property));
  const evidence = readEnvelope().entries.find((entry) => entry.propertyId === property.id && entry.propertyIdentitySignature === signature) ?? null;
  const fetchedAtMs = evidence ? Date.parse(evidence.fetchedAt) : Number.NaN;
  return { evidence, stale: !evidence || evidence.providerId !== WEB_EVIDENCE_PROVIDER_ID || !Number.isFinite(fetchedAtMs) || nowMs - fetchedAtMs > WEB_EVIDENCE_TTL_MS };
}

export function loadCachedWebEvidenceForProperties(properties: Property[], nowMs = Date.now()): WebEvidenceByProperty {
  return Object.fromEntries(properties.flatMap((property) => {
    const cached = loadCachedPropertyWebEvidence(property, nowMs).evidence;
    return cached ? [[property.id, cached] as const] : [];
  }));
}

export function savePropertyWebEvidence(property: Property, evidence: PropertyWebEvidence): boolean {
  const expectedSignature = createPropertyIdentitySignature(projectWebEvidencePropertyIdentity(property));
  if (evidence.propertyId !== property.id || evidence.propertyIdentitySignature !== expectedSignature) return false;
  const envelope = readEnvelope();
  const otherEntries = envelope.entries.filter((entry) =>
    entry.propertyId !== property.id || entry.propertyIdentitySignature !== evidence.propertyIdentitySignature,
  );
  // Keep identity-specific entries so a late response for an old location cannot erase newer-location evidence.
  const propertyEntries = [...otherEntries.filter((entry) => entry.propertyId === property.id), evidence]
    .sort((left, right) => Date.parse(right.fetchedAt) - Date.parse(left.fetchedAt))
    .slice(0, 3);
  writeEnvelope({
    version: 1,
    entries: [...otherEntries.filter((entry) => entry.propertyId !== property.id), ...propertyEntries],
  });
  return true;
}
