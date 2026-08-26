import {
  GEO_EVIDENCE_SCHEMA_VERSION,
  GEO_EVIDENCE_QUALITY_POLICY_VERSION,
  GEO_NEARBY_SEMANTICS_VERSION,
  loadCachedPropertyGeoEvidence,
  saveGeoEvidenceCacheEntry,
  type GeoEvidenceCacheEntry,
} from "@/lib/geo-evidence-storage";
import { evaluateAMapGeocodeQuality } from "@/lib/amap/geocode-quality";
import type { BuyerPreferences } from "@/types/buyer-preferences";
import { resolvePartnerCommutePreference, resolvePrimaryCommutePreference, type ResolvedCommutePreference } from "@/types/buyer-preferences";
import { buildCommuteGeoEvidence, routeModesForPreference } from "@/lib/commute-evidence";
import type { AMapRouteMode, CommuteModeResult, CommutePersonEvidence, GeoEvidenceByProperty, GeoEvidenceQuality, GeoEvidenceStatus, PropertyGeoEvidence } from "@/types/geo-evidence";
import type { Property } from "@/types/property";

interface NearbyAvailability { metro: boolean; bus: boolean; commercial: boolean; supermarket: boolean; medical: boolean; park: boolean }
interface NearbyFetchResult { evidence: PropertyGeoEvidence; availability: NearbyAvailability; fetchedAt?: string }
interface CommuteFetchResult { evidence?: CommutePersonEvidence; fetchedAt?: string; succeeded: boolean }

const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);
const MAX_REQUEST_ATTEMPTS = 3;
const nearbyRequests = new Map<string, Promise<NearbyFetchResult>>();
const commuteRequests = new Map<string, Promise<CommuteFetchResult>>();
const latestRefreshSignatures = new Map<string, string>();

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) }
function isNonNegativeInteger(value: unknown): value is number { return typeof value === "number" && Number.isInteger(value) && value >= 0 }
function isPositiveNumber(value: unknown): value is number { return typeof value === "number" && Number.isFinite(value) && value > 0 }
function evidenceStatus(quality: GeoEvidenceQuality): GeoEvidenceStatus { return quality === "high" ? "verified" : quality === "medium" ? "partial" : "insufficient" }
function propertyAddress(property: Property): string { return `${property.city}${property.district}${property.address}`.trim() }
function confirmedOrigin(property: Property) {
  const location = property.confirmedLocation;
  if (!location?.confirmedByUser || location.source !== "amap") return undefined;
  return {
    formattedAddress: location.formattedAddress,
    province: location.province,
    city: location.city,
    district: location.district,
    lng: location.lng,
    lat: location.lat,
  };
}
function confirmedDestination(preference: ResolvedCommutePreference) {
  const location = preference.confirmedLocation;
  if (!location?.confirmedByUser || location.source !== "amap") return undefined;
  return {
    formattedAddress: location.formattedAddress,
    province: location.province,
    city: location.city,
    district: location.district,
    lng: location.lng,
    lat: location.lat,
  };
}
function locationQuality(property: Property, geocoding: Parameters<typeof evaluateAMapGeocodeQuality>[0]["geocoding"]): GeoEvidenceQuality {
  const evaluated = evaluateAMapGeocodeQuality({ city: property.city, district: property.district, address: property.address, geocoding });
  return property.confirmedLocation?.confirmedByUser && evaluated !== "low" ? "high" : evaluated;
}
function delay(milliseconds: number): Promise<void> { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }

async function requestWithRetry(url: string, init: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_REQUEST_ATTEMPTS - 1) return response;
    } catch (error) {
      lastError = error;
      if (attempt === MAX_REQUEST_ATTEMPTS - 1) throw error;
    }
    await delay(250 * (attempt + 1));
  }
  throw lastError instanceof Error ? lastError : new Error("Geo Evidence request failed.");
}
async function readJson(response: Response): Promise<unknown> { try { return await response.json() } catch { return null } }
function emptyNearbyResult(): NearbyFetchResult {
  return { evidence: {}, availability: { metro: false, bus: false, commercial: false, supermarket: false, medical: false, park: false } };
}

