import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";
import {
  AnalyticsClient,
  AnalyticsTransportError,
} from "../dist/index.js";

test("batches canonical events and strips sensitive values", async () => {
  const batches = [];
  const client = new AnalyticsClient({
    writeKey: "write-key",
    endpoint: "https://analytics.example.test",
    consent: "granted",
    flushAt: 2,
    transport: { async send(batch) { batches.push(batch); } },
  });

  client.track("InvitationViewed", {
    invitationId: "invitation-1",
    token: "must-not-leak",
    nested: { password: "hidden", value: true },
  });
  client.track("InvitationAccepted", { invitationId: "invitation-1" });
  await client.shutdown();

  assert.equal(batches.length, 1);
  assert.equal(batches[0].events.length, 2);
  assert.equal("token" in batches[0].events[0].properties, false);
  assert.deepEqual(batches[0].events[0].properties.nested, { value: true });
});

test("drops events when consent is denied", async () => {
  let calls = 0;
  const client = new AnalyticsClient({
    writeKey: "write-key",
    endpoint: "https://analytics.example.test",
    consent: "denied",
    transport: { async send() { calls += 1; } },
  });
  client.track("ShouldNotBeSent");
  await client.shutdown();
  assert.equal(calls, 0);
  assert.equal(client.pending(), 0);
});

test("does not queue or request while consent is unknown", async () => {
  let calls = 0;
  const client = new AnalyticsClient({
    writeKey: "write-key",
    endpoint: "https://analytics.example.test",
    transport: { async send() { calls += 1; } },
  });
  client.track("ShouldNotBeQueued");
  await client.flush();
  assert.equal(client.pending(), 0);
  assert.equal(calls, 0);
  await client.shutdown();
});

test("parallel 401 responses share exactly one token refresh", async () => {
  const { AnalyticsTokenManager, FetchAnalyticsTransport } =
    await import("../dist/transport.js");
  let providerCalls = 0;
  const manager = new AnalyticsTokenManager(undefined, async () => {
    providerCalls += 1;
    return providerCalls === 1 ? "expired" : "fresh";
  });
  const fetcher = async (_url, init) => {
    const token = init.headers.authorization;
    return new Response(null, {
      status: token.endsWith("expired") ? 401 : 202,
    });
  };
  const transports = [
    new FetchAnalyticsTransport(
      "https://analytics.example.test",
      manager,
      fetcher,
    ),
    new FetchAnalyticsTransport(
      "https://analytics.example.test",
      manager,
      fetcher,
    ),
  ];
  const batch = {
    batchId: crypto.randomUUID(),
    sentAt: new Date().toISOString(),
    events: [],
  };
  await Promise.all(transports.map((transport) => transport.send(batch)));
  assert.equal(providerCalls, 2);
});

test("maps HTTP 503 ingestion failures to retryable transport errors", async () => {
  const { FetchAnalyticsTransport } = await import("../dist/transport.js");
  const transport = new FetchAnalyticsTransport(
    "https://analytics.example.test",
    "write-key",
    async () => new Response(null, { status: 503 }),
  );

  await assert.rejects(
    transport.send({
      batchId: crypto.randomUUID(),
      sentAt: new Date().toISOString(),
      events: [],
    }),
    (error) => {
      assert.equal(error.name, "AnalyticsTransportError");
      assert.equal(error.status, 503);
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("requeues retryable transport failures", async () => {
  const client = new AnalyticsClient({
    writeKey: "write-key",
    endpoint: "https://analytics.example.test",
    consent: "granted",
    transport: {
      async send() {
        throw new AnalyticsTransportError("unavailable", 503, true);
      },
    },
  });
  client.track("RetryMe");
  await assert.rejects(client.flush(), AnalyticsTransportError);
  assert.equal(client.pending(), 1);
  client.setConsent("denied");
  await client.shutdown();
});

test("evaluates and caches feature flags per subject and facts", async () => {
  let calls = 0;
  const client = new AnalyticsClient({
    writeKey: "write-key",
    endpoint: "https://analytics.example.test",
    userId: "user-1",
    consent: "granted",
    featureFlagTransport: {
      async evaluate(request) {
        calls += 1;
        return [
          {
            key: request.keys[0],
            flagId: "flag-1",
            version: 2,
            variant: "enabled",
            value: true,
            reason: "RULE_MATCH",
          },
        ];
      },
    },
    transport: { async send() {} },
  });

  assert.equal(await client.getFeatureFlag("new-checkout", false, {
    country: "DE",
  }), true);
  assert.equal(await client.getFeatureFlag("new-checkout", false, {
    country: "DE",
  }), true);
  assert.equal(calls, 1);

  client.reloadFeatureFlags();
  assert.equal(await client.getFeatureFlag("new-checkout", false, {
    country: "DE",
  }), true);
  assert.equal(calls, 2);
  await client.shutdown();
});

test("emits every documented framework subpath", async () => {
  await Promise.all(
    ["browser", "node", "react", "next", "nestjs"].map((subpath) =>
      access(new URL(`../dist/${subpath}.js`, import.meta.url)),
    ),
  );
});
