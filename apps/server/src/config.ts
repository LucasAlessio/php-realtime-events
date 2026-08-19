import { z } from "zod";

/**
 * Decodifica o `JWT_SECRET` para os bytes de chave que o `jose` deve usar.
 *
 * O PHP compartilha o segredo em base64 e assina com os bytes decodificados
 * — não com os bytes UTF-8 da própria string base64. `encoding: "base64"`
 * (o default) espelha isso. `encoding: "utf8"` existe para ambientes que
 * ainda usam um segredo em texto puro (ex.: os testes deste repo).
 *
 * A decodificação base64 do Node é leniente (ignora lixo em vez de
 * rejeitar), então validamos com um round-trip estrito: se recodificar os
 * bytes não reproduz a entrada normalizada, o valor não era base64 de
 * verdade — provavelmente um texto puro rotulado com o encoding errado.
 */
export function decodeJwtSecret(value: string, encoding: "base64" | "utf8"): Uint8Array {
	if (encoding === "utf8") {
		return new TextEncoder().encode(value);
	}

	const normalized = value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
	const bytes = Buffer.from(normalized, "base64");
	if (bytes.toString("base64url") !== normalized) {
		throw new Error(
			"JWT_SECRET is not valid base64 (set JWT_SECRET_ENCODING=utf8 if it's a plain-text secret)",
		);
	}

	return bytes;
}

const configSchema = z
	.object({
		PORT: z.coerce.number().int().positive().default(4000),
		INGEST_HMAC_SECRET: z.string().min(16, "INGEST_HMAC_SECRET must be at least 16 characters long"),
		INGEST_TIMESTAMP_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
		MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),
		JWT_SECRET: z.string(),
		JWT_SECRET_ENCODING: z.enum(["base64", "utf8"]).default("base64"),
		CORS_ORIGINS: z
			.string()
			.default("")
			.transform(value =>
				value
					.split(",")
					.map(origin => origin.trim())
					.filter(origin => origin.length > 0),
			),
		REDIS_URL: z
			.string()
			.optional()
			.transform(value => (value && value.length > 0 ? value : undefined)),
	})
	.transform((config, ctx) => {
		let jwtKey: Uint8Array;

		try {
			jwtKey = decodeJwtSecret(config.JWT_SECRET, config.JWT_SECRET_ENCODING);
		} catch (error) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["JWT_SECRET"],
				message: error instanceof Error ? error.message : String(error),
			});

			return z.NEVER;
		}

		if (jwtKey.byteLength < 16) {
			ctx.addIssue({
				code: z.ZodIssueCode.custom,
				path: ["JWT_SECRET"],
				message: "JWT_SECRET must decode to at least 16 bytes",
			});

			return z.NEVER;
		}

		return { ...config, JWT_KEY: jwtKey };
	});

export type Config = z.infer<typeof configSchema>;

/** Valida o ambiente uma única vez, na borda (composition root). Nenhum
 * outro módulo lê `process.env` diretamente. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const result = configSchema.safeParse(env);
	if (!result.success) {
		const message = result.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`).join("; ");

		throw new Error(`Invalid environment configuration: ${message}`);
	}

	return result.data;
}
