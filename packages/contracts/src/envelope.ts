import { z } from "zod";
import { audienceSchema } from "./audience.js";

/**
 * Formato de entrada aceito de qualquer produtor de eventos (hoje: o webhook
 * PHP). `payload` ainda não foi validado contra o schema do tipo — isso é
 * responsabilidade do registry (ver registry.ts).
 */
export const envelopeBaseSchema = z.object({
	id: z.string().uuid(),
	type: z.string().min(1),
	v: z.number().int().positive(),
	occurredAt: z.string().datetime(),
	audience: audienceSchema,
	payload: z.unknown(),
});

export type EnvelopeBase = z.infer<typeof envelopeBaseSchema>;

/**
 * O que efetivamente trafega para o navegador: sem `audience`, para que um
 * cliente nunca veja para quem mais o evento foi endereçado.
 */
export interface ClientEvent<Type extends string = string, Payload = unknown> {
	id: string;
	type: Type;
	v: number;
	occurredAt: string;
	payload: Payload;
}
