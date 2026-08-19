import { REALTIME_CHANNEL, type ClientEvent } from "@realtime-events/contracts";
import type { Server as HttpServer } from "node:http";
import { Server as SocketIoServer, type DefaultEventsMap } from "socket.io";
import { createRedisAdapter } from "../adapters/redis.js";
import type { EventPublisher } from "../core/publisher.js";
import { tenantRoom, userRoom } from "../core/resolve-rooms.js";
import type { Logger } from "../logger.js";
import { createAuthMiddleware } from "./auth.js";
import { registerSubscriptionHandlers } from "./subscriptions.js";
import type { AuthenticatedSocketData } from "./types.js";

export interface CreateGatewayDeps {
	httpServer: HttpServer;
	jwtKey: Uint8Array;
	corsOrigins: string[];
	logger: Logger;
	redisUrl?: string;
}

export interface Gateway {
	io: SocketIoServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, AuthenticatedSocketData>;
	publisher: EventPublisher;
}

/**
 * Cria o servidor Socket.IO em cima do `HttpServer` compartilhado com as
 * rotas HTTP simples (mesma porta). Aplica autenticação, faz o join
 * automático nas salas de tenant/usuário, liga os handlers de subscribe de
 * entidade, e devolve o `EventPublisher` que a rota de ingestão usa.
 */
export async function createGateway(deps: CreateGatewayDeps): Promise<Gateway> {
	const io = new SocketIoServer<DefaultEventsMap, DefaultEventsMap, DefaultEventsMap, AuthenticatedSocketData>(
		deps.httpServer,
		{
			cors: {
				origin: deps.corsOrigins,
				credentials: true,
			},
		},
	);

	if (deps.redisUrl) {
		io.adapter(await createRedisAdapter(deps.redisUrl, deps.logger));
	}

	const authMiddleware = createAuthMiddleware({ jwtKey: deps.jwtKey, logger: deps.logger });
	io.use((socket, next) => void authMiddleware(socket, next));

	io.on("connection", socket => {
		const { tenantId, userId } = socket.data;

		void socket.join(tenantRoom(tenantId));
		void socket.join(userRoom(tenantId, userId));

		deps.logger.info("socket connected", { socketId: socket.id, tenantId, userId });

		registerSubscriptionHandlers(socket, { logger: deps.logger });

		socket.on("disconnect", reason => {
			deps.logger.info("socket disconnected", { socketId: socket.id, reason });
		});
	});

	const publisher: EventPublisher = {
		publish(rooms, event: ClientEvent) {
			io.to([...rooms]).emit(REALTIME_CHANNEL, event);
		},
	};

	return { io, publisher };
}
