import { createServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { EventPublisher } from "../core/publisher.js";
import type { Logger } from "../logger.js";
import { handleIngestRequest } from "./ingest-route.js";

export interface CreateHttpServerDeps {
	publisher: EventPublisher;
	logger: Logger;
	hmacSecret: string;
	timestampToleranceSeconds: number;
	maxBodyBytes: number;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	const json = JSON.stringify(body);
	res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
	res.end(json);
}

/**
 * Servidor HTTP puro (`node:http`), sem framework: só existem duas rotas.
 * Este mesmo `HttpServer` é passado ao Socket.IO (realtime/gateway.ts) para
 * que HTTP e WebSocket compartilhem a mesma porta.
 */
export function createHttpServer(deps: CreateHttpServerDeps): HttpServer {
	return createServer((req: IncomingMessage, res: ServerResponse) => {
		const url = req.url ?? "/";

		if (req.method === "GET" && url === "/healthz") {
			sendJson(res, 200, { status: "ok" });
			return;
		}

		if (req.method === "POST" && url === "/internal/emit") {
			void handleIngestRequest(req, res, deps);
			return;
		}

		sendJson(res, 404, { error: "not_found" });
	});
}
