import type { EnvelopeBase } from "@realtime-events/contracts";
import { registry } from "@realtime-events/contracts";
import type { Logger } from "../logger.js";
import type { EventPublisher } from "./publisher.js";
import { resolveRooms } from "./resolve-rooms.js";

export interface DispatchEventDeps {
  publisher: EventPublisher;
  logger: Logger;
}

/**
 * Caso de uso central do domínio: recebe um envelope JÁ validado pelo
 * registry, resolve as salas destinatárias a partir da audiência, e publica
 * o evento (sem `audience`) através da porta de saída.
 *
 * Não sabe se o envelope veio de HTTP, de uma fila ou de um teste — essa
 * distinção é responsabilidade exclusiva do adapter de entrada que chama
 * esta função.
 */
export async function dispatchEvent(
  envelope: EnvelopeBase,
  deps: DispatchEventDeps,
): Promise<void> {
  const rooms = resolveRooms(envelope.audience);
  const clientEvent = registry.toClientEvent(envelope);

  deps.logger.info("dispatching event", {
    id: clientEvent.id,
    type: clientEvent.type,
    rooms,
  });

  await deps.publisher.publish(rooms, clientEvent);
}
