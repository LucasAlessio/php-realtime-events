#!/usr/bin/env tsx
/**
 * Prova ponta a ponta que um envelope de exemplo (gerado pela skill
 * /new-event) é aceito, roteado e entregue pelo pipeline real — sem
 * depender do `.env` local nem de um servidor já rodando.
 *
 * Sobe HTTP + Socket.IO numa porta efêmera reusando exatamente o padrão de
 * `apps/server/tests/integration.test.ts` (publisherBox + createHttpServer +
 * createGateway), assina um JWT para um usuário do tenant do envelope,
 * conecta um socket.io-client real, opcionalmente assina a sala de entidade
 * (`realtime:subscribe`), faz o POST assinado por HMAC em `/internal/emit`
 * e confere que o evento chega — e que `audience` não veio junto.
 *
 * Uso:
 *   tsx scripts/verify-event.mts --sample <caminho-para-envelope.json>
 *
 * Chamado pela skill via: node .claude/skills/new-event/driver.mjs verify --type <type>
 */
import { REALTIME_CHANNEL, SUBSCRIBE_EVENT, type ClientEvent } from "@realtime-events/contracts";
import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import type { EventPublisher } from "../src/core/publisher.js";
import { computeSignature } from "../src/http/hmac.js";
import { createHttpServer } from "../src/http/server.js";
import type { Logger } from "../src/logger.js";
import { createGateway } from "../src/realtime/gateway.js";

const HMAC_SECRET = "verify-event-hmac-secret-value";
const JWT_SECRET = "verify-event-jwt-secret-value";
const jwtKey = new TextEncoder().encode(JWT_SECRET);

const silentLogger: Logger = { info: () => {}, warn: () => {}, error: () => {} };

function parseArgs(argv: string[]): { samplePath: string } {
	const idx = argv.indexOf("--sample");
	if (idx === -1 || !argv[idx + 1]) {
		throw new Error("uso: verify-event.mts --sample <caminho-para-envelope.json>");
	}

	return { samplePath: argv[idx + 1]! };
}

interface Envelope {
	id: string;
	type: string;
	v: number;
	occurredAt: string;
	audience: {
		tenantId: string | number;
		userIds?: (string | number)[];
		entity?: { type: string; id: string | number };
	};
	payload: unknown;
}

async function signToken(claims: { sub: string; tenantId: string }): Promise<string> {
	return new SignJWT({ tenantId: claims.tenantId })
		.setProtectedHeader({ alg: "HS256" })
		.setSubject(claims.sub)
		.setIssuedAt()
		.setExpirationTime("2m")
		.sign(jwtKey);
}

function connectClient(port: number, token: string): Promise<ClientSocket> {
	return new Promise((resolve, reject) => {
		const socket = ioClient(`http://localhost:${port}`, {
			auth: (cb: (data: { token: string }) => void) => cb({ token }),
			transports: ["websocket"],
			reconnection: false,
		});
		socket.once("connect", () => resolve(socket));
		socket.once("connect_error", reject);
	});
}

function subscribeToEntity(socket: ClientSocket, entity: { type: string; id: string | number }): Promise<void> {
	return new Promise((resolve, reject) => {
		socket.emit(
			SUBSCRIBE_EVENT,
			{ entityType: entity.type, entityId: entity.id },
			(ack: { ok: boolean; error?: string }) => {
				if (ack.ok) resolve();
				else reject(new Error(`realtime:subscribe falhou: ${ack.error}`));
			},
		);
	});
}

function waitForEvent(socket: ClientSocket, timeoutMs = 3000): Promise<ClientEvent> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error("timeout esperando o evento chegar")), timeoutMs);
		socket.once(REALTIME_CHANNEL, (event: ClientEvent) => {
			clearTimeout(timer);
			resolve(event);
		});
	});
}

async function main(): Promise<void> {
	const { samplePath } = parseArgs(process.argv.slice(2));
	const raw = readFileSync(samplePath, "utf8");
	const envelope = JSON.parse(raw) as Envelope;

	// Renova id/occurredAt a cada rodada — o servidor não deduplica por id,
	// mas manter isso realista evita confundir logs entre execuções.
	envelope.id = randomUUID();
	envelope.occurredAt = new Date().toISOString();

	const tenantId = String(envelope.audience.tenantId);
	const userId = String(envelope.audience.userIds?.[0] ?? "verify-user");

	const publisherBox: { current?: EventPublisher } = {};
	const publisherProxy: EventPublisher = {
		publish: (rooms, event) => publisherBox.current?.publish(rooms, event),
	};

	const httpServer = createHttpServer({
		publisher: publisherProxy,
		logger: silentLogger,
		hmacSecret: HMAC_SECRET,
		timestampToleranceSeconds: 300,
		maxBodyBytes: 1_048_576,
	});

	const gateway = await createGateway({
		httpServer,
		jwtSecret: JWT_SECRET,
		corsOrigins: ["http://localhost:5173"],
		logger: silentLogger,
	});
	publisherBox.current = gateway.publisher;

	await new Promise<void>(resolve => httpServer.listen(0, resolve));
	const port = (httpServer.address() as AddressInfo).port;

	let exitCode = 0;
	let client: ClientSocket | undefined;

	try {
		const token = await signToken({ sub: userId, tenantId });
		client = await connectClient(port, token);
		console.log(`✓ conectado como tenant=${tenantId} user=${userId} (porta ${port})`);

		if (envelope.audience.entity) {
			await subscribeToEntity(client, envelope.audience.entity);
			console.log(`✓ assinado em entity=${envelope.audience.entity.type}:${envelope.audience.entity.id}`);
		}

		const eventPromise = waitForEvent(client);

		const rawBody = JSON.stringify(envelope);
		const timestamp = String(Math.floor(Date.now() / 1000));
		const signature = computeSignature(HMAC_SECRET, timestamp, rawBody);

		const response = await fetch(`http://localhost:${port}/internal/emit`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"X-Timestamp": timestamp,
				"X-Signature": signature,
			},
			body: rawBody,
		});
		const responseBody: unknown = await response.json().catch(() => undefined);
		console.log(`→ POST /internal/emit → ${response.status} ${JSON.stringify(responseBody)}`);

		if (response.status !== 202) {
			throw new Error(`esperava 202 do ingest, recebi ${response.status}`);
		}

		const received = await eventPromise;
		console.log(`✓ evento recebido pelo cliente: ${JSON.stringify(received)}`);

		if ("audience" in received) {
			throw new Error("audience vazou para o cliente — registry.toClientEvent deveria removê-lo");
		}
		if (received.type !== envelope.type) {
			throw new Error(`type divergente: esperava "${envelope.type}", recebi "${received.type}"`);
		}

		console.log("");
		console.log(`OK — "${envelope.type}" entregue ponta a ponta.`);
	} catch (err) {
		exitCode = 1;
		console.error(`FALHOU: ${err instanceof Error ? err.message : String(err)}`);
	} finally {
		client?.close();
		gateway.io.close();
		await new Promise<void>(resolve => httpServer.close(() => resolve()));
	}

	process.exit(exitCode);
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
	process.exit(1);
});
