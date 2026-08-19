import { jwtVerify } from "jose";
import type { Socket } from "socket.io";
import type { Logger } from "../logger.js";
import type { AuthenticatedSocketData } from "./types.js";

export interface AuthMiddlewareDeps {
	jwtSecret: string;
	logger: Logger;
}

const textEncoder = new TextEncoder();

/**
 * Middleware de handshake (`io.use`): valida o JWT curto emitido pelo PHP
 * (`/api/realtime/token`) e anexa `{ tenantId, userId }` a `socket.data`.
 * Nenhuma sala é decidida aqui — apenas identidade; o join nas salas padrão
 * acontece no handler de `connection` em gateway.ts.
 *
 * Recusa com `data.code` distinguindo `TOKEN_EXPIRED` de `TOKEN_INVALID`,
 * para o cliente saber se vale a pena buscar um token novo e reconectar.
 */
export function createAuthMiddleware(deps: AuthMiddlewareDeps) {
	const key = textEncoder.encode(deps.jwtSecret);

	return async function authMiddleware(
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		socket: Socket<any, any, any, AuthenticatedSocketData>,
		next: (err?: Error) => void,
	): Promise<void> {
		const token = socket.handshake.auth?.["token"] as string | undefined;

		if (!token) {
			next(authError("Missing token", "TOKEN_INVALID"));

			return;
		}

		try {
			const { payload } = await jwtVerify(token, key, { algorithms: ["HS256"] });
			const tenantId = payload["tenantId"];
			const userId = payload.sub;

			if (!userId || (typeof tenantId !== "string" && typeof tenantId !== "number")) {
				next(authError("Token is missing required claims", "TOKEN_INVALID"));

				return;
			}

			socket.data.tenantId = String(tenantId);
			socket.data.userId = String(userId);
			next();
		} catch (error) {
			const code = (error as { code?: string }).code === "ERR_JWT_EXPIRED" ? "TOKEN_EXPIRED" : "TOKEN_INVALID";

			deps.logger.warn("socket auth rejected", {
				code,
				message: error instanceof Error ? error.message : String(error),
			});

			next(authError("Invalid or expired token", code));
		}
	};
}

function authError(message: string, code: "TOKEN_EXPIRED" | "TOKEN_INVALID"): Error {
	return Object.assign(new Error(message), { data: { code } });
}
