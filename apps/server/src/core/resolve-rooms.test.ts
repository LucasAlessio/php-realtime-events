import { describe, expect, it } from "vitest";
import { resolveRooms } from "./resolve-rooms.js";

describe("resolveRooms", () => {
	it("resolves to the tenant room when no userIds are given", () => {
		expect(resolveRooms({ tenantId: 7 })).toEqual(["tenant:7"]);
	});

	it("resolves to one room per userId when userIds are given", () => {
		expect(resolveRooms({ tenantId: 7, userIds: [12, 13] })).toEqual(["tenant:7:user:12", "tenant:7:user:13"]);
	});

	it("ignores an empty userIds array and falls back to the tenant room", () => {
		expect(resolveRooms({ tenantId: 7, userIds: [] })).toEqual(["tenant:7"]);
	});

	it("narrows to only the entity room when entity is given without userIds", () => {
		expect(resolveRooms({ tenantId: 7, entity: { type: "order", id: 123 } })).toEqual(["tenant:7:order:123"]);
	});

	it("adds the entity room alongside per-user rooms", () => {
		expect(resolveRooms({ tenantId: 7, userIds: [12], entity: { type: "order", id: 123 } })).toEqual([
			"tenant:7:user:12",
			"tenant:7:order:123",
		]);
	});

	it("always scopes rooms by tenant, never producing a global room", () => {
		const rooms = resolveRooms({
			tenantId: "acme",
			userIds: [1],
			entity: { type: "x", id: 1 },
		});
		for (const room of rooms) {
			expect(room.startsWith("tenant:acme")).toBe(true);
		}
	});
});
