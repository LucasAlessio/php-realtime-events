import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import { REALTIME_CHANNEL, SUBSCRIBE_EVENT, UNSUBSCRIBE_EVENT } from "@realtime-events/contracts";
import { SignJWT } from "jose";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventPublisher } from "../src/core/publisher.js";
import { computeSignature } from "../src/http/hmac.js";
import { createHttpServer } from "../src/http/server.js";
import type { Logger } from "../src/logger.js";
import { createGateway } from "../src/realtime/gateway.js";

/**
 * Sobe o pipeline real (HTTP de ingestão + gateway Socket.IO) numa porta
 * efêmera e conversa com ele através de um `socket.io-client` de verdade —
 * é a prova de que o adapter de entrada, o domínio e o adapter de saída
 * realmente se encaixam, não só cada peça isolada.
 */

const HMAC_SECRET = "integration-test-hmac-secret-value";
// Base64 (do jeito que o PHP compartilha o segredo em produção) — exercita o
// mesmo caminho de decodificação que `config.ts#decodeJwtSecret` usa, não
// só um texto puro tratado como bytes UTF-8.
const JWT_SECRET = Buffer.from("integration-test-jwt-secret-value").toString("base64url");
const jwtKey = Buffer.from(JWT_SECRET, "base64");

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

async function signToken(claims: { sub: string; tenantId: string }): Promise<string> {
  return new SignJWT({ tenantId: claims.tenantId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(jwtKey);
}

interface TestServer {
  port: number;
  close: () => Promise<void>;
}

async function startTestServer(): Promise<TestServer> {
  const publisherBox: { current?: EventPublisher } = {};
  const publisherProxy: EventPublisher = {
    publish: (rooms, event) => publisherBox.current?.publish(rooms, event),
  };

  const httpServer = createHttpServer({
    publisher: publisherProxy,
    logger: silentLogger,
    hmacSecret: HMAC_SECRET,
    timestampToleranceSeconds: 300,
    maxBodyBytes: 1_048_576,
  });

  const gateway = await createGateway({
    httpServer,
    jwtKey,
    corsOrigins: ["http://localhost:5173"],
    logger: silentLogger,
  });
  publisherBox.current = gateway.publisher;

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address() as AddressInfo;

  return {
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        gateway.io.close();
        httpServer.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function connectClient(port: number, token: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(`http://localhost:${port}`, {
      auth: (cb: (data: { token: string }) => void) => cb({ token }),
      transports: ["websocket"],
      reconnection: false,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function waitForEvent(socket: ClientSocket, timeoutMs = 1500): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("timeout waiting for realtime event")),
      timeoutMs,
    );
    socket.once(REALTIME_CHANNEL, (event: Record<string, unknown>) => {
      clearTimeout(timer);
      resolve(event);
    });
  });
}

function expectNoEvent(socket: ClientSocket, timeoutMs = 400): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, timeoutMs);
    socket.once(REALTIME_CHANNEL, () => {
      clearTimeout(timer);
      reject(new Error("received an unexpected realtime event"));
    });
  });
}

function baseEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    type: "order.updated",
    v: 1,
    occurredAt: new Date().toISOString(),
    audience: { tenantId: "7" },
    payload: { orderId: 123 },
    ...overrides,
  };
}

async function postEmit(
  port: number,
  body: unknown,
  options: { validSignature?: boolean } = {},
): Promise<Response> {
  const rawBody = JSON.stringify(body);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    options.validSignature === false
      ? `sha256=${"0".repeat(64)}`
      : computeSignature(HMAC_SECRET, timestamp, rawBody);

  return fetch(`http://localhost:${port}/internal/emit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Timestamp": timestamp,
      "X-Signature": signature,
    },
    body: rawBody,
  });
}

describe("realtime pipeline (integration)", () => {
  let server: TestServer;
  const clients: ClientSocket[] = [];

  beforeEach(async () => {
    server = await startTestServer();
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) {
      client.close();
    }
    await server.close();
  });

  it("delivers a signed event to an authenticated client of the target audience", async () => {
    const token = await signToken({ sub: "12", tenantId: "7" });
    const client = await connectClient(server.port, token);
    clients.push(client);

    const eventPromise = waitForEvent(client);
    const response = await postEmit(
      server.port,
      baseEnvelope({ audience: { tenantId: "7", userIds: ["12"] } }),
    );

    expect(response.status).toBe(202);
    const received = await eventPromise;
    expect(received).toMatchObject({ type: "order.updated", payload: { orderId: 123 } });
    expect(received).not.toHaveProperty("audience");
  });

  it("does not deliver the event to a client from a different tenant", async () => {
    const tokenTenant7 = await signToken({ sub: "12", tenantId: "7" });
    const tokenTenant9 = await signToken({ sub: "99", tenantId: "9" });
    const clientA = await connectClient(server.port, tokenTenant7);
    const clientB = await connectClient(server.port, tokenTenant9);
    clients.push(clientA, clientB);

    const eventPromise = waitForEvent(clientA);
    const noEventPromise = expectNoEvent(clientB);

    await postEmit(server.port, baseEnvelope({ audience: { tenantId: "7", userIds: ["12"] } }));

    await expect(eventPromise).resolves.toBeDefined();
    await expect(noEventPromise).resolves.toBeUndefined();
  });

  it("rejects an incorrectly signed request with 401 and delivers nothing", async () => {
    const token = await signToken({ sub: "12", tenantId: "7" });
    const client = await connectClient(server.port, token);
    clients.push(client);

    const noEventPromise = expectNoEvent(client);
    const response = await postEmit(server.port, baseEnvelope(), { validSignature: false });

    expect(response.status).toBe(401);
    await expect(noEventPromise).resolves.toBeUndefined();
  });

  it("rejects an unknown event type with 422", async () => {
    const response = await postEmit(server.port, baseEnvelope({ type: "unknown.event" }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { errors: Array<{ kind: string }> };
    expect(body.errors[0]?.kind).toBe("unknown_type");
  });

  it("delivers entity-room events only while subscribed", async () => {
    const token = await signToken({ sub: "12", tenantId: "7" });
    const client = await connectClient(server.port, token);
    clients.push(client);

    await new Promise<void>((resolve, reject) => {
      client.emit(
        SUBSCRIBE_EVENT,
        { entityType: "order", entityId: 123 },
        (ack: { ok: boolean }) => (ack.ok ? resolve() : reject(new Error("subscribe ack failed"))),
      );
    });

    const firstEventPromise = waitForEvent(client);
    await postEmit(
      server.port,
      baseEnvelope({ audience: { tenantId: "7", entity: { type: "order", id: 123 } } }),
    );
    await expect(firstEventPromise).resolves.toMatchObject({ type: "order.updated" });

    await new Promise<void>((resolve, reject) => {
      client.emit(
        UNSUBSCRIBE_EVENT,
        { entityType: "order", entityId: 123 },
        (ack: { ok: boolean }) =>
          ack.ok ? resolve() : reject(new Error("unsubscribe ack failed")),
      );
    });

    const noEventPromise = expectNoEvent(client);
    await postEmit(
      server.port,
      baseEnvelope({
        id: randomUUID(),
        audience: { tenantId: "7", entity: { type: "order", id: 123 } },
      }),
    );
    await expect(noEventPromise).resolves.toBeUndefined();
  });
});
