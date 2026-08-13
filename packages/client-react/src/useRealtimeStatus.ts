import { useRealtimeContext, type RealtimeStatus } from "./RealtimeProvider.js";

/** connected / reconnecting / disconnected / error — para exibir feedback
 * de conexão sem acoplar o componente ao socket cru. */
export function useRealtimeStatus(): RealtimeStatus {
  return useRealtimeContext().status;
}
