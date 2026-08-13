/** Único canal Socket.IO usado para toda notificação; o `type` no envelope
 * discrimina o evento. Isto mantém logging, telemetria e error handling
 * centralizados em vez de espalhados por um listener por tipo. */
export const REALTIME_CHANNEL = "realtime:event";

/** Cliente → servidor: pede para entrar na sala de uma entidade específica. */
export const SUBSCRIBE_EVENT = "realtime:subscribe";

/** Cliente → servidor: sai da sala de uma entidade específica. */
export const UNSUBSCRIBE_EVENT = "realtime:unsubscribe";

export interface SubscribePayload {
  entityType: string;
  entityId: string | number;
}
