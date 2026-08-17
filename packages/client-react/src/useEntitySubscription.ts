import { SUBSCRIBE_EVENT, UNSUBSCRIBE_EVENT, type SubscribePayload } from "@realtime-events/contracts";
import { useEffect } from "react";
import { useRealtimeContext } from "./RealtimeProvider.js";

/**
 * Assina a sala de uma entidade específica (ex.: "estou vendo o pedido
 * 123") enquanto o componente estiver montado, e cancela ao desmontar.
 * Salas não sobrevivem à reconexão do socket, então este hook também
 * reassina automaticamente sempre que o status volta a "connected".
 */
export function useEntitySubscription(entityType: string, entityId: string | number): void {
	const { socket, status } = useRealtimeContext();

	useEffect(() => {
		if (!socket || status !== "connected") return;

		const payload: SubscribePayload = { entityType, entityId };
		socket.emit(SUBSCRIBE_EVENT, payload);

		return () => {
			socket.emit(UNSUBSCRIBE_EVENT, payload);
		};
	}, [socket, status, entityType, entityId]);
}
