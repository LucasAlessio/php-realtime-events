import { z } from "zod";
import { defineEvent } from "../registry.js";

/**
 * Evento de EXEMPLO — troque pelos tipos reais assim que o catálogo de
 * notificações do parceiro for conhecido. Serve como modelo de como um novo
 * arquivo de evento deve ser escrito: um schema de payload + `defineEvent`.
 */
export const orderUpdatedPayloadSchema = z.object({
  orderId: z.union([z.string(), z.number()]),
  status: z.string().optional(),
});

export const orderUpdatedEvent = defineEvent({
  type: "order.updated",
  v: 1,
  payload: orderUpdatedPayloadSchema,
});
