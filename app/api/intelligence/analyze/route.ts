import { NextResponse } from "next/server";
import { createPropertyIntelligencePrompt } from "@/lib/ai/property-intelligence-prompt";
import {
  validatePropertyIntelligence,
  validatePropertyIntelligenceRequest,
} from "@/lib/ai/property-intelligence-validation";
import {
  generateAIAnalysis,
  ZhipuClientError,
} from "@/lib/ai/zhipu-client";
import type { AIAnalysisErrorCode } from "@/types/ai-analysis";
import type {
  PropertyIntelligence,
  PropertyIntelligenceErrorResponse,
} from "@/types/property-intelligence";

export const runtime = "nodejs";

const ERROR_HTTP_STATUS: Record<AIAnalysisErrorCode, number> = {
  INVALID_REQUEST: 400,
  INVALID_AI_OUTPUT: 422,
  AI_PROVIDER_ERROR: 502,
  AI_NOT_CONFIGURED: 503,
  AI_TIMEOUT: 504,
};

function errorResponse(
  code: AIAnalysisErrorCode,
  message: string,
  retryable: boolean,
): NextResponse<PropertyIntelligenceErrorResponse> {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable } },
    { status: ERROR_HTTP_STATUS[code] },
  );
}

export async function POST(
  request: Request,
): Promise<NextResponse<PropertyIntelligence | PropertyIntelligenceErrorResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "请求内容必须是有效的 JSON。", false);
  }

  const requestValidation = validatePropertyIntelligenceRequest(body);
  if (!requestValidation.success) {
    return errorResponse("INVALID_REQUEST", "房产智能分析请求无效。", false);
  }

  try {
    const prompt = createPropertyIntelligencePrompt(requestValidation.data);
    const rawOutput = await generateAIAnalysis(prompt);
    let candidate: unknown;
    try {
      candidate = JSON.parse(rawOutput) as unknown;
    } catch {
      return errorResponse("INVALID_AI_OUTPUT", "AI 返回内容无法安全解析。", false);
    }

    const validation = validatePropertyIntelligence(candidate);
    if (!validation.success || validation.data.propertyId !== requestValidation.data.property.id) {
      return errorResponse("INVALID_AI_OUTPUT", "AI 返回内容未通过安全校验。", false);
    }

    return NextResponse.json({
      ...validation.data,
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (error instanceof ZhipuClientError) {
      return errorResponse(error.code, error.message, error.retryable);
    }
    return errorResponse("AI_PROVIDER_ERROR", "房产智能分析服务发生未知错误。", true);
  }
}
