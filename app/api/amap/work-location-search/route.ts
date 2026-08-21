import { NextResponse } from "next/server";
import {
  AMapPropertySearchError,
  searchWorkLocations,
  type AMapPropertySearchErrorCode,
} from "@/lib/amap/property-search";

export const runtime = "nodejs";

const HTTP_STATUS: Record<AMapPropertySearchErrorCode, number> = {
  INVALID_INPUT: 400,
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
  if (typeof input.keyword !== "string" || !(input.city === undefined || typeof input.city === "string")) {
    return NextResponse.json({ ok: false, error: { code: "INVALID_INPUT", message: "keyword 必须是字符串。" } }, { status: 400 });
  }
  try {
    const candidates = await searchWorkLocations({
      keyword: input.keyword,
      ...(typeof input.city === "string" ? { city: input.city } : {}),
    });
    return NextResponse.json({ ok: true, candidates });
  } catch (error) {
    if (error instanceof AMapPropertySearchError) {
      return NextResponse.json({ ok: false, error: { code: error.code, message: error.message } }, { status: HTTP_STATUS[error.code] });
    }
    return NextResponse.json({ ok: false, error: { code: "AMAP_API_ERROR", message: "高德工作地点搜索发生未知错误。" } }, { status: 502 });
  }
}
