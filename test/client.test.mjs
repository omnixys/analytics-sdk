import assert from "node:assert/strict";
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