async function fetchNearbyEvidence(property: Property): Promise<NearbyFetchResult> {
  let response: Response;
  try {
    response = await requestWithRetry("/api/amap/nearby", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(property.confirmedLocation
        ? { confirmedLocation: property.confirmedLocation }
        : { address: propertyAddress(property) }),
    });
  } catch { return emptyNearbyResult() }
  const payload = await readJson(response);
  if (!response.ok || !isRecord(payload) || payload.ok !== true || !isRecord(payload.nearby) || !isRecord(payload.geocoding)) return emptyNearbyResult();
  const nearby = payload.nearby;
  const geocoding = payload.geocoding;
  const location = geocoding.location;
  if (!isRecord(location)) return emptyNearbyResult();
  const quality = locationQuality(property, {
      formattedAddress: typeof geocoding.formattedAddress === "string" ? geocoding.formattedAddress : "",
      province: typeof geocoding.province === "string" ? geocoding.province : undefined,
      city: typeof geocoding.city === "string" ? geocoding.city : undefined,
      district: typeof geocoding.district === "string" ? geocoding.district : undefined,
      location: {
        lng: typeof location.lng === "number" ? location.lng : Number.NaN,
        lat: typeof location.lat === "number" ? location.lat : Number.NaN,
      },
  });
  const fetchedAt = typeof nearby.fetchedAt === "string" ? nearby.fetchedAt : "";
  if (!fetchedAt || !Number.isFinite(Date.parse(fetchedAt)) || !isRecord(nearby.availability)) return emptyNearbyResult();
  const availability: NearbyAvailability = {
    metro: nearby.availability.metro === true, commercial: nearby.availability.commercial === true,
    bus: nearby.availability.bus === true,
    supermarket: nearby.availability.supermarket === true, medical: nearby.availability.medical === true,
    park: nearby.availability.park === true,
  };
  const status = evidenceStatus(quality);
  const evidence: PropertyGeoEvidence = {};

  const metro = availability.metro && isRecord(nearby.metro) ? nearby.metro : null;
  const metroNearest = metro && isRecord(metro.nearest) && typeof metro.nearest.name === "string" && metro.nearest.name.trim() && isNonNegativeInteger(metro.nearest.distanceMeters)
    ? metro.nearest : null;
  const metroNearestName = metroNearest ? String(metroNearest.name).trim() : undefined;
  const metroNearestDistance = metroNearest ? Number(metroNearest.distanceMeters) : undefined;
  const metroCount = metro && isNonNegativeInteger(metro.countWithin1000m) ? metro.countWithin1000m : undefined;
  const bus = availability.bus && isRecord(nearby.bus) ? nearby.bus : null;
  const busNearest = bus && isRecord(bus.nearest) && typeof bus.nearest.name === "string" && bus.nearest.name.trim() && isNonNegativeInteger(bus.nearest.distanceMeters)
    ? bus.nearest : null;
  const busNearestName = busNearest ? String(busNearest.name).trim() : undefined;
  const busNearestDistance = busNearest ? Number(busNearest.distanceMeters) : undefined;
  const busCount500 = bus && isNonNegativeInteger(bus.countWithin500m) ? bus.countWithin500m : undefined;
  const busCount800 = bus && isNonNegativeInteger(bus.countWithin800m) ? bus.countWithin800m : undefined;
  if ((availability.metro && metroCount !== undefined) || (availability.bus && busCount500 !== undefined && busCount800 !== undefined)) {
    const observations = [
      metroNearestName && metroNearestDistance !== undefined ? `最近地铁主站 ${metroNearestName} 约 ${metroNearestDistance} 米（直线距离）` : availability.metro ? "步行范围内未识别到地铁主站" : "地铁证据暂不可用",
      busNearestName && busNearestDistance !== undefined ? `最近公交站 ${busNearestName} 约 ${busNearestDistance} 米（直线距离），500 米内 ${busCount500} 个、800 米内 ${busCount800} 个公交站` : availability.bus ? "800 米内未识别到公交站" : "公交证据暂不可用",
    ];
    evidence.public_transport = {
      dimension: "public_transport", source: "amap", fetchedAt,
      status: quality === "low" ? "insufficient" : "partial", quality,
      observation: observations.join("；"),
      ...(metroNearestName && metroNearestDistance !== undefined ? { nearestStationName: metroNearestName, nearestDistanceMeters: metroNearestDistance } : {}),
      ...(metroCount !== undefined ? { stationCountWithin1000m: metroCount } : {}),
      busEvidenceAvailable: availability.bus,
      ...(busNearestName && busNearestDistance !== undefined ? { nearestBusStopName: busNearestName, nearestBusStopDistanceMeters: busNearestDistance } : {}),
      ...(busCount500 !== undefined ? { busStopCountWithin500m: busCount500 } : {}),
      ...(busCount800 !== undefined ? { busStopCountWithin800m: busCount800 } : {}),
    };
  }
  if (availability.commercial && isRecord(nearby.commercial) && isNonNegativeInteger(nearby.commercial.countWithin2000m) && Array.isArray(nearby.commercial.examples)) {
    const nearest = isRecord(nearby.commercial.nearest) && typeof nearby.commercial.nearest.name === "string" && isNonNegativeInteger(nearby.commercial.nearest.distanceMeters)
      ? nearby.commercial.nearest : null;
    evidence.commercial_amenities = {
      dimension: "commercial_amenities", source: "amap", fetchedAt, status, quality,
      observation: `2 公里内识别到 ${nearby.commercial.countWithin2000m} 个有效商业体${nearest ? `，最近 ${String(nearest.name).trim()} 约 ${nearest.distanceMeters} 米（直线距离）` : ""}`,
      countWithin2000m: nearby.commercial.countWithin2000m,
      ...(nearest ? { nearestName: String(nearest.name).trim(), nearestDistanceMeters: Number(nearest.distanceMeters) } : {}),
      examples: nearby.commercial.examples.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5),
    };
  }
  if (availability.medical && isRecord(nearby.medical) && isNonNegativeInteger(nearby.medical.hospitalCountWithin3000m) && Array.isArray(nearby.medical.examples)) {
    const nearest = isRecord(nearby.medical.nearest) && typeof nearby.medical.nearest.name === "string" && isNonNegativeInteger(nearby.medical.nearest.distanceMeters)
      ? nearby.medical.nearest : null;
    evidence.medical_amenities = {
      dimension: "medical_amenities", source: "amap", fetchedAt, status, quality,
      observation: `3 公里内识别到 ${nearby.medical.hospitalCountWithin3000m} 家正规医院${nearest ? `，最近 ${String(nearest.name).trim()} 约 ${nearest.distanceMeters} 米（直线距离）` : ""}`,
      hospitalCountWithin3000m: nearby.medical.hospitalCountWithin3000m,
      ...(nearest ? { nearestName: String(nearest.name).trim(), nearestDistanceMeters: Number(nearest.distanceMeters) } : {}),
      examples: nearby.medical.examples.filter((item): item is string => typeof item === "string" && item.trim().length > 0).slice(0, 5),
    };
  }
  return { evidence, availability, fetchedAt };
}

