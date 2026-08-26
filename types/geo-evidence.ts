import type { DimensionKey } from "./decision";

export const GEO_EVIDENCE_DIMENSIONS = [
  "commute",
  "public_transport",
  "commercial_amenities",
  "medical_amenities",
] as const satisfies readonly DimensionKey[];

export type GeoEvidenceDimension = (typeof GEO_EVIDENCE_DIMENSIONS)[number];
export type GeoEvidenceStatus = "verified" | "partial" | "insufficient";
export type GeoEvidenceQuality = "high" | "medium" | "low";
export type AMapRouteMode = "driving" | "transit" | "walking" | "cycling";
export type CommuteAvailabilityStatus = "verified" | "partial" | "unavailable";

export interface CommuteModeResult {
  minutes: number;
  distanceMeters: number;
}

export interface CommutePersonEvidence {
  destinationLabel: string;
  requestedMode: "driving" | "public_transit" | "walking" | "cycling" | "flexible";
  modeResults: Partial<Record<AMapRouteMode, CommuteModeResult>>;
  selectedMode?: AMapRouteMode;
  selectedMinutes?: number;
  status: CommuteAvailabilityStatus;
  quality: GeoEvidenceQuality;
  fetchedAt?: string;
}

interface GeoEvidenceBase {
  dimension: GeoEvidenceDimension;
  source: "amap";
  fetchedAt: string;
  status: GeoEvidenceStatus;
  quality: GeoEvidenceQuality;
  observation: string;
}

export interface CommuteGeoEvidence extends GeoEvidenceBase {
  dimension: "commute";
  primary?: CommutePersonEvidence;
  partner?: CommutePersonEvidence;
  /** Legacy single-route fields are accepted from older cache records. */
  mode?: "driving" | "transit" | "walking";
  durationMinutes?: number;
  distanceMeters?: number;
}

export interface PublicTransportGeoEvidence extends GeoEvidenceBase {
  dimension: "public_transport";
  nearestStationName?: string;
  nearestDistanceMeters?: number;
  stationCountWithin1000m?: number;
  busEvidenceAvailable?: boolean;
  nearestBusStopName?: string;
  nearestBusStopDistanceMeters?: number;
  busStopCountWithin500m?: number;
  busStopCountWithin800m?: number;
}

export interface CommercialAmenitiesGeoEvidence extends GeoEvidenceBase {
  dimension: "commercial_amenities";
  countWithin2000m: number;
  nearestDistanceMeters?: number;
  nearestName?: string;
  examples: string[];
}

export interface MedicalAmenitiesGeoEvidence extends GeoEvidenceBase {
  dimension: "medical_amenities";
  hospitalCountWithin3000m: number;
  nearestDistanceMeters?: number;
  nearestName?: string;
  examples: string[];
}

export type GeoDimensionEvidence =
  | CommuteGeoEvidence
  | PublicTransportGeoEvidence
  | CommercialAmenitiesGeoEvidence
  | MedicalAmenitiesGeoEvidence;

export type PropertyGeoEvidence = Partial<{
  commute: CommuteGeoEvidence;
  public_transport: PublicTransportGeoEvidence;
  commercial_amenities: CommercialAmenitiesGeoEvidence;
  medical_amenities: MedicalAmenitiesGeoEvidence;
}>;

export type GeoEvidenceByProperty = Record<string, PropertyGeoEvidence>;
