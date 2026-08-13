import type { ClientEvent } from "@realtime-events/contracts";

/**
 * Porta de saída: como um evento já resolvido chega às salas destinatárias.
 * O domínio (`dispatch-event.ts`) não sabe que existe Socket.IO — só sabe
 * publicar em "salas" nomeadas. `SocketIoPublisher` (realtime/gateway.ts) é
 * o único adapter concreto hoje.
 */
export interface EventPublisher {
  publish(rooms: readonly string[], event: ClientEvent): Promise<void> | void;
}
