import type { Audience } from "@realtime-events/contracts";

export function tenantRoom(tenantId: string | number): string {
  return `tenant:${tenantId}`;
}

export function userRoom(tenantId: string | number, userId: string | number): string {
  return `tenant:${tenantId}:user:${userId}`;
}

export function entityRoom(
  tenantId: string | number,
  entityType: string,
  entityId: string | number,
): string {
  return `tenant:${tenantId}:${entityType}:${entityId}`;
}

/**
 * Traduz a audiência semântica (o que o PHP sabe: tenant, usuários,
 * entidade de negócio) para o conjunto de salas do Socket.IO que devem
 * receber o evento. A nomenclatura de sala é um detalhe interno do servidor
 * e nunca cruza a fronteira com o PHP — só a `Audience` cruza.
 *
 * Regras (mutuamente combináveis, exceto a última):
 *  - `userIds` presente e não vazio → uma sala por usuário.
 *  - `entity` presente → soma a sala da entidade, para quem assinou aquele
 *    recurso especificamente (ex.: "estou vendo o pedido 123").
 *  - Se NENHum dos dois foi informado → cai para a sala do tenant inteiro
 *    (broadcast). Ou seja, `entity` sozinho NARROWS a entrega para quem
 *    assinou aquela entidade — não soma o broadcast do tenant inteiro.
 */
export function resolveRooms(audience: Audience): string[] {
  const rooms = new Set<string>();
  const hasUserIds = Boolean(audience.userIds && audience.userIds.length > 0);
  const hasEntity = Boolean(audience.entity);

  if (hasUserIds) {
    for (const userId of audience.userIds ?? []) {
      rooms.add(userRoom(audience.tenantId, userId));
    }
  }

  if (audience.entity) {
    rooms.add(entityRoom(audience.tenantId, audience.entity.type, audience.entity.id));
  }

  if (!hasUserIds && !hasEntity) {
    rooms.add(tenantRoom(audience.tenantId));
  }

  return [...rooms];
}