async function fetchCommuteRoute(property: Property, preference: ResolvedCommutePreference, mode: AMapRouteMode): Promise<{
  result: CommuteModeResult;
  quality: GeoEvidenceQuality;
  fetchedAt: string;
} | null> {
  let response: Response;
  try {
    response = await requestWithRetry("/api/amap/commute", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(confirmedOrigin(property)
          ? { originLocation: confirmedOrigin(property) }
          : { originAddress: propertyAddress(property) }),
        destinationAddress: preference.workLocation,
        ...(confirmedDestination(preference) ? { destinationLocation: confirmedDestination(preference) } : {}),
        mode,
      }),
    });
  } catch { return null }
  const payload = await readJson(response);
  if (!response.ok || !isRecord(payload) || payload.ok !== true || !isRecord(payload.result)) return null;
  const route = payload.result;
  if (route.mode !== mode || !isPositiveNumber(route.durationMinutes) || !isPositiveNumber(route.distanceMeters) || typeof route.fetchedAt !== "string" || !Number.isFinite(Date.parse(route.fetchedAt))) return null;
  const origin = route.origin;
  if (!isRecord(origin)) return null;
  const quality = locationQuality(property, {
      formattedAddress: typeof origin.formattedAddress === "string" ? origin.formattedAddress : "",
      province: property.confirmedLocation?.province,
      city: property.confirmedLocation?.city,
      district: property.confirmedLocation?.district,
      location: {
        lng: typeof origin.lng === "number" ? origin.lng : Number.NaN,
        lat: typeof origin.lat === "number" ? origin.lat : Number.NaN,
      },
  });
  return { result: { minutes: route.durationMinutes, distanceMeters: route.distanceMeters }, quality, fetchedAt: route.fetchedAt };
}

