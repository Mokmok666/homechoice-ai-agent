import { NextResponse } from "next/server";
import {
  createAIAnalysisCorrectivePrompt,
  createAIAnalysisPrompt,
} from "../../../../lib/ai/prompt";
import { buildNarrativeFacts } from "../../../../lib/ai/narrative-facts";
import { createDeterministicNarrative } from "../../../../lib/ai/deterministic-narrative";
import {
  runSingleRequestGeneration,
  shouldRetryAIAnalysisValidation,
  type AIAnalysisAttemptEvent,
} from "../../../../lib/ai/corrective-retry";
import {
  validateAIAnalysisRequest,
  validateAIAnalysisResponse,
} from "../../../../lib/ai/validation";
import {
  AI_NARRATIVE_TEMPERATURE,
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

function logAttempt(event: AIAnalysisAttemptEvent): void {
  if (event.outcome === "validation_failed") {
    if (event.attempt === 1 && !event.retryable) {
      console.warn(`[AI_ANALYZE] mode=model attempt=1 hard_validation_failure issue_count=${event.issueCount}`);
      return;
    }
    console.warn(`[AI_ANALYZE] mode=model attempt=${event.attempt} validation_failed issue_count=${event.issueCount} retryable=${event.retryable}`);
    return;
  }
  if (event.outcome === "parse_failed") {
    console.warn(`[AI_ANALYZE] mode=model attempt=${event.attempt} parse_failed`);
    return;
  }
  console.info(`[AI_ANALYZE] mode=model attempt=${event.attempt} success`);
}

export async function POST(request: Request): Promise<NextResponse<AIAnalysisResponse>> {
  const startedAt = Date.now();
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
    const narrativeFacts = buildNarrativeFacts(requestValidation.data);
    const factCount = narrativeFacts.requiredFacts.length
      + narrativeFacts.comparisonFacts.length
      + narrativeFacts.uncertaintyFacts.length
      + narrativeFacts.nextStepFacts.length;
    console.info(`[AI_ANALYZE] facts_built fact_count=${factCount} comparison_count=${narrativeFacts.comparisonFacts.length} uncertainty_count=${narrativeFacts.uncertaintyFacts.length}`);
    const validateGeneratedAnalysis = (analysis: unknown, model: string = getZhipuModel()) => validateAIAnalysisResponse(
      {
        ok: true,
        analysis,
        metadata: {
          provider: "zhipu",
          model,
          generatedAt: new Date().toISOString(),
          inputSignature: requestValidation.data.inputSignature,
        },
      },
      requestValidation.data.context.authoritativeTopPropertyId,
      requestValidation.data.context.candidates[0]?.property.name ?? undefined,
      requestValidation.data.context.candidates.slice(1, 2).flatMap((candidate) => candidate.property.name ? [candidate.property.name] : []),
      requiresCommuteBoundaryNuance(requestValidation.data),
      {
        educationNeed: requestValidation.data.context.preferences.educationNeed,
        comparisons: requestValidation.data.context.candidateComparisons,
        topPropertyName: requestValidation.data.context.candidates[0]?.property.name ?? undefined,
        dimensions: requestValidation.data.context.candidates[0]?.decision.dimensions.map((dimension) => ({
          key: dimension.key,
          label: dimension.label,
          score: dimension.score,
          status: dimension.status,
        })) ?? [],
      },
    );

    const generation = await runSingleRequestGeneration({
      initialPrompt: createAIAnalysisPrompt(requestValidation.data, narrativeFacts),
      generate: (prompt) => generateAIAnalysis(prompt, { temperature: AI_NARRATIVE_TEMPERATURE }),
      validate: (analysis) => validateGeneratedAnalysis(analysis),
      createCorrectivePrompt: (issues) => createAIAnalysisCorrectivePrompt(requestValidation.data, narrativeFacts, issues),
      shouldRetry: shouldRetryAIAnalysisValidation,
      onAttempt: logAttempt,
      buildFallback: () => {
        const validation = validateGeneratedAnalysis(
          createDeterministicNarrative(narrativeFacts),
          "deterministic-narrative-v1",
        );
        if (!validation.success) {
          throw new Error("Deterministic narrative did not satisfy the response contract.");
        }
        return validation.data;
      },
      onProviderError: (error) => {
        const providerErrorType = error instanceof ZhipuClientError
          ? error.code === "AI_TIMEOUT" ? "timeout" : error.code === "AI_NOT_CONFIGURED" ? "not_configured" : "provider"
          : "unknown";
        console.warn(`[AI_ANALYZE] mode=model provider_error type=${providerErrorType}`);
      },
    });

    if (generation.source === "deterministic_fallback") {
      console.warn(`[AI_ANALYZE] mode=fallback reason=${generation.fallbackReason}`);
    }
    console.info(`[AI_ANALYZE] final=success source=${generation.source === "model" ? "model" : "fallback"} duration_ms=${Date.now() - startedAt}`);
    return NextResponse.json(generation.data);
  } catch (error) {
    if (error instanceof ZhipuClientError) {
      const providerErrorType = error.code === "AI_TIMEOUT"
        ? "timeout"
        : error.code === "AI_NOT_CONFIGURED" ? "not_configured" : "provider";
      console.warn(`[AI_ANALYZE] provider_error type=${providerErrorType}`);
      return errorResponse(error.code, error.message, error.retryable);
    }
    console.warn("[AI_ANALYZE] provider_error type=unknown");
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
