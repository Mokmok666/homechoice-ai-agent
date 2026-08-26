const AMAP_NEARBY_ENDPOINT = "https://restapi.amap.com/v5/place/around";
const AMAP_NEARBY_RADIUS_METERS = 1_000;
const AMAP_METRO_SEARCH_RADIUS_METERS = 5_000;
const AMAP_COMMERCIAL_RADIUS_METERS = 2_000;
const AMAP_MEDICAL_RADIUS_METERS = 3_000;
const AMAP_REQUEST_TIMEOUT_MS = 10_000;
const MAX_EXAMPLES = 5;

const POI_TYPES = {
  metro: "150500",
  bus: "150700",
  commercial: "060100",
  supermarket: "060400",
  medical: "090100|090203|090204|090205|090206|090207|090208|090209|090210|090211",
  park: "110101",
} as const;

export interface NearbyCoordinates {
  lng: number;
  lat: number;
}

export interface NearbyPoiResult {
  availability: {
    metro: boolean;
    bus: boolean;
    commercial: boolean;
    supermarket: boolean;
    medical: boolean;
    park: boolean;
  };
  metro: {
    nearest?: {
      name: string;
      distanceMeters: number;
      location: NearbyCoordinates;
    };
    countWithin1000m: number;
  };
  bus: {
    nearest?: {
      name: string;
      distanceMeters: number;
      location: NearbyCoordinates;
    };
    countWithin500m: number;
    countWithin800m: number;
  };
  commercial: {
    countWithin2000m: number;
    nearest?: { name: string; distanceMeters: number; location: NearbyCoordinates };
    examples: string[];
  };
  medical: {
    hospitalCountWithin3000m: number;
    nearest?: { name: string; distanceMeters: number; location: NearbyCoordinates };
    examples: string[];
  };
  nearbyFacilities: {
    supermarketCount: number;
    parkCount: number;
    examples: string[];
  };
  fetchedAt: string;
}

export type AMapNearbyErrorCode =
  | "AMAP_NOT_CONFIGURED"
  | "INVALID_COORDINATES"
  | "AMAP_API_ERROR"
  | "AMAP_TIMEOUT";

export class AMapNearbyError extends Error {
  constructor(
    public readonly code: AMapNearbyErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AMapNearbyError";
  }
}

interface NormalizedPoi {
  id: string;
  name: string;
  typecode?: string;
  type?: string;
  location: NearbyCoordinates;
}

