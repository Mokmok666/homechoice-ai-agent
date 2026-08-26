import type { AIAnalysisRequest, AIAnalysisResponse } from "../../types/ai-analysis";
import { validateAIAnalysisResponse } from "./validation";

export interface AIAnalysisClientOptions {
  signal?: AbortSignal;
}

const inFlightRequests = new Map<string, Promise<AIAnalysisResponse>>();

async function performAIAnalysisRequest(
  request: AIAnalysisRequest,
  options: AIAnalysisClientOptions = {},
): Promise<AIAnalysisResponse> {
  try {
    const response = await fetch("/api/ai/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: options.signal,
    });

    const payload: unknown = await response.json();
    const validation = validateAIAnalysisResponse(
      payload,
      request.context.authoritativeTopPropertyId,
      request.context.candidates[0]?.property.name ?? undefined,
      request.context.candidates.slice(1, 2).flatMap((candidate) => candidate.property.name ? [candidate.property.name] : []),
      requiresCommuteBoundaryNuance(request),
    );
    if (!validation.success) {
      return {
        ok: false,
        error: {
          code: "INVALID_AI_OUTPUT",
          message: "AI 分析服务返回了无法安全展示的内容。",
          retryable: false,
        },
      };
    }

    return validation.data;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        error: {
          code: "AI_TIMEOUT",
          message: "AI 分析请求已取消。",
          retryable: true,
        },
      };
    }
    return {
      ok: false,
      error: {
        code: "AI_PROVIDER_ERROR",
        message: "暂时无法连接 AI 分析服务。",
        retryable: true,
      },
    };
  }
}

function requiresCommuteBoundaryNuance(request: AIAnalysisRequest): boolean {
  const commute = request.context.candidates[0]?.geoEvidence?.commute;
  return [commute?.primary, commute?.partner].some((person) => Boolean(person && person.selectedMinutes !== null && person.idealCommuteMinutes !== null && person.maxCommuteMinutes !== null && person.selectedMinutes > person.idealCommuteMinutes && person.selectedMinutes <= person.maxCommuteMinutes));
}

export function requestAIAnalysis(
  request: AIAnalysisRequest,
  options: AIAnalysisClientOptions = {},
): Promise<AIAnalysisResponse> {
  const existingRequest = inFlightRequests.get(request.inputSignature);
  if (existingRequest) return existingRequest;

  const pendingRequest = performAIAnalysisRequest(request, options).finally(() => {
    if (inFlightRequests.get(request.inputSignature) === pendingRequest) {
      inFlightRequests.delete(request.inputSignature);
    }
  });
  inFlightRequests.set(request.inputSignature, pendingRequest);
  return pendingRequest;
}
