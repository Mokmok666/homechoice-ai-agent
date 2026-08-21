import { loadCachedPropertyWebEvidence, loadCachedWebEvidenceForProperties, savePropertyWebEvidence } from "@/lib/web-evidence-storage";
import { projectWebEvidencePropertyIdentity } from "./query-builder";
import { applyWebEvidenceInterpretation, hasCurrentWebEvidenceInterpretation } from "./interpretation";
import { createWebEvidenceInterpretationSignature } from "./interpretation-signature";
import type { Property } from "@/types/property";
import {
  WEB_EVIDENCE_PROVIDER_ID,
  type PropertyWebEvidence,
  type WebEvidenceApiResponse,
  type WebEvidenceByProperty,
  type WebEvidenceInterpretationApiResponse,
} from "./types";

const inFlight = new Map<string, Promise<PropertyWebEvidence | null>>();
const interpretationInFlight = new Map<string, Promise<WebEvidenceInterpretationApiResponse>>();
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

async function requestInterpretation(property: Property, evidence: PropertyWebEvidence, signal?: AbortSignal): Promise<WebEvidenceInterpretationApiResponse> {
  const identity = projectWebEvidencePropertyIdentity(property);
  const interpretationSignature = createWebEvidenceInterpretationSignature(evidence);
  const existing = interpretationInFlight.get(interpretationSignature);
  if (existing) return waitForSharedRequest(existing, signal);
  const request = (async () => {
    const response = await fetch("/api/web-evidence/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ property: identity, evidence, interpretationSignature }),
    });
    return response.json() as Promise<WebEvidenceInterpretationApiResponse>;
  })().finally(() => interpretationInFlight.delete(interpretationSignature));
  interpretationInFlight.set(interpretationSignature, request);
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
      let evidence = cached.evidence?.providerId === WEB_EVIDENCE_PROVIDER_ID ? cached.evidence : undefined;
      if (cached.stale) try {
        const refreshedEvidence = await requestEvidence(property, signal);
        if (signal?.aborted) throw abortError();
        if (refreshedEvidence) {
          const newCoverage = refreshedEvidence.dimensions.filter((item) => item.status !== "unavailable" && item.facts.length > 0).length;
          const cachedCoverage = cached.evidence?.dimensions.filter((item) => item.status !== "unavailable" && item.facts.length > 0).length ?? 0;
          if (!(newCoverage === 0 && cachedCoverage > 0)) {
            if (savePropertyWebEvidence(property, refreshedEvidence)) {
              evidence = refreshedEvidence;
              evidenceByProperty[property.id] = refreshedEvidence;
              onPropertyEvidence?.(property.id, refreshedEvidence);
            }
          }
        }
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        // One property/provider failure must not block other properties or erase valid cache.
      }
      if (!evidence || hasCurrentWebEvidenceInterpretation(evidence)) continue;
      try {
        const interpretationResponse = await requestInterpretation(property, evidence, signal);
        if (signal?.aborted) throw abortError();
        const interpretedEvidence = applyWebEvidenceInterpretation(evidence, interpretationResponse);
        if (!interpretedEvidence || !savePropertyWebEvidence(property, interpretedEvidence)) continue;
        evidenceByProperty[property.id] = interpretedEvidence;
        onPropertyEvidence?.(property.id, interpretedEvidence);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        // Deterministic concise summaries remain the safe fallback when interpretation fails.
      }
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(MAX_CONCURRENT_PROPERTY_REFRESHES, properties.length) }, () => worker()),
  );
  return evidenceByProperty;
}