interface PoiSearchResult {
  count: number;
  pois: NormalizedPoi[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidCoordinates({ lng, lat }: NearbyCoordinates): boolean {
  return Number.isFinite(lng) && Number.isFinite(lat) &&
    lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

function parsePoiLocation(value: unknown): NearbyCoordinates | null {
  if (typeof value !== "string") return null;
  const parts = value.split(",");
  if (parts.length !== 2) return null;
  const location = { lng: Number(parts[0]), lat: Number(parts[1]) };
  return isValidCoordinates(location) ? location : null;
}

function parseCount(value: unknown): number {
  const count = typeof value === "number" ? value : Number(value);
  return Number.isInteger(count) && count >= 0 ? count : 0;
}

function normalizePois(value: unknown): NormalizedPoi[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const normalized: NormalizedPoi[] = [];

  value.forEach((candidate) => {
    if (!isRecord(candidate) || typeof candidate.name !== "string") return;
    const name = candidate.name.trim();
    const location = parsePoiLocation(candidate.location);
    if (!name || !location) return;
    const providerId = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const dedupeKey = providerId || `${name}:${location.lng},${location.lat}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    normalized.push({
      id: providerId || dedupeKey,
      name,
      typecode: typeof candidate.typecode === "string" ? candidate.typecode.trim() : undefined,
      type: typeof candidate.type === "string" ? candidate.type.trim() : undefined,
      location,
    });
  });

  return normalized;
}

const COMMERCIAL_EXCLUSION = /便利店|超市|市场|菜市场|餐厅|饭店|咖啡|小吃|药店|药房|酒店|宾馆|KTV|影院|网吧|会所|足浴|按摩|生活服务|专卖店|便利超市|建设中|在建|停车场|出入口|入口|[东南西北]门|\d+号楼|\d+座/;
const COMMERCIAL_NAME_SIGNAL = /商场|购物中心|商业中心|商业综合体|购物广场|商业广场|百货/;
const MEDICAL_NAME_EXCLUSION = /药店|药房|诊所|门诊部|口腔|牙科|医美|美容|体检|保健|按摩|养老|护理院|卫生站|卫生室/;
const MEDICAL_TYPE_EXCLUSION = /口腔医院|整形美容|诊所|卫生所|卫生站/;
const MEDICAL_NAME_SIGNAL = /医院|医疗中心/;

function isLargeCommercialPoi(poi: NormalizedPoi): boolean {
  if (COMMERCIAL_EXCLUSION.test(`${poi.name} ${poi.type ?? ""}`)) return false;
  const structuredMall = poi.typecode?.startsWith("0601") === true && /商场|购物中心|百货|商业综合体/.test(poi.type ?? "");
  return structuredMall || (!poi.typecode && COMMERCIAL_NAME_SIGNAL.test(poi.name));
}

function isFormalHospitalPoi(poi: NormalizedPoi): boolean {
  if (MEDICAL_NAME_EXCLUSION.test(poi.name) || MEDICAL_TYPE_EXCLUSION.test(poi.type ?? "")) return false;
  const structuredHospital = poi.typecode?.startsWith("0901") === true || poi.typecode?.startsWith("0902") === true;
  return structuredHospital && MEDICAL_NAME_SIGNAL.test(`${poi.name} ${poi.type ?? ""}`);
}

function canonicalHospitalName(name: string): string {
  return name.match(/^(.{2,}?医院)/)?.[1] ?? name;
}

function distanceInMeters(origin: NearbyCoordinates, target: NearbyCoordinates): number {
  const toRadians = (degrees: number) => degrees * Math.PI / 180;
  const earthRadiusMeters = 6_371_000;
  const latDelta = toRadians(target.lat - origin.lat);
  const lngDelta = toRadians(target.lng - origin.lng);
  const originLat = toRadians(origin.lat);
  const targetLat = toRadians(target.lat);
  const haversine = Math.sin(latDelta / 2) ** 2 +
    Math.cos(originLat) * Math.cos(targetLat) * Math.sin(lngDelta / 2) ** 2;
  return 2 * earthRadiusMeters * Math.asin(Math.sqrt(haversine));
}

function uniqueExamples(groups: readonly NormalizedPoi[][]): string[] {
  const names = new Set<string>();
  const longestGroup = Math.max(0, ...groups.map((group) => group.length));
  for (let index = 0; index < longestGroup && names.size < MAX_EXAMPLES; index += 1) {
    for (const group of groups) {
      const poi = group[index];
      if (poi) names.add(poi.name);
      if (names.size >= MAX_EXAMPLES) break;
    }
  }
  return [...names];
}

async function searchNearbyByTypes(
  coordinates: NearbyCoordinates,
  types: string,
  apiKey: string,
  radiusMeters = AMAP_NEARBY_RADIUS_METERS,
): Promise<PoiSearchResult> {
  const url = new URL(AMAP_NEARBY_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("location", `${coordinates.lng.toFixed(6)},${coordinates.lat.toFixed(6)}`);
  url.searchParams.set("radius", String(radiusMeters));
  url.searchParams.set("types", types);
  url.searchParams.set("sortrule", "distance");
  url.searchParams.set("page_size", "25");
  url.searchParams.set("page_num", "1");
  url.searchParams.set("output", "JSON");

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AMAP_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AMapNearbyError("AMAP_API_ERROR", "高德 POI 服务返回了无法解析的响应。");
    }
    if (!response.ok || !isRecord(payload) || payload.status !== "1") {
      throw new AMapNearbyError("AMAP_API_ERROR", "高德周边 POI 请求失败。");
    }
    return {
      count: parseCount(payload.count),
      pois: normalizePois(payload.pois),
    };
  } catch (error) {
    if (error instanceof AMapNearbyError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AMapNearbyError("AMAP_TIMEOUT", "高德周边 POI 请求超时。");
    }
    throw new AMapNearbyError("AMAP_API_ERROR", "暂时无法连接高德周边 POI 服务。");
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retrieves independent, real AMap POI evidence within a 1 km radius.
 * The API key, provider URL and raw responses never leave the server.
 */
export async function getNearbyPoiEvidence(
  coordinates: NearbyCoordinates,
): Promise<NearbyPoiResult> {
  if (!isValidCoordinates(coordinates)) {
    throw new AMapNearbyError("INVALID_COORDINATES", "请输入有效的经纬度坐标。");
  }
  const apiKey = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!apiKey) {
    throw new AMapNearbyError("AMAP_NOT_CONFIGURED", "高德 Web 服务尚未配置。");
  }

  const settled = await Promise.allSettled([
    searchNearbyByTypes(coordinates, POI_TYPES.metro, apiKey, AMAP_METRO_SEARCH_RADIUS_METERS),
    searchNearbyByTypes(coordinates, POI_TYPES.bus, apiKey),
    searchNearbyByTypes(coordinates, POI_TYPES.commercial, apiKey, AMAP_COMMERCIAL_RADIUS_METERS),
    searchNearbyByTypes(coordinates, POI_TYPES.supermarket, apiKey),
    searchNearbyByTypes(coordinates, POI_TYPES.medical, apiKey, AMAP_MEDICAL_RADIUS_METERS),
    searchNearbyByTypes(coordinates, POI_TYPES.park, apiKey),
  ]);
  if (settled.every((result) => result.status === "rejected")) {
    const firstError = settled.find((result) => result.status === "rejected");
    throw firstError?.status === "rejected" && firstError.reason instanceof AMapNearbyError
      ? firstError.reason
      : new AMapNearbyError("AMAP_API_ERROR", "高德周边 POI 请求全部失败。");
  }

  const emptySearch: PoiSearchResult = { count: 0, pois: [] };
  const metroAvailable = settled[0].status === "fulfilled";
  const busAvailable = settled[1].status === "fulfilled";
  const commercialAvailable = settled[2].status === "fulfilled";
  const supermarketAvailable = settled[3].status === "fulfilled";
  const medicalAvailable = settled[4].status === "fulfilled";
  const parkAvailable = settled[5].status === "fulfilled";
  const metro = settled[0].status === "fulfilled" ? settled[0].value : emptySearch;
  const bus = settled[1].status === "fulfilled" ? settled[1].value : emptySearch;
  const commercial = settled[2].status === "fulfilled" ? settled[2].value : emptySearch;
  const supermarket = settled[3].status === "fulfilled" ? settled[3].value : emptySearch;
  const medical = settled[4].status === "fulfilled" ? settled[4].value : emptySearch;
  const park = settled[5].status === "fulfilled" ? settled[5].value : emptySearch;

  const mainMetroStations = metro.pois.filter((poi) => poi.typecode === "150500");
  const metroCandidates = mainMetroStations.length > 0 ? mainMetroStations : metro.pois;
  const metroWithDistance = metroCandidates
    .map((poi) => ({ poi, distanceMeters: Math.round(distanceInMeters(coordinates, poi.location)) }));
  const nearestMetro = metroWithDistance
    .sort((left, right) => left.distanceMeters - right.distanceMeters)[0];
  const busWithDistance = bus.pois
    .map((poi) => ({ poi, distanceMeters: Math.round(distanceInMeters(coordinates, poi.location)) }))
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
  const nearestBus = busWithDistance[0];
  const commercialWithDistance = commercial.pois
    .filter(isLargeCommercialPoi)
    .map((poi) => ({ poi, distanceMeters: Math.round(distanceInMeters(coordinates, poi.location)) }))
    .filter((item) => item.distanceMeters <= AMAP_COMMERCIAL_RADIUS_METERS)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
  const medicalCandidates = medical.pois
    .filter(isFormalHospitalPoi)
    .map((poi) => ({ poi: { ...poi, name: canonicalHospitalName(poi.name) }, distanceMeters: Math.round(distanceInMeters(coordinates, poi.location)) }))
    .filter((item) => item.distanceMeters <= AMAP_MEDICAL_RADIUS_METERS)
    .sort((left, right) => left.distanceMeters - right.distanceMeters);
  const seenHospitals = new Set<string>();
  const medicalWithDistance = medicalCandidates.filter((item) => {
    const key = item.poi.name.normalize("NFKC").replace(/[\s·•・]/g, "");
    if (seenHospitals.has(key)) return false;
    seenHospitals.add(key);
    return true;
  });
  const nearestCommercial = commercialWithDistance[0];
  const nearestHospital = medicalWithDistance[0];

  return {
    availability: {
      metro: metroAvailable,
      bus: busAvailable,
      commercial: commercialAvailable,
      supermarket: supermarketAvailable,
      medical: medicalAvailable,
      park: parkAvailable,
    },
    metro: {
      ...(nearestMetro ? {
        nearest: {
          name: nearestMetro.poi.name,
          distanceMeters: nearestMetro.distanceMeters,
          location: nearestMetro.poi.location,
        },
      } : {}),
      countWithin1000m: metroWithDistance.filter((item) => item.distanceMeters <= AMAP_NEARBY_RADIUS_METERS).length,
    },
    bus: {
      ...(nearestBus ? { nearest: { name: nearestBus.poi.name, distanceMeters: nearestBus.distanceMeters, location: nearestBus.poi.location } } : {}),
      countWithin500m: busWithDistance.filter((item) => item.distanceMeters <= 500).length,
      countWithin800m: busWithDistance.filter((item) => item.distanceMeters <= 800).length,
    },
    commercial: {
      countWithin2000m: commercialWithDistance.length,
      ...(nearestCommercial ? { nearest: { name: nearestCommercial.poi.name, distanceMeters: nearestCommercial.distanceMeters, location: nearestCommercial.poi.location } } : {}),
      examples: uniqueExamples([commercialWithDistance.map((item) => item.poi)]),
    },
    medical: {
      hospitalCountWithin3000m: medicalWithDistance.length,
      ...(nearestHospital ? { nearest: { name: nearestHospital.poi.name, distanceMeters: nearestHospital.distanceMeters, location: nearestHospital.poi.location } } : {}),
      examples: uniqueExamples([medicalWithDistance.map((item) => item.poi)]),
    },
    nearbyFacilities: {
      supermarketCount: supermarket.pois.length,
      parkCount: park.pois.length,
      examples: uniqueExamples([supermarket.pois, park.pois]),
    },
    fetchedAt: new Date().toISOString(),
  };
}
