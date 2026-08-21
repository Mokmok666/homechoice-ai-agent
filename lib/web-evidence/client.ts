import { loadCachedPropertyWebEvidence, loadCachedWebEvidenceForProperties, savePropertyWebEvidence } from "@/lib/web-evidence-storage";
import { projectWebEvidencePropertyIdentity } from "./query-builder";
import type { Property } from "@/types/property";
import type { PropertyWebEvidence, WebEvidenceApiResponse, WebEvidenceByProperty } from "./types";

const inFlight = new Map<string, Promise<PropertyWebEvidence | null>>();
const MAX_CONCURRENT_PROPERTY_REFRESHES = 2;

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function waitForSharedRequest<T>(request: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return request;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    void request.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

async function requestEvidence(property: Property, signal?: AbortSignal): Promise<PropertyWebEvidence | null> {
  const identity = projectWebEvidencePropertyIdentity(property);
  const signature = `${identity.propertyId}:${identity.poiId ?? `${identity.lng ?? ""},${identity.lat ?? ""}`}:${identity.name}:${identity.city}:${identity.district}`;
  const existing = inFlight.get(signature);
  if (existing) return waitForSharedRequest(existing, signal);
  const request = (async () => {
    const response = await fetch("/api/web-evidence/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property: identity }),
    });
    const payload = await response.json() as WebEvidenceApiResponse;
    if (!payload.ok) {
      if (payload.error.code === "PROVIDER_UNAVAILABLE") return null;
      throw new Error(payload.error.message);
    }
    return payload.evidence;
  })().finally(() => inFlight.delete(signature));
  inFlight.set(signature, request);
  return waitForSharedRequest(request, signal);
}

export async function refreshWebEvidenceForProperties(
  properties: Property[],
  onPropertyEvidence?: (propertyId: string, evidence: PropertyWebEvidence) => void,
  signal?: AbortSignal,
): Promise<WebEvidenceByProperty> {
  const evidenceByProperty = loadCachedWebEvidenceForProperties(properties);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < properties.length) {
      if (signal?.aborted) throw abortError();
      const property = properties[nextIndex++];
      const cached = loadCachedPropertyWebEvidence(property);
      if (!cached.stale) continue;
      try {
        const evidence = await requestEvidence(property, signal);
        if (signal?.aborted) throw abortError();
        if (!evidence) continue;
        const newCoverage = evidence.dimensions.filter((item) => item.status !== "unavailable" && item.facts.length > 0).length;
        const cachedCoverage = cached.evidence?.dimensions.filter((item) => item.status !== "unavailable" && item.facts.length > 0).length ?? 0;
        if (newCoverage === 0 && cachedCoverage > 0) continue;
        if (!savePropertyWebEvidence(property, evidence)) continue;
        evidenceByProperty[property.id] = evidence;
        onPropertyEvidence?.(property.id, evidence);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        // One property/provider failure must not block other properties or erase valid cache.
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_PROPERTY_REFRESHES, properties.length) }, () => worker()),
  );
  return evidenceByProperty;
}
