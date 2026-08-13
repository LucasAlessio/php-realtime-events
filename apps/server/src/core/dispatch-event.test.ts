import { describe, expect, it, vi } from "vitest";
import { dispatchEvent } from "./dispatch-event.js";
import type { EventPublisher } from "./publisher.js";
import type { Logger } from "../logger.js";

function silentLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe("dispatchEvent", () => {
  it("publishes to the rooms resolved from the audience, without leaking it", async () => {
    const publish = vi.fn();
    const publisher: EventPublisher = { publish };

    await dispatchEvent(
      {
        id: "550e8400-e29b-41d4-a716-446655440000",
        type: "order.updated",
        v: 1,
        occurredAt: "2026-08-12T21:49:00Z",
        audience: { tenantId: 7, userIds: [12] },
        payload: { orderId: 123 },
      },
      { publisher, logger: silentLogger() },
    );

    expect(publish).toHaveBeenCalledTimes(1);
    const [rooms, event] = publish.mock.calls[0] as [string[], Record<string, unknown>];
    expect(rooms).toEqual(["tenant:7:user:12"]);
    expect(event).not.toHaveProperty("audience");
    expect(event).toMatchObject({
      id: "550e8400-e29b-41d4-a716-446655440000",
      type: "order.updated",
    });
  });
});
