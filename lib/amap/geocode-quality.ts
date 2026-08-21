import type { GeoEvidenceQuality } from "@/types/geo-evidence";

export interface GeocodeQualityCandidate {
  formattedAddress: string;
  province?: string;
  city?: string;
  district?: string;
  location: {
    lng: number;
    lat: number;
  };
}

export interface GeocodeQualityInput {
  city: string;
  district: string;
  address: string;
  geocoding: GeocodeQualityCandidate;
}

function normalizeText(value: string | undefined): string {
  return (value ?? "")
    .trim()
    .replace(/[\s·,，。()（）-]+/g, "")
    .toLocaleLowerCase("zh-CN");
}

function normalizeAdministrativeName(
  value: string | undefined,
  suffixes: readonly string[],
): string {
  let normalized = normalizeText(value);
  for (const suffix of suffixes) {
    if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
      normalized = normalized.slice(0, -suffix.length);
      break;
    }
  }
  return normalized;
}

function administrativeAreaMatches(
  expected: string,
  actual: string | undefined,
  formattedAddress: string,
  suffixes: readonly string[],
): boolean {
  const normalizedExpected = normalizeAdministrativeName(expected, suffixes);
  if (!normalizedExpected) return false;

  const normalizedActual = normalizeAdministrativeName(actual, suffixes);
  if (normalizedActual) return normalizedActual === normalizedExpected;

  return normalizeText(formattedAddress).includes(normalizedExpected);
}

function hasValidCoordinates(candidate: GeocodeQualityCandidate): boolean {
  const { lng, lat } = candidate.location;
  return Number.isFinite(lng) && Number.isFinite(lat) &&
    lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function hasConcreteGeocodeResult(
  input: GeocodeQualityInput,
): boolean {
  let remaining = normalizeText(input.geocoding.formattedAddress);
  const removableSegments = [
    input.geocoding.province,
    input.geocoding.city,
    input.geocoding.district,
    input.city,
    input.district,
  ];

  for (const segment of removableSegments) {
    const normalizedSegment = normalizeText(segment);
    if (normalizedSegment) remaining = remaining.replace(normalizedSegment, "");
  }

  return remaining.length >= 2;
}

function hasPreciseUserAddress(address: string): boolean {
  const normalized = address.trim();
  return /\d+\s*(号|弄|栋|座|室)/.test(normalized) ||
    /(?:大道|路|街|巷).+\d+/.test(normalized);
}

/**
 * Evaluates whether an AMap location is usable for deterministic evidence.
 * A provider success is not sufficient: it must agree with the user's
 * administrative context and point to a concrete location.
 */
export function evaluateAMapGeocodeQuality(
  input: GeocodeQualityInput,
): GeoEvidenceQuality {
  const city = input.city.trim();
  const district = input.district.trim();
  const address = input.address.trim();
  const formattedAddress = input.geocoding.formattedAddress.trim();

  if (!city || !address || !formattedAddress || !hasValidCoordinates(input.geocoding)) {
    return "low";
  }

  if (!administrativeAreaMatches(
    city,
    input.geocoding.city,
    formattedAddress,
    ["特别行政区", "自治州", "地区", "盟", "市"],
  )) return "low";

  if (district && !administrativeAreaMatches(
    district,
    input.geocoding.district,
    formattedAddress,
    ["自治县", "新区", "区", "县", "市"],
  )) return "low";

  if (!hasConcreteGeocodeResult(input)) return "low";

  return hasPreciseUserAddress(address) ? "high" : "medium";
}
