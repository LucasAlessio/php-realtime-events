import { z } from "zod";

const configSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  INGEST_HMAC_SECRET: z.string().min(16, "INGEST_HMAC_SECRET must be at least 16 characters long"),
  INGEST_TIMESTAMP_TOLERANCE_SECONDS: z.coerce.number().int().positive().default(300),
  MAX_BODY_BYTES: z.coerce.number().int().positive().default(1_048_576),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters long"),
  CORS_ORIGINS: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    ),
  REDIS_URL: z
    .string()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : undefined)),
});

export type Config = z.infer<typeof configSchema>;

/** Valida o ambiente uma única vez, na borda (composition root). Nenhum
 * outro módulo lê `process.env` diretamente. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const result = configSchema.safeParse(env);
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${message}`);
  }
  return result.data;
}
