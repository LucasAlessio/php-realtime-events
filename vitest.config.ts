import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "node",
		include: ["**/*.{test,spec}.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
	},
	resolve: {
		alias: {
			// Testes rodam direto contra o código-fonte do contracts, sem exigir
			// um build prévio do pacote.
			"@realtime-events/contracts": fileURLToPath(new URL("./packages/contracts/src/index.ts", import.meta.url)),
		},
	},
});
