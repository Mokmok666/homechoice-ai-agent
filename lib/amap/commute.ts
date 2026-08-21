import {
  AMapGeocodingError,
  geocodeAddress,
  type GeocodingResult,
} from "./geocoding";

const AMAP_REQUEST_TIMEOUT_MS = 12_000;

const ROUTE_ENDPOINTS = {
  driving: "https://restapi.amap.com/v5/direction/driving",
  walking: "https://restapi.amap.com/v5/direction/walking",
  cycling: "https://restapi.amap.com/v5/direction/bicycling",
  transit: "https://restapi.amap.com/v3/direction/transit/integrated",
} as const;

export const COMMUTE_MODES = ["driving", "transit", "walking", "cycling"] as const;
export type CommuteMode = (typeof COMMUTE_MODES)[number];

export interface CommuteInput {
  originAddress?: string;
  originLocation?: GeocodingResult;
  destinationAddress: string;
  destinationLocation?: GeocodingResult;
  mode: CommuteMode;
}

export interface CommuteResult {
  origin: {
    formattedAddress: string;
    lng: number;
    lat: number;
  };
  destination: {
    formattedAddress: string;
    lng: number;
    lat: number;
  };
  mode: CommuteMode;
  durationMinutes: number;
  distanceMeters: number;
  fetchedAt: string;
}

export type AMapCommuteErrorCode =
  | "AMAP_NOT_CONFIGURED"
  | "INVALID_INPUT"
  | "ORIGIN_GEOCODING_FAILED"
  | "DESTINATION_GEOCODING_FAILED"
  | "TRANSIT_CITY_REQUIRED"
  | "ROUTE_NOT_FOUND"
  | "INVALID_ROUTE_RESULT"
  | "AMAP_API_ERROR"
  | "AMAP_TIMEOUT";

