// @ts-check
import js from "@eslint/js";
import markdown from "@eslint/markdown";
import html from "@html-eslint/eslint-plugin";
import stylistic from "@stylistic/eslint-plugin";
import jsonc from "eslint-plugin-jsonc";
import yml from "eslint-plugin-yml";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

const JS_FILES = ["**/*.js", "**/*.mjs", "**/*.cjs"];
const TS_FILES = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];
const JSON_FILES = ["**/*.json", "**/*.jsonc", "**/*.json5"];
const MD_FILES = ["**/*.md"];
const YML_FILES = ["**/*.yaml", "**/*.yml"];

export default defineConfig([
	{
		languageOptions: {
			globals: {
				...globals.node,
				...globals.browser,
				NodeJS: true,
			}
		}
	},
	{
		ignores: ["**/dist/**", "**/node_modules/**", "**/coverage/**"],
	},
	{
		files: [...JS_FILES, ...TS_FILES],
		extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
	},
	{
		// Regras de estilo (indentação, aspas, ponto-e-vírgula, vírgula final,
		// espaçamento) para todo arquivo JS/TS
		files: [...JS_FILES, ...TS_FILES],
		plugins: {
			"@stylistic": stylistic,
		},
		rules: {
			"no-var": "error",
			"no-undef": "error",
			"prefer-const": "error",
			"no-unused-vars": "off",
			"no-useless-assignment": "off",
			"prefer-template": ["error"],
			"template-curly-spacing": ["error", "never"],
			"no-useless-concat": "error",
			"no-unused-expressions": ["error"],
			"no-useless-escape": "warn",
			"no-tabs": ["error", { allowIndentationTabs: true }],
			"@stylistic/max-len": [
				"error",
				{
					code: 120,
					tabWidth: 4,
					ignoreUrls: true,
					ignoreStrings: true,
					ignoreTemplateLiterals: true,
					ignoreRegExpLiterals: true,
					ignoreComments: true,
				},
			],
			"@stylistic/brace-style": ["error", "1tbs", { allowSingleLine: true }],
			"@stylistic/arrow-parens": ["error", "as-needed", { requireForBlockBody: false }],
			"@stylistic/operator-linebreak": ["error", "before", { overrides: { "=": "after" } }],
			"@stylistic/multiline-ternary": "off",
			"@stylistic/jsx-one-expression-per-line": "off",
			"@stylistic/quotes": ["error", "double", {
				avoidEscape: true,
				allowTemplateLiterals: "always",
			}],
			"@stylistic/semi": ["error", "always"],
			"@stylistic/computed-property-spacing": ["error", "never"],
			"@stylistic/object-property-newline": ["error", {
				allowAllPropertiesOnSameLine: true,
			}],
			"@stylistic/no-mixed-spaces-and-tabs": ["error"],
			"@stylistic/eol-last": ["error", "always"],
			"@stylistic/space-before-function-paren": ["error", {
				anonymous: "always",
				named: "never",
				asyncArrow: "always"
			}],
			"@stylistic/max-statements-per-line": ["error", {
				max: 3
			}],
			"@stylistic/padding-line-between-statements": ["error", {
				blankLine: "always",
				prev: "*",
				next: ["function", "continue", "throw", "try", "return"]
			}, {
				blankLine: "always",
				prev: ["try", "function"],
				next: "*"
			}],
			"@stylistic/no-multiple-empty-lines": ["error", {
				max: 1,
				maxEOF: 0,
				maxBOF: 0
			}],
			"@stylistic/padded-blocks": ["error", "never"],
			"@stylistic/no-trailing-spaces": "error",
			"@stylistic/comma-spacing": "error",
			"@stylistic/comma-style": "error",
			"@stylistic/function-call-spacing": ["error", "never"],
			"@stylistic/key-spacing": "error",
			"@stylistic/keyword-spacing": "error",
			"@stylistic/space-before-blocks": "error",
			"@stylistic/arrow-spacing": ["error", {
				before: true,
				after: true,
			}],
			"@stylistic/space-infix-ops": "error",
			"@stylistic/no-multi-spaces": "error",
			"@stylistic/space-in-parens": ["error", "never"],
			"@stylistic/block-spacing": ["error", "always"],
			"@stylistic/no-extra-parens": "off",
			"@stylistic/object-curly-newline": ["error", {
				consistent: true,
			}],
			"@stylistic/object-curly-spacing": ["error", "always"],
			"@stylistic/quote-props": ["error", "as-needed"],
			"@stylistic/indent": ["error", "tab", {
				SwitchCase: 1
			}],
			"@stylistic/type-annotation-spacing": ["error"],
			"@stylistic/type-named-tuple-spacing": ["error"],
			"@stylistic/type-generic-spacing": ["error"],
			"@stylistic/member-delimiter-style": ["error", {
				multiline: {
					delimiter: "semi",
					requireLast: true
				},
				singleline: {
					delimiter: "semi",
					requireLast: false
				},
				multilineDetection: "brackets",
			}],
			"@stylistic/jsx-quotes": ["error", "prefer-double"],
			"@typescript-eslint/no-unused-vars": ["warn", {
				args: "none",
				varsIgnorePattern: "^_"
			}],
			"@typescript-eslint/no-namespace": "off",
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/prefer-namespace-keyword": "off",
			"@typescript-eslint/consistent-type-imports": "error",
		},
	},
	{
		// Só arquivos dentro do `include` de algum tsconfig.json têm um
		// projeto pro projectService resolver — condição pras regras
		// type-aware (as de recommendedTypeChecked acima + a daqui) rodarem.
		files: TS_FILES,
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
		// files: JS_FILES,
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
	// ---------------------------------------------------------------------
	// JSON — antes formatado pelo Prettier; agora eslint-plugin-jsonc cobre
	// tanto validação (chave duplicada, número inválido, etc.) quanto
	// formatação (indentação, aspas), com `--fix`.
	// ---------------------------------------------------------------------
	{
		// `extends` (não `...spread`) de propósito: os configs do jsonc/markdown
		// vêm com entradas sem `files` (registro de plugin, regras "off" de
		// baseline) que, soltas, valeriam pra TODO arquivo do projeto — inclusive
		// .md e .ts — e quebram o ESLint ao rodar regra JSON contra AST de
		// Markdown. `extends` força o `files` daqui em cada entrada estendida.
		files: JSON_FILES,
		extends: jsonc.configs["flat/recommended-with-json"],
		rules: {
			"jsonc/indent": ["error", "tab"],
			"jsonc/key-spacing": ["error", { beforeColon: false, afterColon: true }],
			"jsonc/object-curly-spacing": ["error", "always"],
			"jsonc/array-bracket-spacing": ["error", "never"],
		},
	},
	// ---------------------------------------------------------------------
	// Markdown — @eslint/markdown é um linter de prosa (heading, links
	// quebrados, tabelas), não um formatador. Sem processor, então blocos de
	// código ```bash/```js dentro dos .md não são relintados como JS.
	// ---------------------------------------------------------------------
	{
		files: MD_FILES,
		extends: markdown.configs.recommended,
		rules: {
			// Vários blocos são diagrama ASCII ou saída de terminal, sem
			// linguagem — não faz sentido inventar uma tag só pra regra passar.
			"markdown/fenced-code-language": "off",
		},
	},
	// ---------------------------------------------------------------------
	// HTML — só apps/playground/index.html. `flat/recommended` não vem
	// escopado a `files`; sem isso o parser HTML seria aplicado a todo o
	// projeto.
	// ---------------------------------------------------------------------
	{
		files: ["**/*.html"],
		...html.configs["flat/recommended"],
		rules: {
			...html.configs["flat/recommended"].rules,
			"@html-eslint/indent": ["error", "tab"],
			"@html-eslint/require-closing-tags": ["error", { selfClosing: "always" }],
			"@html-eslint/no-extra-spacing-tags": ["error", { enforceBeforeSelfClose: true }]
		},
	},
	{
		// `extends`, não `...spread`: `yml.configs["flat/recommended"]` é um
		// array de 3 entradas (mesmo formato do jsonc/markdown acima), não um
		// objeto único como o do html-eslint. Espalhar um array dentro de um
		// objeto de config gera chaves numéricas ("0", "1", "2"), que o ESLint
		// rejeita com `ConfigError: Unexpected key "0" found`.
		files: YML_FILES,
		extends: yml.configs["flat/recommended"],
		rules: {
			// `pull_request:` sem valor é sintaxe válida e idiomática do GitHub
			// Actions (dispara em todos os tipos de evento) — não é um mapping
			// vazio por engano.
			"yml/no-empty-mapping-value": "off",
		},
	},
]);
