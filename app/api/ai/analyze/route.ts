import { NextResponse } from "next/server";
import { createAIAnalysisPrompt } from "../../../../lib/ai/prompt";
import {
  validateAIAnalysisRequest,
  validateAIAnalysisResponse,
} from "../../../../lib/ai/validation";
import {
  generateAIAnalysis,
  getZhipuModel,
  ZhipuClientError,
} from "../../../../lib/ai/zhipu-client";
import type { AIAnalysisErrorCode, AIAnalysisResponse } from "../../../../types/ai-analysis";

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
): NextResponse<AIAnalysisResponse> {
  return NextResponse.json(
    { ok: false, error: { code, message, retryable } },
    { status: ERROR_HTTP_STATUS[code] },
  );
}

export async function POST(request: Request): Promise<NextResponse<AIAnalysisResponse>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("INVALID_REQUEST", "请求内容必须是有效的 JSON。", false);
  }

  const requestValidation = validateAIAnalysisRequest(body);
  if (!requestValidation.success) {
    return errorResponse(
      "INVALID_REQUEST",
      `AI 分析请求无效：${requestValidation.errors.join("；")}`,
      false,
    );
  }

  try {
    const prompt = createAIAnalysisPrompt(requestValidation.data);
    const rawOutput = await generateAIAnalysis(prompt);

    let analysis: unknown;
    try {
      analysis = JSON.parse(rawOutput) as unknown;
    } catch {
      return errorResponse("INVALID_AI_OUTPUT", "AI 返回内容无法安全解析。", false);
    }

    const candidate: unknown = {
      ok: true,
      analysis,
      metadata: {
        provider: "zhipu",
        model: getZhipuModel(),
        generatedAt: new Date().toISOString(),
        inputSignature: requestValidation.data.inputSignature,
      },
    };
    const responseValidation = validateAIAnalysisResponse(
      candidate,
      requestValidation.data.context.authoritativeTopPropertyId,
      requestValidation.data.context.candidates[0]?.property.name ?? undefined,
      requestValidation.data.context.candidates.slice(1).flatMap((candidate) => candidate.property.name ? [candidate.property.name] : []),
      requiresCommuteBoundaryNuance(requestValidation.data),
    );
    if (!responseValidation.success || !responseValidation.data.ok) {
      return errorResponse("INVALID_AI_OUTPUT", "AI 返回内容未通过安全校验。", false);
    }

    return NextResponse.json(responseValidation.data);
  } catch (error) {
    if (error instanceof ZhipuClientError) {
      return errorResponse(error.code, error.message, error.retryable);
    }
    return errorResponse("AI_PROVIDER_ERROR", "AI 分析服务发生未知错误。", true);
  }
}

function requiresCommuteBoundaryNuance(request: import("@/types/ai-analysis").AIAnalysisRequest): boolean {
  const commute = request.context.candidates[0]?.geoEvidence?.commute;
  return [commute?.primary, commute?.partner].some((person) => Boolean(
    person
    && person.selectedMinutes !== null
    && person.idealCommuteMinutes !== null
    && person.maxCommuteMinutes !== null
    && person.selectedMinutes > person.idealCommuteMinutes
    && person.selectedMinutes <= person.maxCommuteMinutes,
  ));
}
