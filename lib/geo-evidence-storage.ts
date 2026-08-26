import type { BuyerPreferences } from "@/types/buyer-preferences";
import type {
  CommuteGeoEvidence,
  CommutePersonEvidence,
  CommercialAmenitiesGeoEvidence,
  MedicalAmenitiesGeoEvidence,
  PropertyGeoEvidence,
  PublicTransportGeoEvidence,
} from "@/types/geo-evidence";
import type { Property } from "@/types/property";
import { buildCommuteGeoEvidence } from "@/lib/commute-evidence";
import {
  resolvePartnerCommutePreference,
  resolvePrimaryCommutePreference,
  type ResolvedCommutePreference,
} from "@/types/buyer-preferences";

export const GEO_EVIDENCE_STORAGE_KEY = "homechoice.geo-evidence.v1";
export const GEO_EVIDENCE_SCHEMA_VERSION = 1 as const;
export const GEO_EVIDENCE_QUALITY_POLICY_VERSION = 3 as const;
export const GEO_NEARBY_SEMANTICS_VERSION = 2 as const;
export const NEARBY_EVIDENCE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
export const COMMUTE_EVIDENCE_TTL_MS = 24 * 60 * 60 * 1_000;

interface NearbyEvidenceCache {
  publicTransport?: PublicTransportGeoEvidence;
  commercialAmenities?: CommercialAmenitiesGeoEvidence;
  medicalAmenities?: MedicalAmenitiesGeoEvidence;
}

export interface GeoEvidenceCacheEntry {
  version: typeof GEO_EVIDENCE_SCHEMA_VERSION;
  qualityPolicyVersion?: number;
  nearbySemanticsVersion?: number;
  propertyId: string;
  locationSignature: string;
  commuteSignature?: string;
  nearbyFetchedAt?: string;
  commuteFetchedAt?: string;
  nearbyEvidence?: NearbyEvidenceCache;
  commuteEvidence?: CommuteGeoEvidence;
  primaryCommuteSignature?: string;
  partnerCommuteSignature?: string;
  primaryCommuteFetchedAt?: string;
  partnerCommuteFetchedAt?: string;
  primaryCommuteEvidence?: CommutePersonEvidence;
  partnerCommuteEvidence?: CommutePersonEvidence;
}

interface GeoEvidenceCacheEnvelope {
  schemaVersion: typeof GEO_EVIDENCE_SCHEMA_VERSION;
  entries: GeoEvidenceCacheEntry[];
}

