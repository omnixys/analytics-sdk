import type {
  AnalyticsBatch,
  AnalyticsTokenProvider,
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

export class AnalyticsTokenManager {
  private tokenValue?: string;
  private refreshPromise?: Promise<string>;

  constructor(
    private readonly writeKey?: string,
    private readonly provider?: AnalyticsTokenProvider,
  ) {
    if (!writeKey && !provider) {
      throw new TypeError("Analytics writeKey or tokenProvider is required");
    }
  }

  token(): Promise<string> {
    if (this.writeKey) return Promise.resolve(this.writeKey);
    if (this.tokenValue) return Promise.resolve(this.tokenValue);
    return this.refresh();
  }

  refreshAfter(rejectedToken: string): Promise<string> {
    if (this.writeKey) return Promise.resolve(this.writeKey);
    if (this.tokenValue && this.tokenValue !== rejectedToken) {
      return Promise.resolve(this.tokenValue);
    }
    return this.refresh();
  }

  get refreshable(): boolean {
    return Boolean(this.provider);
  }

  private refresh(): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.provider!({ forceRefresh: true })
      .then((token) => {
        if (!token) {
          throw new TypeError("Analytics token provider returned an empty token");
        }
        this.tokenValue = token;
        return token;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });
    return this.refreshPromise;
  }
}

export class FetchAnalyticsTransport implements AnalyticsTransport {
  private readonly url: string;

  constructor(
    endpoint: string,
    token: string | AnalyticsTokenManager,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.url = `${endpoint.replace(/\/+$/, "")}/v1/analytics/batch`;
    this.tokens =
      typeof token === "string" ? new AnalyticsTokenManager(token) : token;
  }
  private readonly tokens: AnalyticsTokenManager;

  async send(batch: AnalyticsBatch): Promise<void> {
    let response: Response;
    try {
      const token = await this.tokens.token();
      response = await this.request(batch, token);
      if (response.status === 401 && this.tokens.refreshable) {
        response = await this.request(
          batch,
          await this.tokens.refreshAfter(token),
        );
      }
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

  private request(batch: AnalyticsBatch, token: string): Promise<Response> {
    return this.fetcher(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(batch),
      keepalive: true,
    });
  }
}

export class FetchFeatureFlagTransport implements FeatureFlagTransport {
  private readonly url: string;

  constructor(
    endpoint: string,
    token: string | AnalyticsTokenManager,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    this.url = `${endpoint.replace(/\/+$/, "")}/v1/analytics/flags/evaluate`;
    this.tokens =
      typeof token === "string" ? new AnalyticsTokenManager(token) : token;
  }
  private readonly tokens: AnalyticsTokenManager;

  async evaluate(
    request: FeatureFlagEvaluationRequest,
  ): Promise<FeatureFlagEvaluation[]> {
    let response: Response;
    try {
      const token = await this.tokens.token();
      response = await this.request(request, token);
      if (response.status === 401 && this.tokens.refreshable) {
        response = await this.request(
          request,
          await this.tokens.refreshAfter(token),
        );
      }
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

  private request(
    request: FeatureFlagEvaluationRequest,
    token: string,
  ): Promise<Response> {
    return this.fetcher(this.url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
  }
}
