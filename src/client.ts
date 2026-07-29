import { sanitizeProperties } from "./sanitize.js";
import {
  AnalyticsTransportError,
  FetchAnalyticsTransport,
  FetchFeatureFlagTransport,
} from "./transport.js";
import type {
  AnalyticsBatch,
  AnalyticsConfig,
  AnalyticsEvent,
  AnalyticsEventType,
  ConsentState,
  EventOptions,
  FeatureFlagEvaluation,
  FeatureFlagValue,
} from "./types.js";

const SDK_NAME = "@omnixys/analytics-sdk";
const SDK_VERSION = "1.0.0";

export class AnalyticsClient {
  private readonly transport;
  private readonly featureFlagTransport;
  private readonly featureFlagCacheTtlMs: number;
  private readonly featureFlagCache = new Map<
    string,
    { expiresAt: number; evaluation: FeatureFlagEvaluation }
  >();
  private readonly queue: AnalyticsEvent[] = [];
  private readonly flushAt: number;
  private readonly flushIntervalMs: number;
  private readonly sessionTimeoutMs: number;
  private readonly schemaVersion: string;
  private readonly contextFactory;
  private readonly enabled: boolean;
  private timer?: ReturnType<typeof setInterval>;
  private consent: ConsentState;
  private anonymousId: string;
  private userId?: string;
  private sessionId = randomId();
  private lastActivity = Date.now();
  private flushing?: Promise<void>;

