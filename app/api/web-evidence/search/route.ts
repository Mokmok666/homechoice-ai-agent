import { NextResponse } from "next/server";
import { createPropertyIdentitySignature } from "@/lib/web-evidence/query-builder";
import { WebSearchProviderError } from "@/lib/web-evidence/provider";
import { searchPropertyWebEvidence } from "@/lib/web-evidence/search";
import type { WebEvidenceApiResponse, WebEvidencePropertyIdentity } from "@/lib/web-evidence/types";

export const runtime = "nodejs";

function errorResponse(code: "INVALID_REQUEST" | "PROVIDER_UNAVAILABLE" | "PROVIDER_ERROR" | "TIMEOUT", message: string, retryable: boolean, status: number) {
  return NextResponse.json<WebEvidenceApiResponse>({ ok: false, error: { code, message, retryable } }, { status });
}

function parseIdentity(value: unknown): WebEvidencePropertyIdentity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!["propertyId", "name", "city", "district"].every((key) => typeof item[key] === "string" && (item[key] as string).trim())) return null;
  const identity: WebEvidencePropertyIdentity = {
    propertyId: (item.propertyId as string).trim(),
    name: (item.name as string).trim(),
    city: (item.city as string).trim(),
    district: (item.district as string).trim(),
  };
  for (const key of ["formattedAddress", "poiId"] as const) {
    if (typeof item[key] === "string" && item[key].trim()) identity[key] = item[key].trim();
  }
  if (typeof item.lng === "number" && Number.isFinite(item.lng)) identity.lng = item.lng;
  if (typeof item.lat === "number" && Number.isFinite(item.lat)) identity.lat = item.lat;
  return identity;
}

export async function POST(request: Request): Promise<NextResponse<WebEvidenceApiResponse>> {
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("INVALID_REQUEST", "请求内容必须是有效 JSON。", false, 400); }
  const identity = parseIdentity((body as { property?: unknown } | null)?.property);
  if (!identity) return errorResponse("INVALID_REQUEST", "房源名称、城市和行政区不能为空。", false, 400);
  try {
    const evidence = await searchPropertyWebEvidence(identity, request.signal);
    if (evidence.propertyIdentitySignature !== createPropertyIdentitySignature(identity)) {
      return errorResponse("PROVIDER_ERROR", "公开来源结果与当前房源身份不匹配。", true, 502);
    }
    return NextResponse.json({ ok: true, evidence });
  } catch (error) {
    if (error instanceof WebSearchProviderError) {
      const status = error.code === "PROVIDER_UNAVAILABLE" ? 503 : error.code === "TIMEOUT" ? 504 : 502;
      return errorResponse(error.code, error.message, error.retryable, status);
    }
    return errorResponse("PROVIDER_ERROR", "公开来源检索暂时不可用。", true, 502);
  }
}
