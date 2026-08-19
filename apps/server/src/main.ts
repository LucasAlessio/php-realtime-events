import { config as loadEnvFile } from "dotenv";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import type { EventPublisher } from "./core/publisher.js";
import { createHttpServer } from "./http/server.js";
import { logger } from "./logger.js";
import { createGateway } from "./realtime/gateway.js";

// Carrega o .env da raiz do monorepo para desenvolvimento local (`pnpm dev`).
// Em Docker/produção as variáveis já vêm do ambiente do container, e como
// dotenv nunca sobrescreve variáveis já definidas, isto é um no-op seguro
// caso o arquivo não exista ou as chaves já estejam no ambiente.
loadEnvFile({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

async function main(): Promise<void> {
	const config = loadConfig();

	// O servidor HTTP precisa de um EventPublisher para a rota de ingestão,
	// mas o publisher real só existe depois que o gateway Socket.IO sobe (ele
	// é criado a partir do próprio httpServer). Resolvemos essa referência
	// circular com um proxy fino, preenchido assim que o gateway estiver
	// pronto — sem isso, a ordem de criação viraria um ciclo impossível.
	const publisherBox: { current?: EventPublisher } = {};
	const publisherProxy: EventPublisher = {
		publish: (rooms, event) => publisherBox.current?.publish(rooms, event),
	};

	const httpServer = createHttpServer({
		publisher: publisherProxy,
		logger,
		hmacSecret: config.INGEST_HMAC_SECRET,
		timestampToleranceSeconds: config.INGEST_TIMESTAMP_TOLERANCE_SECONDS,
		maxBodyBytes: config.MAX_BODY_BYTES,
	});

	const gateway = await createGateway({
		httpServer,
		jwtKey: config.JWT_KEY,
		corsOrigins: config.CORS_ORIGINS,
		logger,
		...(config.REDIS_URL !== undefined ? { redisUrl: config.REDIS_URL } : {}),
	});
	publisherBox.current = gateway.publisher;

	httpServer.listen(config.PORT, () => {
		logger.info("server listening", {
			port: config.PORT,
			redisEnabled: Boolean(config.REDIS_URL),
		});
	});

	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.on(signal, () => {
			logger.info("shutting down", { signal });
			httpServer.close(() => process.exit(0));
		});
	}
}

try {
	await main();
} catch (error) {
	logger.error("fatal startup error", {
		error: error instanceof Error ? error.message : String(error),
	});
	process.exit(1);
}