  constructor(config: AnalyticsConfig) {
    if (!config.writeKey) throw new TypeError("Analytics writeKey is required");
    if (!config.endpoint) throw new TypeError("Analytics endpoint is required");
    this.enabled = config.enabled ?? true;
    this.consent = config.consent ?? "unknown";
    this.anonymousId = config.anonymousId ?? randomId();
    this.userId = config.userId;
    this.flushAt = bounded(config.flushAt ?? 20, 1, 100);
    this.flushIntervalMs = bounded(config.flushIntervalMs ?? 10_000, 100, 60_000);
    this.sessionTimeoutMs = bounded(
      config.sessionTimeoutMs ?? 30 * 60_000,
      60_000,
      24 * 60 * 60_000,
    );
    this.schemaVersion = config.schemaVersion ?? "1.0";
    this.contextFactory = config.context;
    this.transport =
      config.transport ??
      new FetchAnalyticsTransport(config.endpoint, config.writeKey);
    this.featureFlagTransport =
      config.featureFlagTransport ??
      new FetchFeatureFlagTransport(config.endpoint, config.writeKey);
    this.featureFlagCacheTtlMs = bounded(
      config.featureFlagCacheTtlMs ?? 30_000,
      1_000,
      5 * 60_000,
    );
    if (this.enabled) {
      this.timer = setInterval(() => void this.flush(), this.flushIntervalMs);
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  track(
    name: string,
    properties: Record<string, unknown> = {},
    options?: EventOptions,
  ): string {
    return this.capture("track", name, properties, undefined, options);
  }

  identify(
    userId: string,
    traits: Record<string, unknown> = {},
    options?: EventOptions,
  ): string {
    this.userId = userId;
    return this.capture("identify", "$identify", {}, traits, options);
  }

  page(
    name = "$pageview",
    properties: Record<string, unknown> = {},
    options?: EventOptions,
  ): string {
    return this.capture("page", name, properties, undefined, options);
  }

  screen(
    name: string,
    properties: Record<string, unknown> = {},
    options?: EventOptions,
  ): string {
    return this.capture("screen", name, properties, undefined, options);
  }

  group(
    groupId: string,
    traits: Record<string, unknown> = {},
    options?: EventOptions,
  ): string {
    return this.capture("group", "$group", {}, traits, options, groupId);
  }

  alias(previousId: string, userId: string, options?: EventOptions): string {
    this.userId = userId;
    return this.capture(
      "alias",
      "$alias",
      { previousId, userId },
      undefined,
      options,
    );
  }

  setConsent(consent: ConsentState): void {
    this.consent = consent;
    if (consent === "denied") this.queue.length = 0;
  }

  async getFeatureFlag(
    key: string,
    fallback: FeatureFlagValue,
    facts: Record<string, unknown> = {},
  ): Promise<FeatureFlagValue> {
    const evaluation = await this.getFeatureFlagEvaluation(key, facts);
    return evaluation?.value ?? fallback;
  }

  async getFeatureFlagEvaluation(
    key: string,
    facts: Record<string, unknown> = {},
  ): Promise<FeatureFlagEvaluation | undefined> {
    if (!this.enabled) return undefined;
    const subjectId = this.userId ?? this.anonymousId;
    const cacheKey = `${key}:${subjectId}:${stableJson(facts)}`;
    const cached = this.featureFlagCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.evaluation;
    const evaluations = await this.featureFlagTransport.evaluate({
      keys: [key],
      subjectId,
      anonymousId: this.anonymousId,
      sessionId: this.sessionId,
      facts: sanitizeProperties(facts),
    });
    const evaluation = evaluations.find((item) => item.key === key);
    if (evaluation) {
      this.featureFlagCache.set(cacheKey, {
        expiresAt: Date.now() + this.featureFlagCacheTtlMs,
        evaluation,
      });
    }
    return evaluation;
  }

  reloadFeatureFlags(): void {
    this.featureFlagCache.clear();
  }

  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    if (!this.enabled || this.consent === "denied" || this.queue.length === 0) {
      return;
    }
    const events = this.queue.splice(0, 100);
    const batch: AnalyticsBatch = {
      batchId: randomId(),
      sentAt: new Date().toISOString(),
      events,
    };
    this.flushing = this.transport
      .send(batch)
      .catch((error: unknown) => {
        if (!(error instanceof AnalyticsTransportError) || error.retryable) {
          this.queue.unshift(...events);
        }
        throw error;
      })
      .finally(() => {
        this.flushing = undefined;
      });
    return this.flushing;
  }

  reset(): void {
    this.userId = undefined;
    this.anonymousId = randomId();
    this.sessionId = randomId();
    this.lastActivity = Date.now();
    this.featureFlagCache.clear();
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }

  pending(): number {
    return this.queue.length;
  }

  private capture(
    type: AnalyticsEventType,
    name: string,
    properties: Record<string, unknown>,
    traits: Record<string, unknown> | undefined,
    options?: EventOptions,
    groupId?: string,
  ): string {
    const eventId = randomId();
    if (!this.enabled || this.consent === "denied") return eventId;
    const now = Date.now();
    if (now - this.lastActivity > this.sessionTimeoutMs) {
      this.sessionId = randomId();
    }
    this.lastActivity = now;
    this.queue.push({
      eventId,
      schemaVersion: options?.schemaVersion ?? this.schemaVersion,
      type,
      name,
      anonymousId: this.anonymousId,
      ...(this.userId ? { userId: this.userId } : {}),
      ...(groupId ? { groupId } : {}),
      sessionId: this.sessionId,
      occurredAt: (options?.occurredAt ?? new Date()).toISOString(),
      properties: sanitizeProperties(properties),
      ...(traits ? { traits: sanitizeProperties(traits) } : {}),
      context: sanitizeProperties({
        ...(this.contextFactory?.() ?? {}),
        ...(options?.context ?? {}),
      }),
      consent: this.consent,
      sdk: { name: SDK_NAME, version: SDK_VERSION },
    });
    if (this.queue.length >= this.flushAt) void this.flush();
    return eventId;
  }
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function stableJson(value: Record<string, unknown>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(sanitizeProperties(value)).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

export function createAnalytics(config: AnalyticsConfig): AnalyticsClient {
  return new AnalyticsClient(config);
}
