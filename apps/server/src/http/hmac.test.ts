import { describe, expect, it } from "vitest";
import { computeSignature, verifySignature } from "./hmac.js";

describe("verifySignature", () => {
  const secret = "s".repeat(32);

  it("accepts a correctly signed request within the tolerance window", () => {
    const now = 1_700_000_000;
    const timestamp = String(now);
    const rawBody = JSON.stringify({ hello: "world" });
    const signature = computeSignature(secret, timestamp, rawBody);

    const result = verifySignature({
      secret,
      rawBody,
      timestampHeader: timestamp,
      signatureHeader: signature,
      toleranceSeconds: 300,
      now,
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects a wrong signature", () => {
    const now = 1_700_000_000;
    const result = verifySignature({
      secret,
      rawBody: "{}",
      timestampHeader: String(now),
      signatureHeader: "sha256=deadbeef",
      toleranceSeconds: 300,
      now,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });

  it("rejects a timestamp outside the tolerance window (anti-replay)", () => {
    const now = 1_700_000_000;
    const timestamp = String(now - 1000);
    const rawBody = "{}";
    const signature = computeSignature(secret, timestamp, rawBody);
    const result = verifySignature({
      secret,
      rawBody,
      timestampHeader: timestamp,
      signatureHeader: signature,
      toleranceSeconds: 300,
      now,
    });
    expect(result).toEqual({ ok: false, reason: "timestamp_out_of_range" });
  });

  it("rejects missing headers", () => {
    const result = verifySignature({
      secret,
      rawBody: "{}",
      timestampHeader: undefined,
      signatureHeader: undefined,
      toleranceSeconds: 300,
    });
    expect(result).toEqual({ ok: false, reason: "missing_headers" });
  });

  it("rejects a malformed timestamp", () => {
    const result = verifySignature({
      secret,
      rawBody: "{}",
      timestampHeader: "not-a-number",
      signatureHeader: "sha256=abc",
      toleranceSeconds: 300,
    });
    expect(result).toEqual({ ok: false, reason: "malformed_timestamp" });
  });

  it("rejects a body tampered with after signing", () => {
    const now = 1_700_000_000;
    const timestamp = String(now);
    const signature = computeSignature(secret, timestamp, JSON.stringify({ a: 1 }));
    const result = verifySignature({
      secret,
      rawBody: JSON.stringify({ a: 2 }),
      timestampHeader: timestamp,
      signatureHeader: signature,
      toleranceSeconds: 300,
      now,
    });
    expect(result).toEqual({ ok: false, reason: "invalid_signature" });
  });
});
