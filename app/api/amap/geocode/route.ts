import { NextResponse } from "next/server";
import {
  AMapGeocodingError,
  geocodeAddress,
  type AMapGeocodingErrorCode,
  type GeocodingResult,
} from "@/lib/amap/geocoding";

export const runtime = "nodejs";

interface GeocodingSuccessResponse {
  ok: true;
  result: GeocodingResult;
}

interface GeocodingErrorResponse {
  ok: false;
  error: {
    code: AMapGeocodingErrorCode;
    message: string;
  };
}

const ERROR_HTTP_STATUS: Record<AMapGeocodingErrorCode, number> = {
  INVALID_ADDRESS: 400,
  GEOCODING_NOT_FOUND: 404,
  AMAP_API_ERROR: 502,
  INVALID_COORDINATES: 502,
  AMAP_NOT_CONFIGURED: 503,
  AMAP_TIMEOUT: 504,
};

function errorResponse(
  code: AMapGeocodingErrorCode,
  message: string,
): NextResponse<GeocodingErrorResponse> {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status: ERROR_HTTP_STATUS[code] },
  );
}

export async function POST(
  request: Request,
): Promise<NextResponse<GeocodingSuccessResponse | GeocodingErrorResponse>> {
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
    const result = await geocodeAddress((body as { address: string }).address);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof AMapGeocodingError) {
      return errorResponse(error.code, error.message);
    }
    return errorResponse("AMAP_API_ERROR", "高德地理编码服务发生未知错误。");
  }
}
