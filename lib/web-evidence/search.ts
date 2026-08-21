import { buildPropertyWebQueries, createPropertyIdentitySignature } from "./query-builder";
import { normalizeDimensionWebEvidence } from "./normalize";
import { getWebSearchProvider } from "./provider";
import { filterAndRankSearchResults } from "./relevance";
import {
  WEB_EVIDENCE_TARGET_DIMENSIONS,
  WEB_EVIDENCE_VERSION,
  type NormalizedWebSearchResult,
  type PropertyWebEvidence,
  type WebEvidencePropertyIdentity,
} from "./types";

export async function searchPropertyWebEvidence(
  identity: WebEvidencePropertyIdentity,
  signal?: AbortSignal,
): Promise<PropertyWebEvidence> {
  const provider = getWebSearchProvider();
  const queries = buildPropertyWebQueries(identity);
  const grouped = new Map<string, NormalizedWebSearchResult[]>();
  const settled = await Promise.allSettled(queries.map(async ({ dimensionKey, query }) => ({
    dimensionKey,
    results: filterAndRankSearchResults(
      await provider.search(query, { limit: 5, signal, property: identity, dimensionKey }),
      identity,
      dimensionKey,
    ),
  })));
  const failures = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failures.length === settled.length && failures[0]) throw failures[0].reason;
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    const current = grouped.get(result.value.dimensionKey) ?? [];
    grouped.set(result.value.dimensionKey, [...current, ...result.value.results]);
  }
  const fetchedAt = new Date().toISOString();
  return {
    propertyId: identity.propertyId,
    propertyIdentitySignature: createPropertyIdentitySignature(identity),
    dimensions: WEB_EVIDENCE_TARGET_DIMENSIONS.map((dimensionKey) =>
      normalizeDimensionWebEvidence(dimensionKey, grouped.get(dimensionKey) ?? []),
    ),
    fetchedAt,
    version: WEB_EVIDENCE_VERSION,
    providerId: provider.id as PropertyWebEvidence["providerId"],
  };
}