async function fetchCommuteEvidence(property: Property, preference: ResolvedCommutePreference): Promise<CommuteFetchResult> {
  const modes = routeModesForPreference(preference.mode);
  if (!preference.workLocation || preference.mode === "not_important" || modes.length === 0) return { succeeded: false };
  const settled = await Promise.allSettled(modes.map((mode) => fetchCommuteRoute(property, preference, mode)));
  const modeResults: Partial<Record<AMapRouteMode, CommuteModeResult>> = {};
  let fetchedAt: string | undefined;
  const qualities: GeoEvidenceQuality[] = [];
  settled.forEach((entry, index) => {
    if (entry.status !== "fulfilled" || !entry.value) return;
    modeResults[modes[index]] = entry.value.result;
    fetchedAt = !fetchedAt || entry.value.fetchedAt > fetchedAt ? entry.value.fetchedAt : fetchedAt;
    qualities.push(entry.value.quality);
  });
  const successCount = Object.keys(modeResults).length;
  if (successCount === 0 || !fetchedAt) return { succeeded: false };
  const quality: GeoEvidenceQuality = qualities.includes("low") ? "low" : qualities.includes("medium") ? "medium" : "high";
  return {
    succeeded: true,
    fetchedAt,
    evidence: {
      destinationLabel: preference.workLocation,
      requestedMode: preference.mode,
      modeResults,
      status: quality === "low" ? "unavailable" : successCount === modes.length && quality === "high" ? "verified" : "partial",
      quality,
      fetchedAt,
    },
  };
}

function deduplicatedNearby(property: Property, signature: string): Promise<NearbyFetchResult> {
  const existing = nearbyRequests.get(signature);
  if (existing) return existing;
  const request = fetchNearbyEvidence(property).finally(() => { if (nearbyRequests.get(signature) === request) nearbyRequests.delete(signature) });
  nearbyRequests.set(signature, request);
  return request;
}
function deduplicatedCommute(property: Property, preference: ResolvedCommutePreference, signature: string): Promise<CommuteFetchResult> {
  const existing = commuteRequests.get(signature);
  if (existing) return existing;
  const request = fetchCommuteEvidence(property, preference).finally(() => { if (commuteRequests.get(signature) === request) commuteRequests.delete(signature) });
  commuteRequests.set(signature, request);
  return request;
}
function cachedNearby(entry: GeoEvidenceCacheEntry | null, locationSignature: string): PropertyGeoEvidence {
  if (!entry || entry.locationSignature !== locationSignature || !entry.nearbyEvidence) return {};
  const currentNearbySemantics = entry.nearbySemanticsVersion === GEO_NEARBY_SEMANTICS_VERSION;
  return {
    ...(entry.nearbyEvidence.publicTransport ? { public_transport: entry.nearbyEvidence.publicTransport } : {}),
    ...(currentNearbySemantics && entry.nearbyEvidence.commercialAmenities ? { commercial_amenities: entry.nearbyEvidence.commercialAmenities } : {}),
    ...(currentNearbySemantics && entry.nearbyEvidence.medicalAmenities ? { medical_amenities: entry.nearbyEvidence.medicalAmenities } : {}),
  };
}

