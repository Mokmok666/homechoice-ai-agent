import { NextResponse } from "next/server";
import {
  AMapAdministrativeError,
  getAdministrativeDistricts,
  searchAdministrativeCities,
  type AMapAdministrativeErrorCode,
} from "@/lib/amap/administrative";

export const runtime = "nodejs";

const HTTP_STATUS: Record<AMapAdministrativeErrorCode, number> = {
  INVALID_INPUT: 400,
  ADMINISTRATIVE_NOT_FOUND: 404,
  AMAP_API_ERROR: 502,
  AMAP_NOT_CONFIGURED: 503,
  AMAP_TIMEOUT: 504,
};

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "请求内容必须是有效 JSON。" } }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "请求结构无效。" } }, { status: 400 });
  }
  const input = body as Record<string, unknown>;
  try {
    if (input.mode === "cities" && typeof input.keyword === "string") {
      return NextResponse.json({ ok: true, cities: await searchAdministrativeCities(input.keyword) });
    }
    if (input.mode === "districts" && typeof input.city === "string") {
      return NextResponse.json({ ok: true, districts: await getAdministrativeDistricts(input.city) });
    }
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "请提供有效的查询模式和城市信息。" } }, { status: 400 });
  } catch (error) {
    if (error instanceof AMapAdministrativeError) {
      return NextResponse.json({ ok: false, error: { code: error.code, message: error.message } }, { status: HTTP_STATUS[error.code] });
    }
    return NextResponse.json({ ok: false, error: { code: "AMAP_API_ERROR", message: "高德行政区服务发生未知错误。" } }, { status: 502 });
  }
}
