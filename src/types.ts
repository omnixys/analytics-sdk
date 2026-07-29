export type ConsentState = "granted" | "denied" | "unknown";
export type AnalyticsEventType =
  | "track"
  | "identify"
  | "page"
  | "screen"
  | "group"
  | "alias";

export interface AnalyticsEvent {
  eventId: string;
  schemaVersion: string;
  type: AnalyticsEventType;
  name: string;
  anonymousId?: string;
  userId?: string;
  groupId?: string;
  sessionId?: string;
  occurredAt: string;
  properties: Record<string, unknown>;
  traits?: Record<string, unknown>;
  context?: Record<string, unknown>;
  consent: ConsentState;
  sdk: { name: string; version: string };
}

export interface AnalyticsBatch {
  batchId: string;
  sentAt: string;
  events: AnalyticsEvent[];
}

export interface AnalyticsTransport {
  send(batch: AnalyticsBatch): Promise<void>;
}

export type FeatureFlagValue =
  | string
  | number
  | boolean
  | Record<string, unknown>;

export interface FeatureFlagEvaluation {
  key: string;
  flagId: string;
  version: number;
  variant: string;
  value: FeatureFlagValue;
  reason: "OFF" | "DEFAULT" | "RULE_MATCH" | "ROLLOUT_EXCLUDED";
  ruleId?: string;
}

export interface FeatureFlagEvaluationRequest {
  evaluationId?: string;
  keys: string[];
  subjectId: string;
  anonymousId?: string;
  sessionId?: string;
  facts: Record<string, unknown>;
}

export interface FeatureFlagTransport {
  evaluate(
    request: FeatureFlagEvaluationRequest,
  ): Promise<FeatureFlagEvaluation[]>;
}

export interface AnalyticsConfig {
  writeKey?: string;
  tokenProvider?: AnalyticsTokenProvider;
  endpoint: string;
  enabled?: boolean;
  consent?: ConsentState;
  anonymousId?: string;
  userId?: string;
  flushAt?: number;
  flushIntervalMs?: number;
  sessionTimeoutMs?: number;
  schemaVersion?: string;
  transport?: AnalyticsTransport;
  featureFlagTransport?: FeatureFlagTransport;
  featureFlagCacheTtlMs?: number;
  context?: () => Record<string, unknown>;
}

export interface AnalyticsTokenRequest {
  forceRefresh: boolean;
}

export type AnalyticsTokenProvider = (
  request: AnalyticsTokenRequest,
) => Promise<string>;

export interface EventOptions {
  occurredAt?: Date;
  context?: Record<string, unknown>;
  schemaVersion?: string;
}
