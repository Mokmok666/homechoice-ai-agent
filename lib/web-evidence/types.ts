import type { DimensionKey } from "@/types/decision";

export const WEB_EVIDENCE_VERSION = 2 as const;
export const WEB_EVIDENCE_PROVIDER_ID = "tavily-search-v1" as const;
export const WEB_EVIDENCE_LEGACY_PROVIDER_ID = "zhipu-web-search-v2" as const;
export const WEB_EVIDENCE_INTERPRETATION_VERSION = 2 as const;
export const WEB_EVIDENCE_TARGET_DIMENSIONS = [
  "location_maturity",
  "community_quality",
  "property_management",
  "education",
  "transaction_price_reasonableness",
  "liquidity",
  "value_preservation",
] as const satisfies readonly DimensionKey[];

export type WebEvidenceDimensionKey = (typeof WEB_EVIDENCE_TARGET_DIMENSIONS)[number];
export type WebEvidenceProviderId = typeof WEB_EVIDENCE_PROVIDER_ID | typeof WEB_EVIDENCE_LEGACY_PROVIDER_ID;
export type WebEvidenceConfidence = "high" | "medium" | "low";
export type WebEvidenceStatus = "verified" | "partial" | "unavailable";
export type TransactionEvidenceKind = "transaction" | "listing" | "unknown";

export interface NormalizedWebSearchResult {
  title: string;
  url: string;
  snippet?: string;
  sourceDomain?: string;
  publishedAt?: string;
  fetchedAt: string;
  credibilityHint?: WebEvidenceConfidence;
}

export interface WebEvidenceFact {
  claim: string;
  value?: string | number;
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain?: string;
  publishedAt?: string;
  fetchedAt: string;
  confidence: WebEvidenceConfidence;
  transactionKind?: TransactionEvidenceKind;
}

export interface WebEvidenceInterpretation {
  conclusion: string;
  supportingFacts: string[];
  generatedAt: string;
}

export interface DimensionWebEvidence {
  dimensionKey: WebEvidenceDimensionKey;
  status: WebEvidenceStatus;
  summary?: string;
  facts: WebEvidenceFact[];
  interpretation?: WebEvidenceInterpretation;
}

export interface PropertyWebEvidence {
  propertyId: string;
  propertyIdentitySignature: string;
  dimensions: DimensionWebEvidence[];
  fetchedAt: string;
  version: typeof WEB_EVIDENCE_VERSION;
  providerId?: WebEvidenceProviderId;
  interpretationVersion?: typeof WEB_EVIDENCE_INTERPRETATION_VERSION;
  interpretationSignature?: string;
}

export interface WebEvidenceByProperty {
  [propertyId: string]: PropertyWebEvidence;
}

export interface WebEvidencePropertyIdentity {
  propertyId: string;
  name: string;
  city: string;
  district: string;
  formattedAddress?: string;
  poiId?: string;
  lng?: number;
  lat?: number;
}

export interface WebEvidenceQuery {
  dimensionKey: WebEvidenceDimensionKey;
  query: string;
}

export interface WebSearchProvider {
  readonly id: string;
  search(query: string, options?: {
    limit?: number;
    signal?: AbortSignal;
    property?: WebEvidencePropertyIdentity;
    dimensionKey?: WebEvidenceDimensionKey;
  }): Promise<NormalizedWebSearchResult[]>;
}

export type WebEvidenceApiErrorCode =
  | "INVALID_REQUEST"
  | "PROVIDER_UNAVAILABLE"
  | "PROVIDER_ERROR"
  | "TIMEOUT";

export type WebEvidenceApiResponse =
  | { ok: true; evidence: PropertyWebEvidence }
  | { ok: false; error: { code: WebEvidenceApiErrorCode; message: string; retryable: boolean } };

export interface WebEvidenceInterpretationRequest {
  property: WebEvidencePropertyIdentity;
  evidence: PropertyWebEvidence;
  interpretationSignature: string;
}

export type WebEvidenceInterpretationApiResponse =
  | {
      ok: true;
      propertyId: string;
      interpretationSignature: string;
      dimensions: Array<{
        dimensionKey: WebEvidenceDimensionKey;
        conclusion: string;
        supportingFacts: string[];
      }>;
      metadata: { provider: "zhipu"; model: string; generatedAt: string };
    }
  | { ok: false; error: { code: "INVALID_REQUEST" | "INVALID_AI_OUTPUT" | "AI_NOT_CONFIGURED" | "AI_TIMEOUT" | "AI_PROVIDER_ERROR"; message: string; retryable: boolean } };