export interface CachedPropertyGeoEvidence {
  entry: GeoEvidenceCacheEntry | null;
  evidence: PropertyGeoEvidence;
  locationSignature: string;
  commuteSignature?: string;
  nearbyStale: boolean;
  commuteStale: boolean;
  primaryCommuteSignature?: string;
  partnerCommuteSignature?: string;
  primaryCommuteStale: boolean;
  partnerCommuteStale: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeSignaturePart(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("zh-CN");
}

function hashSignature(parts: string[]): string {
  const source = JSON.stringify(parts.map(normalizeSignaturePart));
  let hash = 2_166_136_261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `geo-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createLocationSignature(property: Property): string {
  const confirmed = property.confirmedLocation;
  if (confirmed?.confirmedByUser && confirmed.source === "amap") {
    return hashSignature([
      "confirmed-amap",
      confirmed.poiId ?? "",
      confirmed.lng.toFixed(6),
      confirmed.lat.toFixed(6),
      confirmed.city,
      confirmed.district,
    ]);
  }
  return hashSignature([property.city, property.district, property.address]);
}

export function createCommuteSignature(
  locationSignature: string,
  preferences: BuyerPreferences,
): string | undefined {
  if (
    preferences.commuteMode !== "driving" &&
    preferences.commuteMode !== "public_transit"
  ) return undefined;
  if (!preferences.primaryWorkLocation.trim()) return undefined;
  return hashSignature([
    locationSignature,
    preferences.primaryWorkLocation,
    preferences.commuteMode,
  ]);
}

export function createPersonCommuteSignature(
  locationSignature: string,
  preference: ResolvedCommutePreference | null,
): string | undefined {
  if (!preference || preference.mode === "not_important" || !preference.workLocation) return undefined;
  const confirmed = preference.confirmedLocation;
  if (confirmed?.confirmedByUser && confirmed.source === "amap") {
    return hashSignature([
      locationSignature,
      "confirmed-work-amap",
      confirmed.poiId ?? "",
      confirmed.lng.toFixed(6),
      confirmed.lat.toFixed(6),
      confirmed.city ?? "",
      confirmed.district ?? "",
      preference.mode,
    ]);
  }
  return hashSignature([locationSignature, preference.workLocation, preference.mode]);
}

function isValidDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isBaseEvidence(value: unknown, dimension: string): value is Record<string, unknown> {
  return isRecord(value) && value.dimension === dimension && value.source === "amap" &&
    isValidDate(value.fetchedAt) &&
    (value.status === "verified" || value.status === "partial" || value.status === "insufficient") &&
    (value.quality === "high" || value.quality === "medium" || value.quality === "low") &&
    typeof value.observation === "string";
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 5 && value.every((item) => typeof item === "string");
}

function isCommuteEvidence(value: unknown): value is CommuteGeoEvidence {
  return isBaseEvidence(value, "commute") &&
    (value.mode === "driving" || value.mode === "transit" || value.mode === "walking") &&
    isPositiveNumber(value.durationMinutes) && isPositiveNumber(value.distanceMeters);
}

function isModeResult(value: unknown): boolean {
  return isRecord(value) && isPositiveNumber(value.minutes) && isPositiveNumber(value.distanceMeters);
}

function isCommutePersonEvidence(value: unknown): value is CommutePersonEvidence {
  if (!isRecord(value) || typeof value.destinationLabel !== "string" ||
    !(value.requestedMode === "driving" || value.requestedMode === "public_transit" || value.requestedMode === "walking" || value.requestedMode === "cycling" || value.requestedMode === "flexible") ||
    !isRecord(value.modeResults) ||
    !(value.status === "verified" || value.status === "partial" || value.status === "unavailable") ||
    !(value.quality === "high" || value.quality === "medium" || value.quality === "low") ||
    !(value.fetchedAt === undefined || isValidDate(value.fetchedAt))) return false;
  return Object.entries(value.modeResults).every(([mode, result]) =>
    (mode === "driving" || mode === "transit" || mode === "walking" || mode === "cycling") && isModeResult(result));
}

function isPublicTransportEvidence(value: unknown): value is PublicTransportGeoEvidence {
  if (!isBaseEvidence(value, "public_transport")) return false;
  const metroValid = value.nearestStationName === undefined || (typeof value.nearestStationName === "string" && isNonNegativeInteger(value.nearestDistanceMeters));
  const metroCountValid = value.stationCountWithin1000m === undefined || isNonNegativeInteger(value.stationCountWithin1000m);
  const busAvailableValid = value.busEvidenceAvailable === undefined || typeof value.busEvidenceAvailable === "boolean";
  const busNearestValid = value.nearestBusStopName === undefined || (typeof value.nearestBusStopName === "string" && isNonNegativeInteger(value.nearestBusStopDistanceMeters));
  const busCountsValid = (value.busStopCountWithin500m === undefined || isNonNegativeInteger(value.busStopCountWithin500m)) &&
    (value.busStopCountWithin800m === undefined || isNonNegativeInteger(value.busStopCountWithin800m));
  return metroValid && metroCountValid && busAvailableValid && busNearestValid && busCountsValid &&
    (value.nearestStationName !== undefined || value.busEvidenceAvailable === true);
}

function isCommercialEvidence(value: unknown): value is CommercialAmenitiesGeoEvidence {
  return isBaseEvidence(value, "commercial_amenities") && isNonNegativeInteger(value.countWithin2000m) &&
    (value.nearestDistanceMeters === undefined || isNonNegativeInteger(value.nearestDistanceMeters)) &&
    (value.nearestName === undefined || typeof value.nearestName === "string") && isStringArray(value.examples);
}

function isMedicalEvidence(value: unknown): value is MedicalAmenitiesGeoEvidence {
  return isBaseEvidence(value, "medical_amenities") &&
    isNonNegativeInteger(value.hospitalCountWithin3000m) &&
    (value.nearestDistanceMeters === undefined || isNonNegativeInteger(value.nearestDistanceMeters)) &&
    (value.nearestName === undefined || typeof value.nearestName === "string") && isStringArray(value.examples);
}

function parseEntry(value: unknown): GeoEvidenceCacheEntry | null {
  if (!isRecord(value) || value.version !== GEO_EVIDENCE_SCHEMA_VERSION ||
    typeof value.propertyId !== "string" || !value.propertyId ||
    typeof value.locationSignature !== "string" || !value.locationSignature) return null;

  const entry: GeoEvidenceCacheEntry = {
    version: GEO_EVIDENCE_SCHEMA_VERSION,
    propertyId: value.propertyId,
    locationSignature: value.locationSignature,
  };
  if (typeof value.qualityPolicyVersion === "number" && Number.isInteger(value.qualityPolicyVersion)) {
    entry.qualityPolicyVersion = value.qualityPolicyVersion;
  }
  if (typeof value.nearbySemanticsVersion === "number" && Number.isInteger(value.nearbySemanticsVersion)) entry.nearbySemanticsVersion = value.nearbySemanticsVersion;
  if (typeof value.commuteSignature === "string" && value.commuteSignature) entry.commuteSignature = value.commuteSignature;
  if (isValidDate(value.nearbyFetchedAt)) entry.nearbyFetchedAt = value.nearbyFetchedAt;
  if (isValidDate(value.commuteFetchedAt)) entry.commuteFetchedAt = value.commuteFetchedAt;
  if (isRecord(value.nearbyEvidence)) {
    const nearby: NearbyEvidenceCache = {};
    if (isPublicTransportEvidence(value.nearbyEvidence.publicTransport)) nearby.publicTransport = value.nearbyEvidence.publicTransport;
    if (isCommercialEvidence(value.nearbyEvidence.commercialAmenities)) nearby.commercialAmenities = value.nearbyEvidence.commercialAmenities;
    if (isMedicalEvidence(value.nearbyEvidence.medicalAmenities)) nearby.medicalAmenities = value.nearbyEvidence.medicalAmenities;
    if (Object.keys(nearby).length > 0) entry.nearbyEvidence = nearby;
  }
  if (isCommuteEvidence(value.commuteEvidence)) entry.commuteEvidence = value.commuteEvidence;
  if (typeof value.primaryCommuteSignature === "string" && value.primaryCommuteSignature) entry.primaryCommuteSignature = value.primaryCommuteSignature;
  if (typeof value.partnerCommuteSignature === "string" && value.partnerCommuteSignature) entry.partnerCommuteSignature = value.partnerCommuteSignature;
  if (isValidDate(value.primaryCommuteFetchedAt)) entry.primaryCommuteFetchedAt = value.primaryCommuteFetchedAt;
  if (isValidDate(value.partnerCommuteFetchedAt)) entry.partnerCommuteFetchedAt = value.partnerCommuteFetchedAt;
  if (isCommutePersonEvidence(value.primaryCommuteEvidence)) entry.primaryCommuteEvidence = value.primaryCommuteEvidence;
  if (isCommutePersonEvidence(value.partnerCommuteEvidence)) entry.partnerCommuteEvidence = value.partnerCommuteEvidence;
  return entry;
}

function readEnvelope(): GeoEvidenceCacheEnvelope {
  if (typeof window === "undefined") return { schemaVersion: GEO_EVIDENCE_SCHEMA_VERSION, entries: [] };
  try {
    const stored = window.localStorage.getItem(GEO_EVIDENCE_STORAGE_KEY);
    if (stored === null) return { schemaVersion: GEO_EVIDENCE_SCHEMA_VERSION, entries: [] };
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed) || parsed.schemaVersion !== GEO_EVIDENCE_SCHEMA_VERSION || !Array.isArray(parsed.entries)) {
      return { schemaVersion: GEO_EVIDENCE_SCHEMA_VERSION, entries: [] };
    }
    return {
      schemaVersion: GEO_EVIDENCE_SCHEMA_VERSION,
      entries: parsed.entries.map(parseEntry).filter((entry): entry is GeoEvidenceCacheEntry => entry !== null),
    };
  } catch {
    return { schemaVersion: GEO_EVIDENCE_SCHEMA_VERSION, entries: [] };
  }
}

function writeEnvelope(envelope: GeoEvidenceCacheEnvelope): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(GEO_EVIDENCE_STORAGE_KEY, JSON.stringify(envelope));
}

function isExpired(fetchedAt: string | undefined, ttlMs: number, nowMs: number): boolean {
  if (!fetchedAt) return true;
  const timestamp = Date.parse(fetchedAt);
  return !Number.isFinite(timestamp) || nowMs - timestamp >= ttlMs;
}

export function loadCachedPropertyGeoEvidence(
  property: Property,
  preferences: BuyerPreferences,
  nowMs = Date.now(),
): CachedPropertyGeoEvidence {
  const locationSignature = createLocationSignature(property);
  const commuteSignature = createCommuteSignature(locationSignature, preferences);
  const primaryCommuteSignature = createPersonCommuteSignature(locationSignature, resolvePrimaryCommutePreference(preferences));
  const partnerCommuteSignature = createPersonCommuteSignature(locationSignature, resolvePartnerCommutePreference(preferences));
  const storedEntry = readEnvelope().entries.find((entry) => entry.propertyId === property.id) ?? null;
  const locationMatches = storedEntry?.locationSignature === locationSignature;
  const commuteMatches = locationMatches && commuteSignature !== undefined && storedEntry?.commuteSignature === commuteSignature;
  const primaryMatches = locationMatches && primaryCommuteSignature !== undefined && storedEntry?.primaryCommuteSignature === primaryCommuteSignature;
  const partnerMatches = locationMatches && partnerCommuteSignature !== undefined && storedEntry?.partnerCommuteSignature === partnerCommuteSignature;
  const qualityPolicyMatches = storedEntry?.qualityPolicyVersion === GEO_EVIDENCE_QUALITY_POLICY_VERSION;
  const nearbySemanticsMatches = storedEntry?.nearbySemanticsVersion === GEO_NEARBY_SEMANTICS_VERSION;
  const evidence: PropertyGeoEvidence = {};

  if (locationMatches && storedEntry?.nearbyEvidence) {
    if (storedEntry.nearbyEvidence.publicTransport) evidence.public_transport = storedEntry.nearbyEvidence.publicTransport;
    if (nearbySemanticsMatches && storedEntry.nearbyEvidence.commercialAmenities) evidence.commercial_amenities = storedEntry.nearbyEvidence.commercialAmenities;
    if (nearbySemanticsMatches && storedEntry.nearbyEvidence.medicalAmenities) evidence.medical_amenities = storedEntry.nearbyEvidence.medicalAmenities;
  }
  const structuredCommute = buildCommuteGeoEvidence(
    preferences,
    primaryMatches ? storedEntry?.primaryCommuteEvidence : undefined,
    partnerMatches ? storedEntry?.partnerCommuteEvidence : undefined,
  );
  if (structuredCommute) evidence.commute = structuredCommute;
  else if (commuteMatches && storedEntry?.commuteEvidence) evidence.commute = storedEntry.commuteEvidence;

  return {
    entry: storedEntry,
    evidence,
    locationSignature,
    commuteSignature,
    primaryCommuteSignature,
    partnerCommuteSignature,
    nearbyStale: !locationMatches || !qualityPolicyMatches || !nearbySemanticsMatches || isExpired(storedEntry?.nearbyFetchedAt, NEARBY_EVIDENCE_TTL_MS, nowMs),
    commuteStale: Boolean(
      (primaryCommuteSignature && (!primaryMatches || !qualityPolicyMatches || isExpired(storedEntry?.primaryCommuteFetchedAt, COMMUTE_EVIDENCE_TTL_MS, nowMs))) ||
      (partnerCommuteSignature && (!partnerMatches || !qualityPolicyMatches || isExpired(storedEntry?.partnerCommuteFetchedAt, COMMUTE_EVIDENCE_TTL_MS, nowMs))),
    ),
    primaryCommuteStale: primaryCommuteSignature !== undefined && (!primaryMatches || !qualityPolicyMatches || isExpired(storedEntry?.primaryCommuteFetchedAt, COMMUTE_EVIDENCE_TTL_MS, nowMs)),
    partnerCommuteStale: partnerCommuteSignature !== undefined && (!partnerMatches || !qualityPolicyMatches || isExpired(storedEntry?.partnerCommuteFetchedAt, COMMUTE_EVIDENCE_TTL_MS, nowMs)),
  };
}

export function loadCachedGeoEvidenceForProperties(
  properties: Property[],
  preferences: BuyerPreferences,
  nowMs = Date.now(),
): Record<string, PropertyGeoEvidence> {
  return Object.fromEntries(properties.map((property) => [
    property.id,
    loadCachedPropertyGeoEvidence(property, preferences, nowMs).evidence,
  ]));
}

export function saveGeoEvidenceCacheEntry(
  entry: GeoEvidenceCacheEntry,
  expectedCurrentEntry: GeoEvidenceCacheEntry | null,
): boolean {
  const envelope = readEnvelope();
  const current = envelope.entries.find((item) => item.propertyId === entry.propertyId) ?? null;
  const expectedLocation = expectedCurrentEntry?.locationSignature ?? null;
  const expectedCommute = expectedCurrentEntry?.commuteSignature ?? null;
  const expectedPrimary = expectedCurrentEntry?.primaryCommuteSignature ?? null;
  const expectedPartner = expectedCurrentEntry?.partnerCommuteSignature ?? null;
  if ((current?.locationSignature ?? null) !== expectedLocation ||
    (current?.commuteSignature ?? null) !== expectedCommute ||
    (current?.primaryCommuteSignature ?? null) !== expectedPrimary ||
    (current?.partnerCommuteSignature ?? null) !== expectedPartner) {
    return false;
  }
  writeEnvelope({
    schemaVersion: GEO_EVIDENCE_SCHEMA_VERSION,
    entries: [...envelope.entries.filter((item) => item.propertyId !== entry.propertyId), entry],
  });
  return true;
}
