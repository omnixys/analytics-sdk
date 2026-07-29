import type {
  AnalyticsBatch,
  AnalyticsTransport,
  FeatureFlagEvaluation,
  FeatureFlagEvaluationRequest,
  FeatureFlagTransport,
} from "./types.js";

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

export class FetchFeatureFlagTransport implements FeatureFlagTransport {
  private readonly url: string;

  constructor(
    endpoint: string,
    private readonly writeKey: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.url = `${endpoint.replace(/\/+$/, "")}/v1/analytics/flags/evaluate`;
  }

  async evaluate(
    request: FeatureFlagEvaluationRequest,
  ): Promise<FeatureFlagEvaluation[]> {
    let response: Response;
    try {
      response = await this.fetcher(this.url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.writeKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(request),
      });
    } catch (error) {
      throw new AnalyticsTransportError(
        error instanceof Error ? error.message : String(error),
      );
    }
    if (!response.ok) {
      throw new AnalyticsTransportError(
        `Feature flag evaluation failed with HTTP ${response.status}`,
        response.status,
        response.status === 429 || response.status >= 500,
      );
    }
    const payload = (await response.json()) as {
      evaluations?: FeatureFlagEvaluation[];
    };
    if (!Array.isArray(payload.evaluations)) {
      throw new AnalyticsTransportError(
        "Feature flag evaluation returned an invalid response",
        response.status,
        false,
      );
    }
    return payload.evaluations;
  }
}
