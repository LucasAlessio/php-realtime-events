import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createRegistry, defineEvent } from "./registry.js";

const pingEvent = defineEvent({
	type: "ping",
	v: 1,
	payload: z.object({ nonce: z.string() }),
});

function baseInput(overrides: Record<string, unknown> = {}) {
	return {
		id: "550e8400-e29b-41d4-a716-446655440000",
		type: "ping",
		v: 1,
		occurredAt: "2026-08-12T21:49:00Z",
		audience: { tenantId: 7 },
		payload: { nonce: "abc" },
		...overrides,
	};
}

describe("EventRegistry", () => {
	it("parses a valid envelope for a registered type", () => {
		const registry = createRegistry().register(pingEvent);
		const result = registry.parseEnvelope(baseInput());
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.envelope.type).toBe("ping");
			expect(result.envelope.payload).toEqual({ nonce: "abc" });
		}
	});

	it("rejects an unknown type", () => {
		const registry = createRegistry().register(pingEvent);
		const result = registry.parseEnvelope(baseInput({ type: "unknown.event" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("unknown_type");
		}
	});

	it("rejects a payload that fails the registered schema", () => {
		const registry = createRegistry().register(pingEvent);
		const result = registry.parseEnvelope(baseInput({ payload: { nonce: 123 } }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("invalid_payload");
		}
	});

	it("rejects a malformed envelope before touching the payload schema", () => {
		const registry = createRegistry().register(pingEvent);
		const result = registry.parseEnvelope(baseInput({ id: "not-a-uuid" }));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("invalid_envelope");
		}
	});

	it("strips audience when projecting to a client event", () => {
		const registry = createRegistry().register(pingEvent);
		const result = registry.parseEnvelope(baseInput());
		if (!result.ok) throw new Error("expected ok");
		const clientEvent = registry.toClientEvent(result.envelope);
		expect(clientEvent).not.toHaveProperty("audience");
		expect(clientEvent).toEqual({
			id: "550e8400-e29b-41d4-a716-446655440000",
			type: "ping",
			v: 1,
			occurredAt: "2026-08-12T21:49:00Z",
			payload: { nonce: "abc" },
		});
	});

	it("throws when the same type is registered twice", () => {
		const registry = createRegistry().register(pingEvent);
		expect(() => registry.register(pingEvent)).toThrow(/already registered/);
	});
});
