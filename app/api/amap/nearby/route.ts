import { NextResponse } from "next/server";
import {
  AMapGeocodingError,
  geocodeAddress,
  type AMapGeocodingErrorCode,
  type GeocodingResult,
} from "@/lib/amap/geocoding";
import {
  AMapNearbyError,
  getNearbyPoiEvidence,
  type AMapNearbyErrorCode,
  type NearbyPoiResult,
} from "@/lib/amap/nearby";

export const runtime = "nodejs";

type GeoEvidenceErrorCode = AMapGeocodingErrorCode | AMapNearbyErrorCode;

interface NearbySuccessResponse {
  ok: true;
  geocoding: GeocodingResult;
  nearby: NearbyPoiResult;
}

interface NearbyErrorResponse {
  ok: false;
  error: {
    code: GeoEvidenceErrorCode;
    message: string;
  };
}

const ERROR_HTTP_STATUS: Record<GeoEvidenceErrorCode, number> = {
  INVALID_ADDRESS: 400,
  GEOCODING_NOT_FOUND: 404,
  AMAP_API_ERROR: 502,
  INVALID_COORDINATES: 502,
  AMAP_NOT_CONFIGURED: 503,
  AMAP_TIMEOUT: 504,
};

function errorResponse(
  code: GeoEvidenceErrorCode,
  message: string,
): NextResponse<NearbyErrorResponse> {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status: ERROR_HTTP_STATUS[code] },
  );
}

export async function POST(
  request: Request,
): Promise<NextResponse<NearbySuccessResponse | NearbyErrorResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_ADDRESS", "请求内容必须是有效的 JSON。");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse("INVALID_ADDRESS", "请求结构无效。");
  }
  const candidate = body as Record<string, unknown>;
  const confirmed = candidate.confirmedLocation;
  const isConfirmed = typeof confirmed === "object" && confirmed !== null && !Array.isArray(confirmed);

  try {
    let geocoding: GeocodingResult;
    if (isConfirmed) {
      const location = confirmed as Record<string, unknown>;
      if (
        location.source !== "amap" || location.confirmedByUser !== true ||
        typeof location.formattedAddress !== "string" || !location.formattedAddress.trim() ||
        typeof location.lng !== "number" || !Number.isFinite(location.lng) || location.lng < -180 || location.lng > 180 ||
        typeof location.lat !== "number" || !Number.isFinite(location.lat) || location.lat < -90 || location.lat > 90
      ) return errorResponse("INVALID_COORDINATES", "已确认位置的坐标无效。");
      geocoding = {
        formattedAddress: location.formattedAddress.trim(),
        province: typeof location.province === "string" ? location.province : undefined,
        city: typeof location.city === "string" ? location.city : undefined,
        district: typeof location.district === "string" ? location.district : undefined,
        location: { lng: location.lng, lat: location.lat },
      };
    } else if (typeof candidate.address === "string") {
      geocoding = await geocodeAddress(candidate.address);
    } else {
      return errorResponse("INVALID_ADDRESS", "请提供 address 或已确认的位置。");
    }
    const nearby = await getNearbyPoiEvidence(geocoding.location);
    return NextResponse.json({ ok: true, geocoding, nearby });
  } catch (error) {
    if (error instanceof AMapGeocodingError || error instanceof AMapNearbyError) {
      return errorResponse(error.code, error.message);
    }
    return errorResponse("AMAP_API_ERROR", "高德 Geo Evidence 服务发生未知错误。");
  }
}
