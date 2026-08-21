import type { DimensionKey } from "./decision";

export const GEO_EVIDENCE_DIMENSIONS = [
  "commute",
  "public_transport",
  "commercial_amenities",
  "daily_life_amenities",
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
  nearestStationName: string;
  nearestDistanceMeters: number;
  stationCountWithin1000m: number;
}

export interface CommercialAmenitiesGeoEvidence extends GeoEvidenceBase {
  dimension: "commercial_amenities";
  countWithin1000m: number;
  hasMajorDestination: boolean;
  examples: string[];
}

export interface DailyLifeAmenitiesGeoEvidence extends GeoEvidenceBase {
  dimension: "daily_life_amenities";
  supermarketCount: number;
  medicalCount: number;
  parkCount: number;
  examples: string[];
  availableCategories: ("supermarket" | "medical" | "park")[];
}

export type GeoDimensionEvidence =
  | CommuteGeoEvidence
  | PublicTransportGeoEvidence
  | CommercialAmenitiesGeoEvidence
  | DailyLifeAmenitiesGeoEvidence;

export type PropertyGeoEvidence = Partial<{
  commute: CommuteGeoEvidence;
  public_transport: PublicTransportGeoEvidence;
  commercial_amenities: CommercialAmenitiesGeoEvidence;
  daily_life_amenities: DailyLifeAmenitiesGeoEvidence;
}>;

export type GeoEvidenceByProperty = Record<string, PropertyGeoEvidence>;