function mergeCommutePersonEvidence(
  previous: CommutePersonEvidence | undefined,
  refreshed: CommutePersonEvidence,
): CommutePersonEvidence {
  if (!previous || previous.destinationLabel !== refreshed.destinationLabel || previous.requestedMode !== refreshed.requestedMode) return refreshed;
  return {
    ...refreshed,
    modeResults: { ...previous.modeResults, ...refreshed.modeResults },
    status: refreshed.status === "verified" || previous.status === "verified" ? "verified" : "partial",
  };
}

async function refreshPropertyGeoEvidence(property: Property, preferences: BuyerPreferences): Promise<PropertyGeoEvidence> {
  const cached = loadCachedPropertyGeoEvidence(property, preferences);
  const refreshSignature = [cached.locationSignature, cached.primaryCommuteSignature ?? "", cached.partnerCommuteSignature ?? ""].join("|");
  latestRefreshSignatures.set(property.id, refreshSignature);
  if (!cached.nearbyStale && !cached.commuteStale) return cached.evidence;
  const expectedEntry = cached.entry;
  const primaryPreference = resolvePrimaryCommutePreference(preferences);
  const partnerPreference = resolvePartnerCommutePreference(preferences);
  const [nearbyResult, primaryCommuteResult, partnerCommuteResult] = await Promise.all([
    cached.nearbyStale ? deduplicatedNearby(property, cached.locationSignature) : Promise.resolve(null),
    cached.primaryCommuteStale && cached.primaryCommuteSignature ? deduplicatedCommute(property, primaryPreference, cached.primaryCommuteSignature) : Promise.resolve(null),
    cached.partnerCommuteStale && cached.partnerCommuteSignature && partnerPreference ? deduplicatedCommute(property, partnerPreference, cached.partnerCommuteSignature) : Promise.resolve(null),
  ]);

  const nextNearby = cachedNearby(expectedEntry, cached.locationSignature);
  let nearbyFetchedAt = expectedEntry?.locationSignature === cached.locationSignature && expectedEntry.nearbySemanticsVersion === GEO_NEARBY_SEMANTICS_VERSION ? expectedEntry.nearbyFetchedAt : undefined;
  let nearbySemanticsVersion = expectedEntry?.nearbySemanticsVersion === GEO_NEARBY_SEMANTICS_VERSION
    ? GEO_NEARBY_SEMANTICS_VERSION
    : undefined;
  if (nearbyResult) {
    if (nearbyResult.availability.metro) {
      if (nearbyResult.evidence.public_transport) nextNearby.public_transport = nearbyResult.evidence.public_transport;
      else delete nextNearby.public_transport;
    }
    if (nearbyResult.availability.commercial && nearbyResult.evidence.commercial_amenities) nextNearby.commercial_amenities = nearbyResult.evidence.commercial_amenities;
    if (nearbyResult.availability.medical && nearbyResult.evidence.medical_amenities) nextNearby.medical_amenities = nearbyResult.evidence.medical_amenities;
    if (nearbyResult.availability.commercial || nearbyResult.availability.medical) nearbySemanticsVersion = GEO_NEARBY_SEMANTICS_VERSION;
    if (nearbyResult.availability.metro && nearbyResult.availability.bus && nearbyResult.availability.commercial && nearbyResult.availability.medical) nearbyFetchedAt = nearbyResult.fetchedAt;
  }

  const primaryMatches = expectedEntry?.locationSignature === cached.locationSignature && expectedEntry?.primaryCommuteSignature === cached.primaryCommuteSignature;
  const partnerMatches = expectedEntry?.locationSignature === cached.locationSignature && expectedEntry?.partnerCommuteSignature === cached.partnerCommuteSignature;
  let primaryCommuteEvidence = primaryMatches ? expectedEntry?.primaryCommuteEvidence : undefined;
  let partnerCommuteEvidence = partnerMatches ? expectedEntry?.partnerCommuteEvidence : undefined;
  let primaryCommuteFetchedAt = primaryMatches ? expectedEntry?.primaryCommuteFetchedAt : undefined;
  let partnerCommuteFetchedAt = partnerMatches ? expectedEntry?.partnerCommuteFetchedAt : undefined;
  if (primaryCommuteResult?.succeeded && primaryCommuteResult.evidence) {
    primaryCommuteEvidence = mergeCommutePersonEvidence(primaryCommuteEvidence, primaryCommuteResult.evidence);
    primaryCommuteFetchedAt = primaryCommuteResult.fetchedAt;
  }
  if (partnerCommuteResult?.succeeded && partnerCommuteResult.evidence) {
    partnerCommuteEvidence = mergeCommutePersonEvidence(partnerCommuteEvidence, partnerCommuteResult.evidence);
    partnerCommuteFetchedAt = partnerCommuteResult.fetchedAt;
  }
  const commuteEvidence = buildCommuteGeoEvidence(preferences, primaryCommuteEvidence, partnerCommuteEvidence);
  const legacyCommuteFetchedAt = expectedEntry?.commuteSignature === cached.commuteSignature ? expectedEntry?.commuteFetchedAt : undefined;
  const legacyCommuteEvidence = expectedEntry?.commuteSignature === cached.commuteSignature ? expectedEntry?.commuteEvidence : undefined;
  const entry: GeoEvidenceCacheEntry = {
    version: GEO_EVIDENCE_SCHEMA_VERSION,
    qualityPolicyVersion: GEO_EVIDENCE_QUALITY_POLICY_VERSION,
    ...(nearbySemanticsVersion ? { nearbySemanticsVersion } : {}),
    propertyId: property.id, locationSignature: cached.locationSignature,
    ...(cached.commuteSignature ? { commuteSignature: cached.commuteSignature } : {}),
    ...(legacyCommuteFetchedAt ? { commuteFetchedAt: legacyCommuteFetchedAt } : {}),
    ...(legacyCommuteEvidence ? { commuteEvidence: legacyCommuteEvidence } : {}),
    ...(cached.primaryCommuteSignature ? { primaryCommuteSignature: cached.primaryCommuteSignature } : {}),
    ...(cached.partnerCommuteSignature ? { partnerCommuteSignature: cached.partnerCommuteSignature } : {}),
    ...(nearbyFetchedAt ? { nearbyFetchedAt } : {}),
    ...(primaryCommuteFetchedAt ? { primaryCommuteFetchedAt } : {}),
    ...(partnerCommuteFetchedAt ? { partnerCommuteFetchedAt } : {}),
    ...(Object.keys(nextNearby).length > 0 ? { nearbyEvidence: {
      ...(nextNearby.public_transport ? { publicTransport: nextNearby.public_transport } : {}),
      ...(nextNearby.commercial_amenities ? { commercialAmenities: nextNearby.commercial_amenities } : {}),
      ...(nextNearby.medical_amenities ? { medicalAmenities: nextNearby.medical_amenities } : {}),
    } } : {}),
    ...(primaryCommuteEvidence ? { primaryCommuteEvidence } : {}),
    ...(partnerCommuteEvidence ? { partnerCommuteEvidence } : {}),
  };
  if (latestRefreshSignatures.get(property.id) !== refreshSignature) {
    return loadCachedPropertyGeoEvidence(property, preferences).evidence;
  }
  const saved = saveGeoEvidenceCacheEntry(entry, expectedEntry);
  return saved ? { ...nextNearby, ...(commuteEvidence ? { commute: commuteEvidence } : {}) } : loadCachedPropertyGeoEvidence(property, preferences).evidence;
}

export async function refreshGeoEvidenceForProperties(
  properties: Property[],
  preferences: BuyerPreferences,
  onPropertyEvidence?: (propertyId: string, evidence: PropertyGeoEvidence) => void,
): Promise<GeoEvidenceByProperty> {
  const entries: Array<readonly [string, PropertyGeoEvidence]> = [];
  for (const property of properties) {
    let evidence: PropertyGeoEvidence;
    try {
      evidence = await refreshPropertyGeoEvidence(property, preferences);
    } catch {
      evidence = loadCachedPropertyGeoEvidence(property, preferences).evidence;
    }
    onPropertyEvidence?.(property.id, evidence);
    entries.push([property.id, evidence] as const);
  }
  return Object.fromEntries(entries);
}
