"use client";

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { AnalyticsClient } from "./client.js";
import type { AnalyticsConfig, FeatureFlagValue } from "./types.js";

const AnalyticsContext = createContext<AnalyticsClient | null>(null);

export type AnalyticsProviderProps =
  | { children: ReactNode; client: AnalyticsClient; config?: never }
  | { children: ReactNode; client?: never; config: AnalyticsConfig };

export function AnalyticsProvider(props: AnalyticsProviderProps) {
  const [client] = useState(
    () => props.client ?? new AnalyticsClient(props.config),
  );
  useEffect(
    () => () => {
      void client.shutdown();
    },
    [client],
  );
  return (
    <AnalyticsContext.Provider value={client}>
      {props.children}
    </AnalyticsContext.Provider>
  );
}

export function useAnalytics(): AnalyticsClient {
  const client = useContext(AnalyticsContext);
  if (!client) {
    throw new Error("useAnalytics must be used inside AnalyticsProvider");
  }
  return client;
}

export interface FeatureFlagHookResult {
  value: FeatureFlagValue;
  loading: boolean;
  error?: Error;
  reload(): Promise<void>;
}

export function useFeatureFlag(
  key: string,
  fallback: FeatureFlagValue,
  facts: Record<string, unknown> = {},
): FeatureFlagHookResult {
  const analytics = useAnalytics();
  const factsJson = JSON.stringify(facts);
  const [value, setValue] = useState<FeatureFlagValue>(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error>();
  const evaluate = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      setValue(
        await analytics.getFeatureFlag(
          key,
          fallback,
          JSON.parse(factsJson) as Record<string, unknown>,
        ),
      );
    } catch (cause) {
      setValue(fallback);
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setLoading(false);
    }
  }, [analytics, factsJson, fallback, key]);

  useEffect(() => {
    void evaluate();
  }, [evaluate]);

  const reload = useCallback(async () => {
    analytics.reloadFeatureFlags();
    await evaluate();
  }, [analytics, evaluate]);

  return { value, loading, error, reload };
}
