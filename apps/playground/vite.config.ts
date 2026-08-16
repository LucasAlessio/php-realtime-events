import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { config as loadEnvFile } from "dotenv";
import { SignJWT } from "jose";
import { defineConfig, type Connect, type ViteDevServer } from "vite";

// Reaproveita o .env da raiz do monorepo — o mesmo JWT_SECRET que o
// servidor usa para validar tokens no handshake do Socket.IO.
loadEnvFile({ path: fileURLToPath(new URL("../../.env", import.meta.url)) });

const jwtSecret = process.env["JWT_SECRET"] ?? "";

// Espelha `decodeJwtSecret` de apps/server/src/config.ts: o PHP compartilha
// o segredo em base64 e assina com os bytes decodificados, não com os bytes
// UTF-8 da própria string base64. Duplicado aqui (como scripts/emit.ts já
// duplica o helper de HMAC do servidor) para o playground não depender do
// pacote do servidor.
const jwtSecretEncoding = (process.env["JWT_SECRET_ENCODING"] ?? "base64") === "utf8" ? "utf8" : "base64";
const jwtKey =
  jwtSecretEncoding === "utf8"
    ? new TextEncoder().encode(jwtSecret)
    : Buffer.from(jwtSecret.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""), "base64");

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
      const handler: Connect.NextHandleFunction = (_req, res) => {
        void (async () => {
          if (!jwtSecret) {
            res.statusCode = 500;
            res.end(JSON.stringify({ error: "JWT_SECRET não definido (veja .env na raiz)" }));
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
