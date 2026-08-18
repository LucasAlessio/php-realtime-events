import { REALTIME_CHANNEL, type ClientEvent } from "@realtime-events/contracts";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { EventDispatcher } from "./dispatcher.js";

export type RealtimeStatus = "connecting" | "connected" | "reconnecting" | "disconnected" | "error";

interface RealtimeContextValue {
	socket: Socket | null;
	status: RealtimeStatus;
	dispatcher: EventDispatcher;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export interface RealtimeProviderProps {
	/** URL do servidor Socket.IO (ex.: https://realtime.example.com). */
	url: string;
	/**
	 * Chamado a cada tentativa de conexão/reconexão — NUNCA passe um token
	 * fixo aqui. O JWT emitido pelo PHP tem TTL curto (v1: 10 min); esta
	 * função deve buscar um token fresco (ex.: `fetch("/api/realtime/token")`)
	 * toda vez que for chamada.
	 */
	getToken: () => Promise<string> | string;
	children: ReactNode;
}

/**
 * Dono do ciclo de vida da conexão Socket.IO. Um único listener no canal
 * `realtime:event` alimenta o `EventDispatcher`, que os hooks
 * `useRealtimeEvent`/`useEntitySubscription` consomem via contexto.
 */
export function RealtimeProvider({ url, getToken, children }: RealtimeProviderProps) {
	const [status, setStatus] = useState<RealtimeStatus>("connecting");
	const [socket, setSocket] = useState<Socket | null>(null);
	const dispatcherRef = useRef(new EventDispatcher());

	useEffect(() => {
		const nextSocket = io(url, {
			transports: ["websocket", "polling"],
			auth: (callback: (data: { token: string }) => void) => {
				// Uma chamada rejeitada de getToken() ainda deve disparar o callback — caso contrário,
				// o socket nunca avança além do handshake e o `status` permanece
				// travado em "connecting", sem nada a ser observado. Um token vazio
				// faz com que o servidor o rejeite como TOKEN_INVALID, o que é
				// tratado pelo manipulador de `connect_error` existente abaixo.
				Promise.resolve(getToken())
					.then(token => callback({ token }))
					.catch(() => callback({ token: "" }));
			},
		});

		nextSocket.on("connect", () => setStatus("connected"));
		nextSocket.on("disconnect", () => setStatus("disconnected"));
		nextSocket.on("connect_error", () => setStatus("error"));
		nextSocket.io.on("reconnect_attempt", () => setStatus("reconnecting"));
		nextSocket.on(REALTIME_CHANNEL, (event: ClientEvent) => {
			dispatcherRef.current.dispatch(event);
		});

		setSocket(nextSocket);
		setStatus("connecting");

		return () => {
			nextSocket.close();
			setSocket(null);
		};
		// `getToken` é intencionalmente omitido: reconectar não deve depender de
		// identidade referencial da função, só de `url` mudar de verdade.
	}, [url]);

	const value = useMemo<RealtimeContextValue>(
		() => ({ socket, status, dispatcher: dispatcherRef.current }),
		[socket, status],
	);

	return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtimeContext(): RealtimeContextValue {
	const ctx = useContext(RealtimeContext);
	if (!ctx) {
		throw new Error("useRealtimeContext must be used within a <RealtimeProvider>");
	}

	return ctx;
}
