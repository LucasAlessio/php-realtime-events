import {
	RealtimeProvider,
	useEntitySubscription,
	useRealtimeEvent,
	useRealtimeStatus,
} from "@lucasalessio/realtime-events-client-react";
import type { ClientEvent } from "@realtime-events/contracts";
import { useState } from "react";

const SERVER_URL = import.meta.env["VITE_SERVER_URL"] ?? "http://localhost:4000";
const DEMO_ORDER_ID = 123;

/**
 * Em produção isto é um fetch para o endpoint do PHP
 * (`/api/realtime/token`). Aqui ele bate no middleware de dev definido em
 * vite.config.ts, que assina o mesmo formato de JWT.
 */
async function getToken(): Promise<string> {
	const response = await fetch("/api/realtime/token");
	if (!response.ok) {
		throw new Error(`failed to fetch realtime token: ${response.status}`);
	}
	const data = (await response.json()) as { token: string };

	return data.token;
}

function StatusBadge() {
	const status = useRealtimeStatus();

	return <span data-status={status}>{status}</span>;
}

function OrderWatcher() {
	const [events, setEvents] = useState<ClientEvent[]>([]);

	// Prova a sala de entidade: só recebe eventos do pedido 123 enquanto
	// este componente estiver montado.
	useEntitySubscription("order", DEMO_ORDER_ID);

	useRealtimeEvent("order.updated", event => {
		setEvents(prev => [event, ...prev].slice(0, 20));
	});

	return (
		<section>
			<h2>Notificações recebidas</h2>
			<p>
				Conexão: <StatusBadge />
			</p>
			<p>
				Simule uma notificação do webhook PHP rodando, em outro terminal:
				<br />
				<code>pnpm emit --type order.updated --orderId {DEMO_ORDER_ID}</code>
			</p>
			{events.length === 0 ? (
				<p>
					<em>Nenhuma notificação recebida ainda.</em>
				</p>
			) : (
				<ul>
					{events.map(event => (
						<li key={event.id}>
							<strong>{event.type}</strong> — {event.occurredAt}
							<pre>{JSON.stringify(event.payload, null, 2)}</pre>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}

export function App() {
	return (
		<RealtimeProvider url={SERVER_URL} getToken={getToken}>
			<main style={{ fontFamily: "system-ui, sans-serif", padding: "2rem", maxWidth: 640 }}>
				<h1>Realtime Events — Playground</h1>
				<p>
					Demonstra o pipeline completo: webhook PHP (simulado por <code>pnpm emit</code>) → servidor
					Socket.IO → este front React.
				</p>
				<OrderWatcher />
			</main>
		</RealtimeProvider>
	);
}
