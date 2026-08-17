#!/usr/bin/env tsx
/**
 * Simula o webhook PHP: monta um envelope, assina com HMAC-SHA256 (o mesmo
 * segredo compartilhado que o servidor valida) e faz POST em
 * `/internal/emit`. Uso:
 *
 *   pnpm emit --type order.updated --orderId 123
 *   pnpm emit --type order.updated --tenantId 7 --userId 12
 *
 * Para tipos além de `order.updated` (payload/entidade arbitrários):
 *
 *   pnpm emit --type invoice.paid --payload '{"invoiceId":4711,"amountCents":12900}' \
 *     --entityType invoice --entityId 4711
 *
 *   pnpm emit --file .claude/skills/new-event/samples/invoice-paid.json
 *
 * `--file` lê um envelope completo (o formato gerado pela skill /new-event
 * em `samples/<tipo>.json`), renova `id`/`occurredAt` e ignora as demais
 * flags de payload/audiência. Um caminho relativo em `--file` é resolvido a
 * partir da raiz do repo (onde `pnpm emit` normalmente é digitado) — não do
 * cwd real do processo, que o pnpm troca para `apps/playground` ao rodar o
 * script (`pnpm --filter ... run emit`).
 */
import { config as loadEnvFile } from "dotenv";
import { createHmac, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

loadEnvFile({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });

interface CliOptions {
	type: string;
	tenantId: string;
	userId?: string;
	orderId: string;
	payload?: string;
	entityType?: string;
	entityId?: string;
	file?: string;
	server: string;
}

function parseArgs(argv: string[]): CliOptions {
	const options: CliOptions = {
		type: "order.updated",
		tenantId: "7",
		orderId: String(Math.floor(Math.random() * 100_000)),
		server: process.env["EMIT_SERVER_URL"] ?? "http://localhost:4000",
	};

	for (let i = 0; i < argv.length; i += 1) {
		const flag = argv[i];
		const value = argv[i + 1];
		if (value === undefined) continue;

		switch (flag) {
			case "--type":
				options.type = value;
				i += 1;
				break;
			case "--tenantId":
				options.tenantId = value;
				i += 1;
				break;
			case "--userId":
				options.userId = value;
				i += 1;
				break;
			case "--orderId":
				options.orderId = value;
				i += 1;
				break;
			case "--payload":
				options.payload = value;
				i += 1;
				break;
			case "--entityType":
				options.entityType = value;
				i += 1;
				break;
			case "--entityId":
				options.entityId = value;
				i += 1;
				break;
			case "--file":
				options.file = value;
				i += 1;
				break;
			case "--server":
				options.server = value;
				i += 1;
				break;
			default:
				break;
		}
	}

	return options;
}

interface Envelope {
	id: string;
	type: string;
	v: number;
	occurredAt: string;
	audience: Record<string, unknown>;
	payload: unknown;
}

/**
 * Monta o envelope a partir das flags. `--file` tem prioridade — lê um
 * envelope pronto (ex.: sample gerado pela skill /new-event) e só renova
 * `id`/`occurredAt`, o resto sai como está no arquivo. Sem `--file`, o
 * payload é `--payload` (JSON cru) se informado, senão o default
 * `{ orderId, status: "updated" }` de `order.updated`; a audiência usa
 * `--entityType`/`--entityId` se informados, senão o default `order`.
 */
function buildEnvelope(options: CliOptions): Envelope {
	if (options.file) {
		const filePath = path.isAbsolute(options.file) ? options.file : path.join(REPO_ROOT, options.file);
		const fileContent = JSON.parse(readFileSync(filePath, "utf8")) as Envelope;
		return { ...fileContent, id: randomUUID(), occurredAt: new Date().toISOString() };
	}

	const payload = options.payload
		? (JSON.parse(options.payload) as unknown)
		: { orderId: options.orderId, status: "updated" };

	const entityType = options.entityType ?? "order";
	const entityId = options.entityId ?? options.orderId;

	return {
		id: randomUUID(),
		type: options.type,
		v: 1,
		occurredAt: new Date().toISOString(),
		audience: {
			tenantId: options.tenantId,
			...(options.userId ? { userIds: [options.userId] } : {}),
			entity: { type: entityType, id: entityId },
		},
		payload,
	};
}

function computeSignature(secret: string, timestamp: string, rawBody: string): string {
	const hmac = createHmac("sha256", secret);
	hmac.update(`${timestamp}.${rawBody}`);
	return `sha256=${hmac.digest("hex")}`;
}

async function main(): Promise<void> {
	const options = parseArgs(process.argv.slice(2));
	const secret = process.env["INGEST_HMAC_SECRET"];
	if (!secret) {
		throw new Error("INGEST_HMAC_SECRET não definido. Copie .env.example para .env na raiz do projeto.");
	}

	const envelope = buildEnvelope(options);

	const rawBody = JSON.stringify(envelope);
	const timestamp = String(Math.floor(Date.now() / 1000));
	const signature = computeSignature(secret, timestamp, rawBody);

	console.log(`→ POST ${options.server}/internal/emit`);
	console.log(`  ${rawBody}`);

	const response = await fetch(`${options.server}/internal/emit`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			"X-Timestamp": timestamp,
			"X-Signature": signature,
		},
		body: rawBody,
	});

	const body: unknown = await response.json().catch(() => undefined);
	console.log(`← ${response.status} ${JSON.stringify(body)}`);

	if (!response.ok) {
		process.exitCode = 1;
	}
}

main().catch((error: unknown) => {
	console.error(error instanceof Error ? error.message : String(error));
	process.exitCode = 1;
});
