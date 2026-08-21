import "server-only";
import { WebSearchProviderError } from "./errors";
import {
  WEB_EVIDENCE_PROVIDER_ID,
  type NormalizedWebSearchResult,
  type WebSearchProvider,
} from "./types";

const ZHIPU_WEB_SEARCH_ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/web_search";
const REQUEST_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function domainFromUrl(url: string): string | undefined {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return undefined; }
}

function normalizeResult(value: unknown, fetchedAt: string): NormalizedWebSearchResult | null {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.link !== "string") return null;
  const title = value.title.trim();
  const url = value.link.trim();
  if (!title || !/^https?:\/\//i.test(url)) return null;
  const snippet = typeof value.content === "string" ? value.content.trim() : "";
  const publishedAt = typeof value.publish_date === "string" ? value.publish_date.trim() : "";
  const sourceDomain = domainFromUrl(url);
  return {
    title,
    url,
    ...(snippet ? { snippet } : {}),
    ...(sourceDomain ? { sourceDomain } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    fetchedAt,
  };
}

export class ZhipuWebSearchProvider implements WebSearchProvider {
  readonly id = WEB_EVIDENCE_PROVIDER_ID;

  constructor(private readonly apiKey: string) {}

  async search(query: string, options?: { limit?: number; signal?: AbortSignal }): Promise<NormalizedWebSearchResult[]> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(ZHIPU_WEB_SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          search_query: query,
          search_engine: "search_std",
          search_intent: false,
          count: Math.min(10, Math.max(1, options?.limit ?? 5)),
          search_recency_filter: "noLimit",
          content_size: "medium",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new WebSearchProviderError(
          "PROVIDER_ERROR",
          `智谱公开搜索请求失败（HTTP ${response.status}）。`,
          response.status === 429 || response.status >= 500,
        );
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !Array.isArray(payload.search_result)) {
        throw new WebSearchProviderError("PROVIDER_ERROR", "智谱公开搜索返回结构无效。", true);
      }
      const fetchedAt = new Date().toISOString();
      return payload.search_result
        .map((item) => normalizeResult(item, fetchedAt))
        .filter((item): item is NormalizedWebSearchResult => item !== null);
    } catch (error) {
      if (error instanceof WebSearchProviderError) throw error;
      if (controller.signal.aborted) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        throw new WebSearchProviderError("TIMEOUT", "智谱公开搜索请求超时。", true);
      }
      throw new WebSearchProviderError("PROVIDER_ERROR", "智谱公开搜索暂时不可用。", true);
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener("abort", onAbort);
    }
  }
}
