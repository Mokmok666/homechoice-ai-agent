import "server-only";
import { WebSearchProviderError } from "./errors";
import {
  WEB_EVIDENCE_PROVIDER_ID,
  type NormalizedWebSearchResult,
  type WebSearchProvider,
} from "./types";

const TAVILY_SEARCH_ENDPOINT = "https://api.tavily.com/search";
const REQUEST_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function domainFromUrl(url: string): string | undefined {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return undefined; }
}

function normalizeResult(value: unknown, fetchedAt: string): NormalizedWebSearchResult | null {
  if (!isRecord(value) || typeof value.title !== "string" || typeof value.url !== "string") return null;
  const title = value.title.trim();
  const url = value.url.trim();
  if (!title || !/^https?:\/\//i.test(url)) return null;
  const snippet = typeof value.content === "string" ? value.content.trim() : "";
  const publishedAt = typeof value.published_date === "string" ? value.published_date.trim() : "";
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

export class TavilyWebSearchProvider implements WebSearchProvider {
  readonly id = WEB_EVIDENCE_PROVIDER_ID;

  constructor(private readonly apiKey: string) {}

  async search(query: string, options?: { limit?: number; signal?: AbortSignal }): Promise<NormalizedWebSearchResult[]> {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", onAbort, { once: true });
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(TAVILY_SEARCH_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          topic: "general",
          search_depth: "basic",
          max_results: Math.min(10, Math.max(1, options?.limit ?? 5)),
          include_answer: false,
          include_raw_content: false,
          include_images: false,
          auto_parameters: false,
          country: "china",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new WebSearchProviderError(
          "PROVIDER_ERROR",
          `Tavily 公开搜索请求失败（HTTP ${response.status}）。`,
          response.status === 429 || response.status >= 500,
        );
      }
      const payload: unknown = await response.json();
      if (!isRecord(payload) || !Array.isArray(payload.results)) {
        throw new WebSearchProviderError("PROVIDER_ERROR", "Tavily 公开搜索返回结构无效。", true);
      }
      const fetchedAt = new Date().toISOString();
      return payload.results
        .map((item) => normalizeResult(item, fetchedAt))
        .filter((item): item is NormalizedWebSearchResult => item !== null);
    } catch (error) {
      if (error instanceof WebSearchProviderError) throw error;
      if (controller.signal.aborted) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        throw new WebSearchProviderError("TIMEOUT", "Tavily 公开搜索请求超时。", true);
      }
      throw new WebSearchProviderError("PROVIDER_ERROR", "Tavily 公开搜索暂时不可用。", true);
    } finally {
      clearTimeout(timeout);
      options?.signal?.removeEventListener("abort", onAbort);
    }
  }
}
