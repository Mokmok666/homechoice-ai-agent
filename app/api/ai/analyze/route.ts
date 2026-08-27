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

const RETRYABLE_NARRATIVE_VALIDATION_ERRORS = [
  "analysis.decisionSummary infers household space match from unknown evidence",
  "analysis.decisionSummary infers layout quality from unknown evidence",
  "analysis.decisionSummary contradicts commute ideal threshold",
  "analysis.decisionSummary reverses deterministic commute comparison",
  "analysis.decisionSummary treats a worse commute as equal",
  "analysis.decisionSummary treats a material budget difference as equal",
  "analysis.decisionSummary contradicts alternative budget boundary",
] as const;

function isRetryableNarrativeValidationError(error: string): boolean {
  return RETRYABLE_NARRATIVE_VALIDATION_ERRORS.includes(
    error as (typeof RETRYABLE_NARRATIVE_VALIDATION_ERRORS)[number],
  ) || /^analysis\.decisionSummary (?:reverses deterministic|makes unsupported)/.test(error);
}

function narrativeCorrectionPrompt(
  prompt: string,
  errors: string[],
  request: import("@/types/ai-analysis").AIAnalysisRequest,
): string {
  const comparisons = request.context.candidateComparisons;
  const correctionFacts = comparisons ? [
    `主要备选是${comparisons.primaryAlternativeName ?? "未知"}。`,
    `通勤关系是${comparisons.commute.relation}：首选本人${comparisons.commute.top1PrimaryMinutes ?? "未知"}分钟、伴侣${comparisons.commute.top1PartnerMinutes ?? "未知"}分钟；备选本人${comparisons.commute.top2PrimaryMinutes ?? "未知"}分钟、伴侣${comparisons.commute.top2PartnerMinutes ?? "未知"}分钟；首选目标状态${comparisons.commute.top1TargetStatus}。`,
    `预算${comparisons.budgetMatch.maximumBudget}万元，首选预期成交价${comparisons.budgetMatch.top1ExpectedTransactionPrice}万元，备选${comparisons.budgetMatch.top2ExpectedTransactionPrice}万元；不得将低于预算的候选写成超预算。`,
    `空间匹配关系是${comparisons.dimensions.find((item) => item.dimensionKey === "space_match")?.relation ?? "UNKNOWN"}；建筑面积关系只是${comparisons.buildingArea.relation}。`,
    `商业配套关系是${comparisons.dimensions.find((item) => item.dimensionKey === "commercial_amenities")?.relation ?? "UNKNOWN"}，医疗配套关系是${comparisons.dimensions.find((item) => item.dimensionKey === "medical_amenities")?.relation ?? "UNKNOWN"}。`,
    `教育需求是${request.context.preferences.educationNeed}；为none时必须完全省略教育。`,
  ].join("\n") : "当前无候选比较事实。";
  return `${prompt}\n\n---\n\n上一次输出未通过叙事事实一致性检查，请仅重新生成约定 JSON。不得改变首选、候选顺序或任何事实。重点修正：${errors.join("；")}。\n${correctionFacts}\n严格遵守：UNKNOWN 不得写成优势，EQUAL 不得写成任一方更强，主要备选通勤更短时必须承认该事实。`;
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
    const basePrompt = createAIAnalysisPrompt(requestValidation.data);
    let prompt = basePrompt;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const rawOutput = await generateAIAnalysis(prompt);

      let analysis: unknown;
      try {
        analysis = JSON.parse(rawOutput) as unknown;
      } catch {
        if (process.env.NODE_ENV !== "production") {
          console.warn("[AI validation]", ["analysis output is not valid JSON"]);
        }
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
      if (responseValidation.success && responseValidation.data.ok) {
        return NextResponse.json(responseValidation.data);
      }

      const errors = responseValidation.success
        ? ["analysis returned an error response"]
        : responseValidation.errors;
      if (process.env.NODE_ENV !== "production") {
        console.warn("[AI validation]", errors);
      }
      const mayRetry = attempt === 0
        && !responseValidation.success
        && errors.length > 0
        && errors.every((error) => isRetryableNarrativeValidationError(error)
          || /^analysis\.decisionSummary contradicts high /.test(error));
      if (!mayRetry) {
        return errorResponse("INVALID_AI_OUTPUT", "AI 返回内容未通过安全校验。", false);
      }
      prompt = narrativeCorrectionPrompt(basePrompt, errors, requestValidation.data);
    }

    return errorResponse("INVALID_AI_OUTPUT", "AI 返回内容未通过安全校验。", false);
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
