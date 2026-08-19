/** Dados anexados a `socket.data` pelo middleware de autenticação
 * (realtime/auth.ts) e usados por todo o resto do gateway. */
export interface AuthenticatedSocketData {
	tenantId: string;
	userId: string;
}
