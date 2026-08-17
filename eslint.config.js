// @ts-check
import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
	},
	js.configs.recommended,
	...tseslint.configs.recommendedTypeChecked,
	prettier,
	{
		// Regras que não pedem type information — valem para todo arquivo,
		// TS ou não (por isso ficam fora do bloco com `files` abaixo).
		rules: {
			"@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
			"@typescript-eslint/consistent-type-imports": "error",
			"@typescript-eslint/no-explicit-any": "error",
			"no-useless-concat": "error",
		},
	},
	{
		// Só arquivos dentro do `include` de algum tsconfig.json têm um
		// projeto pro projectService resolver — condição pras regras
		// type-aware (as de recommendedTypeChecked acima + a daqui) rodarem.
		files: ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"],
		ignores: [
			"vitest.config.ts",
			"**/tsup.config.ts",
			"apps/server/scripts/verify-event.mts",
			"apps/server/tests/**/*.ts",
		],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/no-unnecessary-template-expression": "error",
		},
	},
	{
		// Todo o resto: arquivos que não são TS (eslint.config.js, o driver.mjs
		// da skill /new-event) e arquivos .ts fora de qualquer tsconfig.json
		// (configs de build, o script de verificação avulso, os testes de
		// apps/server — já hoje fora do escopo de `pnpm typecheck`, que só
		// cobre `src`). Sem projeto, as regras type-aware ficam desligadas.
		files: [
			"**/*.js",
			"**/*.mjs",
			"**/*.cjs",
			"vitest.config.ts",
			"**/tsup.config.ts",
			"apps/server/scripts/verify-event.mts",
			"apps/server/tests/**/*.ts",
		],
		...tseslint.configs.disableTypeChecked,
	},
	{
		// Scripts Node.js puros (não fazem parte de nenhum workspace package) —
		// ex.: o driver da skill .claude/skills/new-event/. Sem isto, `process`
		// e `console` disparam `no-undef` porque nada aqui declara ambiente Node.
		files: ["**/*.mjs"],
		languageOptions: {
			globals: {
				process: "readonly",
				console: "readonly",
			},
		},
	},
);
