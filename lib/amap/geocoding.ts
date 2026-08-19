const AMAP_GEOCODING_ENDPOINT = "https://restapi.amap.com/v3/geocode/geo";
const AMAP_REQUEST_TIMEOUT_MS = 10_000;

export interface GeocodingResult {
  formattedAddress: string;
  province?: string;
  city?: string;
  district?: string;
  location: {
    lng: number;
    lat: number;
  };
}

export type AMapGeocodingErrorCode =
  | "AMAP_NOT_CONFIGURED"
  | "INVALID_ADDRESS"
  | "AMAP_API_ERROR"
  | "AMAP_TIMEOUT"
  | "GEOCODING_NOT_FOUND"
  | "INVALID_COORDINATES";

export class AMapGeocodingError extends Error {
  constructor(
    public readonly code: AMapGeocodingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AMapGeocodingError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeFormattedAddress(value: string): string {
  let normalized = value.trim();
  // Only collapse duplicated administrative suffixes at the end. A global
  // replacement could damage legitimate names such as “海珠区区庄”.
  for (const suffix of ["街道", "省", "市", "区"] as const) {
    const duplicate = `${suffix}${suffix}`;
    while (normalized.endsWith(duplicate)) {
      normalized = normalized.slice(0, -suffix.length);
    }
  }
  return normalized;
}

function parseLocation(value: unknown): GeocodingResult["location"] {
  if (typeof value !== "string") {
    throw new AMapGeocodingError("INVALID_COORDINATES", "高德返回了无效的坐标信息。");
  }

  const parts = value.split(",");
  if (parts.length !== 2) {
    throw new AMapGeocodingError("INVALID_COORDINATES", "高德返回了无效的坐标信息。");
  }

  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (
    !Number.isFinite(lng) ||
    !Number.isFinite(lat) ||
    lng < -180 ||
    lng > 180 ||
    lat < -90 ||
    lat > 90
  ) {
    throw new AMapGeocodingError("INVALID_COORDINATES", "高德返回了无效的坐标信息。");
  }

  return { lng, lat };
}

/**
 * Server-side only. The Web Service key is read here and is never returned.
 */
export async function geocodeAddress(address: string): Promise<GeocodingResult> {
  const normalizedAddress = address.trim();
  if (!normalizedAddress) {
    throw new AMapGeocodingError("INVALID_ADDRESS", "请输入需要解析的地址。");
  }

  const apiKey = process.env.AMAP_WEB_SERVICE_KEY?.trim();
  if (!apiKey) {
    throw new AMapGeocodingError("AMAP_NOT_CONFIGURED", "高德 Web 服务尚未配置。");
  }

  const url = new URL(AMAP_GEOCODING_ENDPOINT);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("address", normalizedAddress);
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
      throw new AMapGeocodingError("AMAP_API_ERROR", "高德服务返回了无法解析的响应。");
    }

    if (!response.ok || !isRecord(payload) || payload.status !== "1") {
      throw new AMapGeocodingError("AMAP_API_ERROR", "高德地理编码请求失败。");
    }

    if (!Array.isArray(payload.geocodes) || payload.geocodes.length === 0) {
      throw new AMapGeocodingError("GEOCODING_NOT_FOUND", "未找到该地址对应的位置。");
    }

    const geocode = payload.geocodes[0];
    if (!isRecord(geocode)) {
      throw new AMapGeocodingError("GEOCODING_NOT_FOUND", "未找到该地址对应的位置。");
    }

    const rawFormattedAddress = optionalText(geocode.formatted_address);
    if (!rawFormattedAddress) {
      throw new AMapGeocodingError("GEOCODING_NOT_FOUND", "未找到有效的格式化地址。");
    }
    const formattedAddress = normalizeFormattedAddress(rawFormattedAddress);

    return {
      formattedAddress,
      province: optionalText(geocode.province),
      city: optionalText(geocode.city),
      district: optionalText(geocode.district),
      location: parseLocation(geocode.location),
    };
  } catch (error) {
    if (error instanceof AMapGeocodingError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AMapGeocodingError("AMAP_TIMEOUT", "高德地理编码请求超时。");
    }
    throw new AMapGeocodingError("AMAP_API_ERROR", "暂时无法连接高德地理编码服务。");
  } finally {
    clearTimeout(timeoutId);
  }
}
