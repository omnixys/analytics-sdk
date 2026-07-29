import type { AnalyticsBatch, AnalyticsTransport } from "./types.js";

export class AnalyticsTransportError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = true,
  ) {
    super(message);
    this.name = AnalyticsTransportError.name;
  }
}

export class FetchAnalyticsTransport implements AnalyticsTransport {
  private readonly url: string;

  constructor(
    endpoint: string,
    private readonly writeKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.url = `${endpoint.replace(/\/+$/, "")}/v1/analytics/batch`;
  }

  async send(batch: AnalyticsBatch): Promise<void> {
    let response: Response;
    try {
      response = await this.fetcher(this.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.writeKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(batch),
        keepalive: true,
      });
    } catch (error) {
      throw new AnalyticsTransportError(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!response.ok) {
      const retryable = response.status === 429 || response.status >= 500;
      throw new AnalyticsTransportError(
        `Analytics ingestion failed with HTTP ${response.status}`,
        response.status,
        retryable,
      );
    }
  }
}
