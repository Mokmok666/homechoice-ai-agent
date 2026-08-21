export class WebSearchProviderError extends Error {
  constructor(
    public readonly code: "PROVIDER_UNAVAILABLE" | "PROVIDER_ERROR" | "TIMEOUT",
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = "WebSearchProviderError";
  }
}
