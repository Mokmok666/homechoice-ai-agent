import type { AIAnalysisRequest, AIAnalysisResponse } from "../../types/ai-analysis";
import { validateAIAnalysisResponse } from "./validation";

export interface AIAnalysisClientOptions {
  signal?: AbortSignal;
}

export async function requestAIAnalysis(
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
    const validation = validateAIAnalysisResponse(payload);
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
