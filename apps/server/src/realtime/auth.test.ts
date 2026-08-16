import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import type { Logger } from "../logger.js";
import { createAuthMiddleware } from "./auth.js";

function silentLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

const secret = "s".repeat(32);
const key = new TextEncoder().encode(secret);

function fakeSocket() {
  return {
    handshake: { auth: {} as Record<string, unknown> },
    data: {} as Record<string, unknown>,
  };
}

interface CodedError extends Error {
  data: { code: string };
}

describe("createAuthMiddleware", () => {
  it("accepts a valid token and attaches tenantId/userId to socket.data", async () => {
    const middleware = createAuthMiddleware({ jwtKey: key, logger: silentLogger() });
    const token = await new SignJWT({ tenantId: 7 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("12")
      .setIssuedAt()
      .setExpirationTime("10m")
      .sign(key);

    const socket = fakeSocket();
    socket.handshake.auth["token"] = token;
    const next = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(socket as any, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data).toEqual({ tenantId: "7", userId: "12" });
  });

  it("rejects a missing token as TOKEN_INVALID", async () => {
    const middleware = createAuthMiddleware({ jwtKey: key, logger: silentLogger() });
    const socket = fakeSocket();
    const next = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(socket as any, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0]?.[0] as CodedError;
    expect(error.data.code).toBe("TOKEN_INVALID");
  });

  it("rejects an expired token as TOKEN_EXPIRED", async () => {
    const middleware = createAuthMiddleware({ jwtKey: key, logger: silentLogger() });
    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ tenantId: 7 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("12")
      .setIssuedAt(nowSeconds - 3600)
      .setExpirationTime(nowSeconds - 1800)
      .sign(key);

    const socket = fakeSocket();
    socket.handshake.auth["token"] = token;
    const next = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(socket as any, next);

    const error = next.mock.calls[0]?.[0] as CodedError;
    expect(error.data.code).toBe("TOKEN_EXPIRED");
  });

  it("rejects a token signed with the wrong secret as TOKEN_INVALID", async () => {
    const middleware = createAuthMiddleware({ jwtKey: key, logger: silentLogger() });
    const wrongKey = new TextEncoder().encode("x".repeat(32));
    const token = await new SignJWT({ tenantId: 7 })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("12")
      .setExpirationTime("10m")
      .sign(wrongKey);

    const socket = fakeSocket();
    socket.handshake.auth["token"] = token;
    const next = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(socket as any, next);

    const error = next.mock.calls[0]?.[0] as CodedError;
    expect(error.data.code).toBe("TOKEN_INVALID");
  });

  it("rejects a token missing the tenantId claim as TOKEN_INVALID", async () => {
    const middleware = createAuthMiddleware({ jwtKey: key, logger: silentLogger() });
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("12")
      .setExpirationTime("10m")
      .sign(key);

    const socket = fakeSocket();
    socket.handshake.auth["token"] = token;
    const next = vi.fn();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await middleware(socket as any, next);

    const error = next.mock.calls[0]?.[0] as CodedError;
    expect(error.data.code).toBe("TOKEN_INVALID");
  });
});
