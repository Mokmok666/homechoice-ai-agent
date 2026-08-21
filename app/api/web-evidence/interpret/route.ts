import { NextResponse } from "next/server";
import { createWebEvidenceInterpretationPrompt } from "@/lib/ai/web-evidence-interpretation-prompt";
import {
  validateWebEvidenceInterpretationOutput,
  validateWebEvidenceInterpretationRequest,
} from "@/lib/ai/web-evidence-interpretation-validation";
import { generateAIAnalysis, getZhipuModel, ZhipuClientError } from "@/lib/ai/zhipu-client";
import type { WebEvidenceInterpretationApiResponse } from "@/lib/web-evidence/types";

export const runtime = "nodejs";

function errorResponse(
  code: Extract<WebEvidenceInterpretationApiResponse, { ok: false }>["error"]["code"],
  message: string,
  retryable: boolean,
  status: number,
): NextResponse<WebEvidenceInterpretationApiResponse> {
  return NextResponse.json({ ok: false, error: { code, message, retryable } }, { status });
}

export async function POST(request: Request): Promise<NextResponse<WebEvidenceInterpretationApiResponse>> {
  let body: unknown;
  try { body = await request.json(); } catch { return errorResponse("INVALID_REQUEST", "请求内容必须是有效 JSON。", false, 400); }
  const requestValidation = validateWebEvidenceInterpretationRequest(body);
  if (!requestValidation.success) return errorResponse("INVALID_REQUEST", "公开证据解释请求无效。", false, 400);
  const usableDimensions = requestValidation.data.evidence.dimensions.filter((dimension) => dimension.status !== "unavailable" && dimension.facts.length > 0);
  if (usableDimensions.length === 0) return errorResponse("INVALID_REQUEST", "当前没有可解释的公开证据。", false, 400);
  try {
    const raw = await generateAIAnalysis(createWebEvidenceInterpretationPrompt(requestValidation.data));
    let parsed: unknown;
    try { parsed = JSON.parse(raw) as unknown; } catch { return errorResponse("INVALID_AI_OUTPUT", "公开证据解释无法安全解析。", false, 422); }
    const outputValidation = validateWebEvidenceInterpretationOutput(parsed, requestValidation.data);
    if (!outputValidation.success) return errorResponse("INVALID_AI_OUTPUT", "公开证据解释未通过安全校验。", false, 422);
    return NextResponse.json({
      ...outputValidation.data,
      metadata: { provider: "zhipu", model: getZhipuModel(), generatedAt: new Date().toISOString() },
    });
  } catch (error) {
    if (error instanceof ZhipuClientError) {
      const status = error.code === "AI_NOT_CONFIGURED" ? 503 : error.code === "AI_TIMEOUT" ? 504 : 502;
      return errorResponse(error.code, error.message, error.retryable, status);
    }
    return errorResponse("AI_PROVIDER_ERROR", "公开证据解释暂时不可用。", true, 502);
  }
}
