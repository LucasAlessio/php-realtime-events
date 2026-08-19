import type { ClientEvent } from "@realtime-events/contracts";

type Handler = (event: ClientEvent) => void;

/**
 * Registro leve de handlers por `type` de evento. Um único `socket.on` no
 * canal `realtime:event` (ver RealtimeProvider) alimenta este dispatcher,
 * que distribui para quem assinou aquele `type` via `useRealtimeEvent`.
 * Mantém logging/telemetria/erro num único ponto em vez de espalhados por
 * um listener por tipo de notificação.
 */
export class EventDispatcher {
	private readonly handlers = new Map<string, Set<Handler>>();

	on(type: string, handler: Handler): () => void {
		let set = this.handlers.get(type);
		if (!set) {
			set = new Set();
			this.handlers.set(type, set);
		}
		set.add(handler);

		return () => {
			set?.delete(handler);
		};
	}

	dispatch(event: ClientEvent): void {
		const set = this.handlers.get(event.type);
		if (!set) return;
		for (const handler of set) {
			handler(event);
		}
	}
}
