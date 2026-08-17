import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import type { Logger } from "../logger.js";

/**
 * Só é chamado quando `REDIS_URL` está definido. Habilita múltiplos nós do
 * servidor compartilharem salas e broadcast via Redis Pub/Sub — necessário
 * assim que o servidor escalar horizontalmente. Sem `REDIS_URL`, o Socket.IO
 * usa seu adapter em memória padrão e o servidor roda normalmente em 1 nó.
 */
export async function createRedisAdapter(redisUrl: string, logger: Logger) {
	const pubClient = new Redis(redisUrl);
	const subClient = pubClient.duplicate();

	await Promise.all([waitReady(pubClient), waitReady(subClient)]);

	logger.info("redis adapter connected", { redisUrl: maskRedisUrl(redisUrl) });

	return createAdapter(pubClient, subClient);
}

function waitReady(client: Redis): Promise<void> {
	return new Promise((resolve, reject) => {
		client.once("ready", () => resolve());
		client.once("error", reject);
	});
}

function maskRedisUrl(url: string): string {
	try {
		const parsed = new URL(url);
		if (parsed.password) parsed.password = "***";
		return parsed.toString();
	} catch {
		return "***";
	}
}
