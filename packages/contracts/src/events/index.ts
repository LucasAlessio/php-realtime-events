import { createRegistry } from "../registry.js";
import { orderUpdatedEvent } from "./order-updated.js";

/**
 * Catálogo central de notificações.
 *
 * Para adicionar um novo tipo de notificação:
 *   1. Crie `events/<nome>.ts` com um schema de payload (Zod) e
 *      `defineEvent({ type, v, payload })`.
 *   2. Importe o evento aqui e encadeie `.register(...)`.
 *
 * Nada mais precisa mudar: o servidor, a autenticação e o roteamento de
 * salas são genéricos em relação ao catálogo. Um `type` fora deste registro
 * é rejeitado na ingestão com 422.
 *
 * (Ponto de extensão automatizado por `.claude/skills/new-event/` — ver
 * SKILL.md nesse diretório.)
 */
export const registry = createRegistry().register(orderUpdatedEvent);

export type Registry = typeof registry;

export * from "./order-updated.js";
