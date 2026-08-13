import { useEffect, useRef } from "react";
import type { ClientEvent } from "@realtime-events/contracts";
import { useRealtimeContext } from "./RealtimeProvider.js";

/**
 * Assina notificações de um `type` específico do catálogo. Para tipagem
 * forte do payload, informe o parâmetro de tipo com o schema inferido do
 * pacote `@realtime-events/contracts`:
 *
 *   useRealtimeEvent<OrderUpdatedPayload>("order.updated", (event) => { ... });
 *
 * O handler não precisa ser memoizado pelo chamador — internamente sempre
 * chamamos a versão mais recente, então só re-assina quando `type` muda.
 */
export function useRealtimeEvent<Payload = unknown>(
  type: string,
  handler: (event: ClientEvent<string, Payload>) => void,
): void {
  const { dispatcher } = useRealtimeContext();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return dispatcher.on(type, (event) => {
      handlerRef.current(event as ClientEvent<string, Payload>);
    });
  }, [dispatcher, type]);
}
