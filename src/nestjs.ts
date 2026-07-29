import { AnalyticsClient } from "./client.js";
import type { AnalyticsConfig } from "./types.js";

export class AnalyticsService extends AnalyticsClient {
  constructor(config: AnalyticsConfig) {
    super(config);
  }

  onApplicationShutdown(): Promise<void> {
    return this.shutdown();
  }
}
