import { z } from "zod";

/**
 * Audiência semântica: descreve QUEM deve receber o evento, em termos que o
 * PHP já conhece (tenant, usuários, entidade de negócio). O servidor traduz
 * isto para salas do Socket.IO — o nome da sala nunca é decidido pelo PHP.
 */
export const audienceSchema = z.object({
	tenantId: z.union([z.string(), z.number()]),
	/** Se presente, restringe a entrega a estes usuários dentro do tenant. */
	userIds: z.array(z.union([z.string(), z.number()])).optional(),
	/** Se presente, também entrega a quem estiver inscrito nesta entidade. */
	entity: z
		.object({
			type: z.string().min(1),
			id: z.union([z.string(), z.number()]),
		})
		.optional(),
});

export type Audience = z.infer<typeof audienceSchema>;
