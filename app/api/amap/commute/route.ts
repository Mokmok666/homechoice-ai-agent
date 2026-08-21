import { NextResponse } from "next/server";
import {
  AMapCommuteError,
  COMMUTE_MODES,
  getCommuteEvidence,
  type AMapCommuteErrorCode,
  type CommuteMode,
  type CommuteResult,
} from "@/lib/amap/commute";

export const runtime = "nodejs";

interface CommuteSuccessResponse {
  ok: true;
  result: CommuteResult;
}

interface CommuteErrorResponse {
  ok: false;
  error: {
    code: AMapCommuteErrorCode;
    message: string;
  };
}

const ERROR_HTTP_STATUS: Record<AMapCommuteErrorCode, number> = {
  INVALID_INPUT: 400,
  ORIGIN_GEOCODING_FAILED: 422,
  DESTINATION_GEOCODING_FAILED: 422,
  TRANSIT_CITY_REQUIRED: 422,
  ROUTE_NOT_FOUND: 404,
  INVALID_ROUTE_RESULT: 502,
  AMAP_API_ERROR: 502,
  AMAP_NOT_CONFIGURED: 503,
  AMAP_TIMEOUT: 504,
};

function errorResponse(
  code: AMapCommuteErrorCode,
  message: string,
): NextResponse<CommuteErrorResponse> {
  return NextResponse.json(
    { ok: false, error: { code, message } },
    { status: ERROR_HTTP_STATUS[code] },
  );
}

function isMode(value: unknown): value is CommuteMode {
  return typeof value === "string" && (COMMUTE_MODES as readonly string[]).includes(value);
}

export async function POST(
  request: Request,
): Promise<NextResponse<CommuteSuccessResponse | CommuteErrorResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_INPUT", "请求内容必须是有效的 JSON。");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return errorResponse("INVALID_INPUT", "请求结构无效。");
  }
  const candidate = body as Record<string, unknown>;
  const rawOriginLocation = candidate.originLocation;
  const rawDestinationLocation = candidate.destinationLocation;
  const hasOriginLocation = typeof rawOriginLocation === "object" && rawOriginLocation !== null && !Array.isArray(rawOriginLocation);
  const hasDestinationLocation = typeof rawDestinationLocation === "object" && rawDestinationLocation !== null && !Array.isArray(rawDestinationLocation);
  if ((typeof candidate.originAddress !== "string" && !hasOriginLocation) || (typeof candidate.destinationAddress !== "string" && !hasDestinationLocation) || !isMode(candidate.mode)) {
    return errorResponse(
      "INVALID_INPUT",
      "originAddress、destinationAddress 和 mode 必须有效。",
    );
  }

  try {
    let originLocation;
    let destinationLocation;
    if (hasOriginLocation) {
      const raw = rawOriginLocation as Record<string, unknown>;
      if (
        typeof raw.formattedAddress !== "string" ||
        typeof raw.lng !== "number" || !Number.isFinite(raw.lng) || raw.lng < -180 || raw.lng > 180 ||
        typeof raw.lat !== "number" || !Number.isFinite(raw.lat) || raw.lat < -90 || raw.lat > 90
      ) return errorResponse("INVALID_INPUT", "originLocation 无效。");
      originLocation = {
        formattedAddress: raw.formattedAddress,
        province: typeof raw.province === "string" ? raw.province : undefined,
        city: typeof raw.city === "string" ? raw.city : undefined,
        district: typeof raw.district === "string" ? raw.district : undefined,
        location: { lng: raw.lng, lat: raw.lat },
      };
    }
    if (hasDestinationLocation) {
      const raw = rawDestinationLocation as Record<string, unknown>;
      if (
        typeof raw.formattedAddress !== "string" ||
        typeof raw.lng !== "number" || !Number.isFinite(raw.lng) || raw.lng < -180 || raw.lng > 180 ||
        typeof raw.lat !== "number" || !Number.isFinite(raw.lat) || raw.lat < -90 || raw.lat > 90
      ) return errorResponse("INVALID_INPUT", "destinationLocation 无效。");
      destinationLocation = {
        formattedAddress: raw.formattedAddress,
        province: typeof raw.province === "string" ? raw.province : undefined,
        city: typeof raw.city === "string" ? raw.city : undefined,
        district: typeof raw.district === "string" ? raw.district : undefined,
        location: { lng: raw.lng, lat: raw.lat },
      };
    }
    const result = await getCommuteEvidence({
      originAddress: typeof candidate.originAddress === "string" ? candidate.originAddress : undefined,
      originLocation,
      destinationAddress: typeof candidate.destinationAddress === "string" ? candidate.destinationAddress : "",
      destinationLocation,
      mode: candidate.mode,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    if (error instanceof AMapCommuteError) {
      return errorResponse(error.code, error.message);
    }
    return errorResponse("AMAP_API_ERROR", "高德通勤证据服务发生未知错误。");
  }
}
