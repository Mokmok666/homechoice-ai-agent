import type { AIAnalysisErrorCode } from "../../types/ai-analysis";

const ZHIPU_CHAT_COMPLETIONS_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_ZHIPU_MODEL = "glm-4-flash";

type ZhipuClientErrorCode = Extract<
  AIAnalysisErrorCode,
  "AI_TIMEOUT" | "AI_PROVIDER_ERROR" | "AI_NOT_CONFIGURED"
>;

export class ZhipuClientError extends Error {
  constructor(
    public readonly code: ZhipuClientErrorCode,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ZhipuClientError";
  }
}

interface ZhipuCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

export function getZhipuModel(): string {
  return process.env.ZHIPU_MODEL?.trim() || DEFAULT_ZHIPU_MODEL;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

/**
 * Server-only provider boundary. Never import this module from a Client Component.
 * ZHIPU_API_KEY is read at request time and is only sent in the provider Authorization header.
 */
export async function generateAIAnalysis(prompt: string): Promise<string> {
  const apiKey = process.env.ZHIPU_API_KEY?.trim();
  if (!apiKey) {
    throw new ZhipuClientError(
      "AI_NOT_CONFIGURED",
      "AI 分析服务尚未配置。",
      false,
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(ZHIPU_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: getZhipuModel(),
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        stream: false,
        temperature: 0.2,
      }),
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new ZhipuClientError(
        "AI_PROVIDER_ERROR",
        "AI 分析服务暂时不可用。",
        response.status === 429 || response.status >= 500,
      );
    }

    let payload: ZhipuCompletionResponse;
    try {
      payload = (await response.json()) as ZhipuCompletionResponse;
    } catch {
      throw new ZhipuClientError(
        "AI_PROVIDER_ERROR",
        "AI 服务返回了无法识别的响应。",
        true,
      );
    }

    const content = payload.choices?.[0]?.message?.content;
    if (typeof content !== "string" || content.trim() === "") {
      throw new ZhipuClientError(
        "AI_PROVIDER_ERROR",
        "AI 服务未返回有效内容。",
        true,
      );
    }

    return content;
  } catch (error) {
    if (error instanceof ZhipuClientError) throw error;
    if (isAbortError(error)) {
      throw new ZhipuClientError("AI_TIMEOUT", "AI 分析请求超时。", true);
    }
    throw new ZhipuClientError("AI_PROVIDER_ERROR", "无法连接 AI 分析服务。", true);
  } finally {
    clearTimeout(timeout);
  }
}
