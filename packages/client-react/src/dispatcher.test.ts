import { describe, expect, it, vi } from "vitest";
import { EventDispatcher } from "./dispatcher.js";

function event(type: string) {
  return { id: "1", type, v: 1, occurredAt: "2026-08-12T21:49:00Z", payload: {} };
}

describe("EventDispatcher", () => {
  it("delivers an event only to handlers registered for its type", () => {
    const dispatcher = new EventDispatcher();
    const orderHandler = vi.fn();
    const invoiceHandler = vi.fn();
    dispatcher.on("order.updated", orderHandler);
    dispatcher.on("invoice.paid", invoiceHandler);

    dispatcher.dispatch(event("order.updated"));

    expect(orderHandler).toHaveBeenCalledTimes(1);
    expect(invoiceHandler).not.toHaveBeenCalled();
  });

  it("stops calling a handler after its unsubscribe function runs", () => {
    const dispatcher = new EventDispatcher();
    const handler = vi.fn();
    const unsubscribe = dispatcher.on("order.updated", handler);

    unsubscribe();
    dispatcher.dispatch(event("order.updated"));

    expect(handler).not.toHaveBeenCalled();
  });

  it("does nothing when no handler is registered for the type", () => {
    const dispatcher = new EventDispatcher();
    expect(() => dispatcher.dispatch(event("unregistered.type"))).not.toThrow();
  });
});