export class AMapCommuteError extends Error {
  constructor(
    public readonly code: AMapCommuteErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AMapCommuteError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCommuteMode(value: unknown): value is CommuteMode {
  return typeof value === "string" && (COMMUTE_MODES as readonly string[]).includes(value);
}

function coordinateText(result: GeocodingResult): string {
  return `${result.location.lng.toFixed(6)},${result.location.lat.toFixed(6)}`;
}

function normalizeEndpoint(result: GeocodingResult): CommuteResult["origin"] {
  return {
    formattedAddress: result.formattedAddress,
    lng: result.location.lng,
    lat: result.location.lat,
  };
}

function parsePositiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function geocodeCommuteAddress(
  address: string,
  endpoint: "origin" | "destination",
): Promise<GeocodingResult> {
  try {
    return await geocodeAddress(address);
  } catch (error) {
    if (error instanceof AMapGeocodingError) {
      if (error.code === "AMAP_NOT_CONFIGURED") {
        throw new AMapCommuteError("AMAP_NOT_CONFIGURED", "高德 Web 服务尚未配置。");
      }
      if (error.code === "AMAP_TIMEOUT") {
        throw new AMapCommuteError("AMAP_TIMEOUT", "高德地址解析请求超时。");
      }
      throw new AMapCommuteError(
        endpoint === "origin" ? "ORIGIN_GEOCODING_FAILED" : "DESTINATION_GEOCODING_FAILED",
        endpoint === "origin" ? "无法解析出发地址。" : "无法解析目的地地址。",
      );
    }
    throw new AMapCommuteError("AMAP_API_ERROR", "地址解析服务发生未知错误。");
  }
}

function createRouteUrl(
  mode: CommuteMode,
  origin: GeocodingResult,
  destination: GeocodingResult,
  apiKey: string,
): URL {
  const url = new URL(ROUTE_ENDPOINTS[mode]);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("origin", coordinateText(origin));
  url.searchParams.set("destination", coordinateText(destination));
  url.searchParams.set("output", "JSON");

  if (mode === "driving") {
    url.searchParams.set("strategy", "32");
    url.searchParams.set("show_fields", "cost");
  } else if (mode === "walking" || mode === "cycling") {
    url.searchParams.set("show_fields", "cost");
  } else {
    if (!origin.city || !destination.city) {
      throw new AMapCommuteError(
        "TRANSIT_CITY_REQUIRED",
        "公交规划需要能够识别起点和终点城市。",
      );
    }
    url.searchParams.set("city", origin.city);
    if (origin.city !== destination.city) url.searchParams.set("cityd", destination.city);
    url.searchParams.set("strategy", "0");
    url.searchParams.set("extensions", "base");
  }

  return url;
}

function parseRouteMetrics(
  payload: Record<string, unknown>,
  mode: CommuteMode,
): { durationSeconds: number; distanceMeters: number } {
  const route = payload.route;
  if (!isRecord(route)) {
    throw new AMapCommuteError("ROUTE_NOT_FOUND", "高德未返回可用的通勤路线。");
  }

  const candidates = mode === "transit" ? route.transits : route.paths;
  if (!Array.isArray(candidates) || candidates.length === 0 || !isRecord(candidates[0])) {
    throw new AMapCommuteError("ROUTE_NOT_FOUND", "未找到符合条件的通勤路线。");
  }

  const selectedRoute = candidates[0];
  const distanceMeters = parsePositiveNumber(selectedRoute.distance);
  const durationSeconds = mode === "transit"
    ? parsePositiveNumber(selectedRoute.duration)
    : isRecord(selectedRoute.cost)
      ? parsePositiveNumber(selectedRoute.cost.duration)
      : parsePositiveNumber(selectedRoute.duration);

  if (distanceMeters === null || durationSeconds === null) {
    throw new AMapCommuteError("INVALID_ROUTE_RESULT", "高德返回的路线距离或时长无效。");
  }

  return { durationSeconds, distanceMeters };
}

async function requestRoute(
  mode: CommuteMode,
  origin: GeocodingResult,
  destination: GeocodingResult,
  apiKey: string,
): Promise<{ durationSeconds: number; distanceMeters: number }> {
  const url = createRouteUrl(mode, origin, destination, apiKey);
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
      throw new AMapCommuteError("AMAP_API_ERROR", "高德路径规划返回了无法解析的响应。");
    }
    if (!response.ok || !isRecord(payload) || payload.status !== "1") {
      throw new AMapCommuteError("AMAP_API_ERROR", "高德路径规划请求失败。");
    }
    return parseRouteMetrics(payload, mode);
  } catch (error) {
    if (error instanceof AMapCommuteError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AMapCommuteError("AMAP_TIMEOUT", "高德路径规划请求超时。");
    }
    throw new AMapCommuteError("AMAP_API_ERROR", "暂时无法连接高德路径规划服务。");
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Retrieves real AMap route evidence without assigning any product score.
 */
export async function getCommuteEvidence(input: CommuteInput): Promise<CommuteResult> {
  const originAddress = input.originAddress?.trim() ?? "";
  const destinationAddress = input.destinationAddress.trim();
  if ((!originAddress && !input.originLocation) || (!destinationAddress && !input.destinationLocation) || !isCommuteMode(input.mode)) {
    throw new AMapCommuteError("INVALID_INPUT", "请提供有效的出发地址、目的地地址和通勤方式。");
  }

  const apiKey = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!apiKey) {
    throw new AMapCommuteError("AMAP_NOT_CONFIGURED", "高德 Web 服务尚未配置。");
  }

  const [origin, destination] = await Promise.all([
    input.originLocation ? Promise.resolve(input.originLocation) : geocodeCommuteAddress(originAddress, "origin"),
    input.destinationLocation ? Promise.resolve(input.destinationLocation) : geocodeCommuteAddress(destinationAddress, "destination"),
  ]);
  const route = await requestRoute(input.mode, origin, destination, apiKey);

  return {
    origin: normalizeEndpoint(origin),
    destination: normalizeEndpoint(destination),
    mode: input.mode,
    durationMinutes: Math.ceil(route.durationSeconds / 60),
    distanceMeters: Math.round(route.distanceMeters),
    fetchedAt: new Date().toISOString(),
  };
}
