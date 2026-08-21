import type { WebSearchProvider } from "./types";
import { TavilyWebSearchProvider } from "./tavily-provider";
import { WebSearchProviderError } from "./errors";

export { WebSearchProviderError } from "./errors";

export function getWebSearchProvider(): WebSearchProvider {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new WebSearchProviderError(
      "PROVIDER_UNAVAILABLE",
      "Tavily 公开搜索尚未配置，当前分析继续使用用户输入与高德地图证据。",
      false,
    );
  }
  return new TavilyWebSearchProvider(apiKey);
}
