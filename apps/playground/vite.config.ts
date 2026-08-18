import react from "@vitejs/plugin-react";
import { config as loadEnvFile } from "dotenv";
import { SignJWT } from "jose";
import { fileURLToPath } from "node:url";
import { defineConfig, type Connect, type ViteDevServer } from "vite";

// Reaproveita o .env da raiz do monorepo — o mesmo JWT_SECRET que o
// servidor usa para validar tokens no handshake do Socket.IO.
loadEnvFile({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const jwtSecret = process.env["JWT_SECRET"] ?? "";
const jwtKey = new TextEncoder().encode(jwtSecret);

/**
 * Stand-in para o endpoint `/api/realtime/token` que o PHP exporia em
 * produção. Existe só para o playground rodar sem depender de um backend
 * PHP real — assina o MESMO formato de JWT (HS256, claims `sub`/`tenantId`)
 * que `realtime/auth.ts` do servidor espera.
 */
function fakePhpTokenEndpoint() {
	return {
		name: "fake-php-token-endpoint",
		configureServer(server: ViteDevServer) {
			const handler: Connect.NextHandleFunction = (req, res) => {
				void (async () => {
					if (!jwtSecret) {
						res.statusCode = 500;
						res.end(
							JSON.stringify({
								error: "JWT_SECRET não definido (veja .env na raiz)",
							}),
						);

						return;
					}
					const token = await new SignJWT({ tenantId: "7" })
						.setProtectedHeader({ alg: "HS256" })
						.setSubject("12")
						.setIssuedAt()
						.setExpirationTime("10m")
						.sign(jwtKey);
					res.setHeader("Content-Type", "application/json; charset=utf-8");
					res.end(JSON.stringify({ token }));
				})();
			};
			server.middlewares.use("/api/realtime/token", handler);
		},
	};
}

export default defineConfig({
	plugins: [react(), fakePhpTokenEndpoint()],
	server: { port: 5173 },
});
