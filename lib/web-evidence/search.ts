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
import type { DecisionPriority } from "@/types/buyer-preferences";

export async function searchPropertyWebEvidence(
  identity: WebEvidencePropertyIdentity,
  signal?: AbortSignal,
  topPriorities: readonly DecisionPriority[] = [],
): Promise<PropertyWebEvidence> {
  const provider = getWebSearchProvider();
  const queries = buildPropertyWebQueries(identity, topPriorities);
  const grouped = new Map<string, NormalizedWebSearchResult[]>();
  const settled: PromiseSettledResult<{ dimensionKey: string; results: NormalizedWebSearchResult[] }>[] = [];
  // Ordered batches make unresolved Top3 topics start first without suppressing the
  // remaining discovery queries or creating unbounded provider concurrency.
  const QUERY_BATCH_SIZE = 8;
  for (let index = 0; index < queries.length; index += QUERY_BATCH_SIZE) {
    const batch = queries.slice(index, index + QUERY_BATCH_SIZE);
    settled.push(...await Promise.allSettled(batch.map(async ({ dimensionKey, query }) => ({
      dimensionKey,
      results: filterAndRankSearchResults(
        await provider.search(query, { limit: 5, signal, property: identity, dimensionKey }),
        identity,
        dimensionKey,
      ),
    }))));
  }
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
      normalizeDimensionWebEvidence(identity.propertyId, dimensionKey, grouped.get(dimensionKey) ?? []),
    ),
    fetchedAt,
    version: WEB_EVIDENCE_VERSION,
    providerId: provider.id as PropertyWebEvidence["providerId"],
  };
}
