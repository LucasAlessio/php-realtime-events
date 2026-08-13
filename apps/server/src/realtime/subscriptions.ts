import type { Socket } from "socket.io";
import {
  SUBSCRIBE_EVENT,
  UNSUBSCRIBE_EVENT,
  type SubscribePayload,
} from "@realtime-events/contracts";
import { entityRoom } from "../core/resolve-rooms.js";
import type { Logger } from "../logger.js";
import type { AuthenticatedSocketData } from "./types.js";

export interface SubscriptionDeps {
  logger: Logger;
}

type Ack = (response: { ok: boolean; error?: string }) => void;

function isSubscribePayload(value: unknown): value is SubscribePayload {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record["entityType"] === "string" &&
    record["entityType"].length > 0 &&
    (typeof record["entityId"] === "string" || typeof record["entityId"] === "number")
  );
}

/**
 * Registra os handlers de `realtime:subscribe` / `realtime:unsubscribe`
 * para uma conexão já autenticada. A sala de entidade é SEMPRE prefixada
 * pelo `tenantId` do token — o cliente escolhe a entidade, nunca o tenant,
 * então não existe caminho para assinar dados de outro tenant (v1: os
 * claims do JWT bastam, sem callback de autorização por registro).
 */
export function registerSubscriptionHandlers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  socket: Socket<any, any, any, AuthenticatedSocketData>,
  deps: SubscriptionDeps,
): void {
  socket.on(SUBSCRIBE_EVENT, (payload: unknown, ack?: Ack) => {
    if (!isSubscribePayload(payload)) {
      ack?.({ ok: false, error: "invalid_payload" });
      return;
    }
    const room = entityRoom(socket.data.tenantId, payload.entityType, payload.entityId);
    void socket.join(room);
    deps.logger.info("socket subscribed", { socketId: socket.id, room });
    ack?.({ ok: true });
  });

  socket.on(UNSUBSCRIBE_EVENT, (payload: unknown, ack?: Ack) => {
    if (!isSubscribePayload(payload)) {
      ack?.({ ok: false, error: "invalid_payload" });
      return;
    }
    const room = entityRoom(socket.data.tenantId, payload.entityType, payload.entityId);
    void socket.leave(room);
    deps.logger.info("socket unsubscribed", { socketId: socket.id, room });
    ack?.({ ok: true });
  });
}
