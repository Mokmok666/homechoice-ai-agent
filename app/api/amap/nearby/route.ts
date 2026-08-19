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

  if (
    typeof body !== "object" ||
    body === null ||
    Array.isArray(body) ||
    typeof (body as Record<string, unknown>).address !== "string"
  ) {
    return errorResponse("INVALID_ADDRESS", "address 必须是字符串。");
  }

  try {
    const geocoding = await geocodeAddress((body as { address: string }).address);
    const nearby = await getNearbyPoiEvidence(geocoding.location);
    return NextResponse.json({ ok: true, geocoding, nearby });
  } catch (error) {
    if (error instanceof AMapGeocodingError || error instanceof AMapNearbyError) {
      return errorResponse(error.code, error.message);
    }
    return errorResponse("AMAP_API_ERROR", "高德 Geo Evidence 服务发生未知错误。");
  }
}
