#!/usr/bin/env node
/**
 * Driver da skill /new-event. Três subcomandos:
 *
 *   node driver.mjs scaffold --spec <arquivo.json|->   gera evento + patch + teste + doc + sample
 *   node driver.mjs verify   --type <type>              prova a entrega ponta a ponta (servidor real)
 *   node driver.mjs remove   --type <type>               desfaz um scaffold (arquivos + patch)
 *
 * Sem dependências externas para scaffold/remove — só `node:fs`/`node:path`.
 * `verify` invoca o `tsx` de apps/server (via child_process) para rodar
 * apps/server/scripts/verify-event.mts, que precisa das deps do server.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const SKILL_DIR = path.dirname(__filename);
const ROOT = path.resolve(SKILL_DIR, "../../..");

const CONTRACTS_EVENTS_DIR = path.join(ROOT, "packages/contracts/src/events");
const EVENTS_INDEX_FILE = path.join(CONTRACTS_EVENTS_DIR, "index.ts");
const SAMPLES_DIR = path.join(SKILL_DIR, "samples");
const DOCS_DIR = path.join(ROOT, "docs/events");

function fail(message) {
  process.stderr.write(`error: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Nomenclatura derivada de `type` ("invoice.paid" -> segments ["invoice","paid"])
// ---------------------------------------------------------------------------

function segments(type) {
  const parts = type.split(".").filter(Boolean);
  if (parts.length < 1) fail(`type inválido: "${type}"`);
  return parts;
}

function toKebab(type) {
  return segments(type).join("-");
}

function toCamel(type) {
  const [first, ...rest] = segments(type);
  return first + rest.map((s) => s[0].toUpperCase() + s.slice(1)).join("");
}

function toPascal(type) {
  const camel = toCamel(type);
  return camel[0].toUpperCase() + camel.slice(1);
}

// ---------------------------------------------------------------------------
// Leitura do spec
// ---------------------------------------------------------------------------

function readSpec(specArg) {
  const raw = specArg === "-" ? readFileSync(0, "utf8") : readFileSync(specArg, "utf8");
  let spec;
  try {
    spec = JSON.parse(raw);
  } catch (err) {
    fail(`spec não é JSON válido: ${err.message}`);
  }
  if (!spec.type || typeof spec.type !== "string")
    fail('spec.type é obrigatório (string, ex: "invoice.paid")');
  if (!/^[a-z0-9]+(\.[a-z0-9]+)+$/.test(spec.type)) {
    fail(`spec.type deve ser "dominio.acao" em minúsculas (recebido: "${spec.type}")`);
  }
  if (!spec.description || typeof spec.description !== "string")
    fail("spec.description é obrigatório");
  if (!Array.isArray(spec.fields) || spec.fields.length === 0)
    fail("spec.fields precisa de ao menos 1 campo");
  for (const f of spec.fields) {
    if (!f.name || !f.zod)
      fail(`cada campo precisa de "name" e "zod" (falhou em ${JSON.stringify(f)})`);
    if (!("sample" in f))
      fail(`campo "${f.name}" precisa de "sample" (usado no envelope de exemplo e no teste)`);
  }
  if (!spec.audience || spec.audience.tenantId === undefined) {
    fail("spec.audience.tenantId é obrigatório");
  }
  if (spec.audience.entity && !spec.fields.some((f) => f.name === spec.audience.entity.idFrom)) {
    fail(
      `spec.audience.entity.idFrom ("${spec.audience.entity.idFrom}") precisa referenciar um campo existente em spec.fields`,
    );
  }
  spec.v = spec.v ?? 1;
  return spec;
}

// ---------------------------------------------------------------------------
// scaffold
// ---------------------------------------------------------------------------

function fieldZodExpr(field) {
  const hasOptional = /\.optional\(\)\s*$/.test(field.zod.trim());
  if (field.optional && !hasOptional) return `${field.zod}.optional()`;
  return field.zod;
}

function renderEventFile(spec) {
  const camel = toCamel(spec.type);
  const pascal = toPascal(spec.type);
  const fieldLines = spec.fields
    .map((f) => {
      const expr = fieldZodExpr(f);
      const comment = f.doc ? ` // ${f.doc}` : "";
      return `  ${f.name}: ${expr},${comment}`;
    })
    .join("\n");

  return `import { z } from "zod";
import { defineEvent } from "../registry.js";

/**
 * ${spec.description}
 */
export const ${camel}PayloadSchema = z.object({
${fieldLines}
});

export type ${pascal}Payload = z.infer<typeof ${camel}PayloadSchema>;

export const ${camel}Event = defineEvent({
  type: "${spec.type}",
  v: ${spec.v},
  payload: ${camel}PayloadSchema,
});
`;
}

function sampleObjectLiteral(spec, indent = "  ") {
  const lines = spec.fields.map((f) => `${indent}${f.name}: ${JSON.stringify(f.sample)},`);
  return `{\n${lines.join("\n")}\n${indent.slice(2)}}`;
}

function renderTestFile(spec) {
  const camel = toCamel(spec.type);
  const kebab = toKebab(spec.type);
  const hasRequired = spec.fields.some((f) => !f.optional);
  const invalidPayload = hasRequired ? "{}" : '"not-an-object"';

  return `import { describe, expect, it } from "vitest";
import { createRegistry } from "../registry.js";
import { ${camel}Event, ${camel}PayloadSchema } from "./${kebab}.js";

describe("${spec.type}", () => {
  it("registra o tipo e valida um payload de exemplo", () => {
    const registry = createRegistry().register(${camel}Event);
    expect(registry.has("${spec.type}")).toBe(true);

    const result = ${camel}PayloadSchema.safeParse(${sampleObjectLiteral(spec)});
    expect(result.success).toBe(true);
  });

  it("rejeita um payload inválido", () => {
    const result = ${camel}PayloadSchema.safeParse(${invalidPayload});
    expect(result.success).toBe(false);
  });
});
`;
}

function buildSampleEnvelope(spec) {
  const payload = Object.fromEntries(spec.fields.map((f) => [f.name, f.sample]));
  const audience = { tenantId: spec.audience.tenantId };
  if (spec.audience.userIds) audience.userIds = spec.audience.userIds;
  if (spec.audience.entity) {
    const idField = spec.fields.find((f) => f.name === spec.audience.entity.idFrom);
    audience.entity = { type: spec.audience.entity.type, id: idField.sample };
  }
  return {
    id: randomUUID(),
    type: spec.type,
    v: spec.v,
    occurredAt: new Date().toISOString(),
    audience,
    payload,
  };
}

function describeAudienceRule(spec) {
  const a = spec.audience;
  const rooms = [];
  if (a.userIds) rooms.push(`\`tenant:${a.tenantId}:user:{id}\` para cada id em \`userIds\``);
  if (a.entity)
    rooms.push(`\`tenant:${a.tenantId}:${a.entity.type}:{id}\` (assinantes da entidade)`);
  if (rooms.length === 0)
    rooms.push(`\`tenant:${a.tenantId}\` (broadcast — nem \`userIds\` nem \`entity\` presentes)`);
  return rooms;
}

function renderDoc(spec, samplePath) {
  const pascal = toPascal(spec.type);
  const kebab = toKebab(spec.type);
  const sample = buildSampleEnvelope(spec);
  const sampleJson = JSON.stringify(sample, null, 2);
  const rooms = describeAudienceRule(spec);

  const fieldRows = spec.fields
    .map(
      (f) =>
        `| \`${f.name}\` | \`${f.zod}\` | ${f.optional ? "não" : "sim"} | ${JSON.stringify(f.sample)} | ${f.doc ?? "—"} |`,
    )
    .join("\n");

  return `# \`${spec.type}\` (v${spec.v})

${spec.description}

Arquivo do contrato: \`packages/contracts/src/events/${kebab}.ts\`.
Sample de envelope: \`.claude/skills/new-event/samples/${kebab}.json\`.

## Payload

| Campo | Tipo (Zod) | Obrigatório | Exemplo | Descrição |
|---|---|---|---|---|
${fieldRows}

## Audiência

\`audience.tenantId\` é sempre obrigatório. \`userIds\` e \`entity\` são
**aditivos** e restringem a entrega — a sala do tenant inteiro só é usada
como fallback quando nem um nem outro está presente (ver
\`apps/server/src/core/resolve-rooms.ts\`). Para este evento, o servidor
publica em:

${rooms.map((r) => `- ${r}`).join("\n")}

## Envelope de exemplo

\`\`\`json
${sampleJson}
\`\`\`

## Emitir do lado PHP

O PHP assina o corpo cru (raw bytes, antes de qualquer reserialização) com
HMAC-SHA256 sobre \`"{timestamp}.{rawBody}"\`, usando o segredo compartilhado
\`INGEST_HMAC_SECRET\`, e envia em \`X-Timestamp\` / \`X-Signature\`:

\`\`\`php
<?php
$secret = getenv('INGEST_HMAC_SECRET');
$envelope = [
    'id' => bin2hex(random_bytes(16)), // ou um gerador de UUIDv4 de verdade
    'type' => '${spec.type}',
    'v' => ${spec.v},
    'occurredAt' => gmdate('Y-m-d\\TH:i:s\\Z'),
    'audience' => ${phpArrayLiteral(sample.audience, 2)},
    'payload' => ${phpArrayLiteral(sample.payload, 2)},
];

$rawBody = json_encode($envelope);
$timestamp = (string) time();
$signature = 'sha256=' . hash_hmac('sha256', "{$timestamp}.{$rawBody}", $secret);

$ch = curl_init('https://SEU_HOST/internal/emit');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $rawBody,
    CURLOPT_HTTPHEADER => [
        'Content-Type: application/json',
        "X-Timestamp: {$timestamp}",
        "X-Signature: {$signature}",
    ],
    CURLOPT_RETURNTRANSFER => true,
]);
curl_exec($ch);
\`\`\`

## Consumir no front (React)

\`\`\`tsx
import { useRealtimeEvent } from "@lucasalessio/realtime-events-client-react";
import type { ${pascal}Payload } from "@lucasalessio/realtime-events-client-react";

useRealtimeEvent<${pascal}Payload>("${spec.type}", (event) => {
  // event.payload é ${pascal}Payload; event.audience NUNCA chega aqui
  // (o servidor remove antes de publicar — registry.toClientEvent).
});
\`\`\`

## Testar manualmente

\`\`\`bash
pnpm emit --file ${path.relative(ROOT, samplePath)}
\`\`\`
`;
}

function phpArrayLiteral(value, depth) {
  const pad = "    ".repeat(depth);
  const closePad = "    ".repeat(depth - 1);
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const items = value.map((v) => `${pad}${phpScalar(v)},`).join("\n");
    return `[\n${items}\n${closePad}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value)
      .map(([k, v]) => `${pad}'${k}' => ${phpArrayLiteral(v, depth + 1)},`)
      .join("\n");
    return `[\n${entries}\n${closePad}]`;
  }
  return phpScalar(value);
}

function phpScalar(value) {
  if (typeof value === "string") return `'${value.replace(/'/g, "\\'")}'`;
  return String(value);
}

// ---------------------------------------------------------------------------
// Patch de packages/contracts/src/events/index.ts
// ---------------------------------------------------------------------------

function parseEventsIndex(content) {
  const importRe = /^import \{ (\w+) \} from "\.\/(.+)\.js";$/gm;
  const events = [];
  for (const m of content.matchAll(importRe)) {
    events.push({ varName: m[1], file: m[2] });
  }
  return events;
}

function renderEventsIndex(events) {
  const sorted = [...events].sort((a, b) => a.file.localeCompare(b.file));
  const importLines = [
    'import { createRegistry } from "../registry.js";',
    ...sorted.map((e) => `import { ${e.varName} } from "./${e.file}.js";`),
  ].join("\n");

  const chain =
    sorted.length <= 1
      ? `createRegistry()${sorted.map((e) => `.register(${e.varName})`).join("")}`
      : `createRegistry()\n${sorted.map((e) => `  .register(${e.varName})`).join("\n")}`;

  const exportLines = sorted.map((e) => `export * from "./${e.file}.js";`).join("\n");

  return `${importLines}

/**
 * Catálogo central de notificações.
 *
 * Para adicionar um novo tipo de notificação:
 *   1. Crie \`events/<nome>.ts\` com um schema de payload (Zod) e
 *      \`defineEvent({ type, v, payload })\`.
 *   2. Importe o evento aqui e encadeie \`.register(...)\`.
 *
 * Nada mais precisa mudar: o servidor, a autenticação e o roteamento de
 * salas são genéricos em relação ao catálogo. Um \`type\` fora deste registro
 * é rejeitado na ingestão com 422.
 *
 * (Ponto de extensão automatizado por \`.claude/skills/new-event/\` — ver
 * SKILL.md nesse diretório.)
 */
export const registry = ${chain};

export type Registry = typeof registry;

${exportLines}
`;
}

function patchEventsIndexAdd(newEvent) {
  const content = readFileSync(EVENTS_INDEX_FILE, "utf8");
  const events = parseEventsIndex(content);
  if (events.some((e) => e.file === newEvent.file)) {
    fail(`"${newEvent.file}" já está registrado em events/index.ts`);
  }
  events.push(newEvent);
  writeFileSync(EVENTS_INDEX_FILE, renderEventsIndex(events));
}

function patchEventsIndexRemove(file) {
  const content = readFileSync(EVENTS_INDEX_FILE, "utf8");
  const events = parseEventsIndex(content);
  const remaining = events.filter((e) => e.file !== file);
  if (remaining.length === events.length) {
    fail(`"${file}" não está registrado em events/index.ts (nada a remover)`);
  }
  writeFileSync(EVENTS_INDEX_FILE, renderEventsIndex(remaining));
}

function runPrettier(files) {
  const prettier = path.join(ROOT, "node_modules/.bin/prettier");
  if (!existsSync(prettier)) return; // best-effort — não falha o scaffold por isso
  spawnSync(prettier, ["--write", ...files], { cwd: ROOT, stdio: "ignore" });
}

// ---------------------------------------------------------------------------
// subcomandos
// ---------------------------------------------------------------------------

function cmdScaffold(args) {
  const specIdx = args.indexOf("--spec");
  if (specIdx === -1 || !args[specIdx + 1]) fail("uso: scaffold --spec <arquivo.json|->");
  const spec = readSpec(args[specIdx + 1]);

  const kebab = toKebab(spec.type);
  const eventFile = path.join(CONTRACTS_EVENTS_DIR, `${kebab}.ts`);
  const testFile = path.join(CONTRACTS_EVENTS_DIR, `${kebab}.test.ts`);
  const samplePath = path.join(SAMPLES_DIR, `${kebab}.json`);
  const docPath = path.join(DOCS_DIR, `${kebab}.md`);

  if (existsSync(eventFile)) fail(`já existe: ${path.relative(ROOT, eventFile)}`);

  mkdirSync(CONTRACTS_EVENTS_DIR, { recursive: true });
  mkdirSync(SAMPLES_DIR, { recursive: true });
  mkdirSync(DOCS_DIR, { recursive: true });

  writeFileSync(eventFile, renderEventFile(spec));
  writeFileSync(testFile, renderTestFile(spec));
  writeFileSync(samplePath, JSON.stringify(buildSampleEnvelope(spec), null, 2) + "\n");
  writeFileSync(docPath, renderDoc(spec, samplePath));

  patchEventsIndexAdd({ varName: `${toCamel(spec.type)}Event`, file: kebab });

  // `renderTestFile` embute o objeto de exemplo cru dentro de uma chamada
  // já indentada — a indentação interna sai errada até passar pelo
  // prettier. Rodar aqui evita depender de o programador lembrar de
  // `pnpm format` antes de olhar o diff.
  runPrettier([eventFile, testFile, EVENTS_INDEX_FILE]);

  const rel = (p) => path.relative(ROOT, p);
  console.log("criado:");
  console.log(`  ${rel(eventFile)}`);
  console.log(`  ${rel(testFile)}`);
  console.log(`  ${rel(samplePath)}`);
  console.log(`  ${rel(docPath)}`);
  console.log(`patch: ${rel(EVENTS_INDEX_FILE)}`);
  console.log("");
  console.log("próximos passos:");
  console.log("  pnpm --filter @realtime-events/contracts run build");
  console.log("  pnpm test");
  console.log(`  node ${rel(__filename)} verify --type ${spec.type}`);
}

function cmdRemove(args) {
  const typeIdx = args.indexOf("--type");
  if (typeIdx === -1 || !args[typeIdx + 1]) fail("uso: remove --type <type>");
  const type = args[typeIdx + 1];
  const kebab = toKebab(type);

  const eventFile = path.join(CONTRACTS_EVENTS_DIR, `${kebab}.ts`);
  const testFile = path.join(CONTRACTS_EVENTS_DIR, `${kebab}.test.ts`);
  const samplePath = path.join(SAMPLES_DIR, `${kebab}.json`);
  const docPath = path.join(DOCS_DIR, `${kebab}.md`);

  patchEventsIndexRemove(kebab);

  for (const f of [eventFile, testFile, samplePath, docPath]) {
    if (existsSync(f)) unlinkSync(f);
  }

  console.log(`removido: ${type} (${kebab}.ts e derivados)`);
}

function cmdVerify(args) {
  const typeIdx = args.indexOf("--type");
  if (typeIdx === -1 || !args[typeIdx + 1]) fail("uso: verify --type <type>");
  const type = args[typeIdx + 1];
  const kebab = toKebab(type);
  const samplePath = path.join(SAMPLES_DIR, `${kebab}.json`);
  if (!existsSync(samplePath))
    fail(`sample não encontrado: ${path.relative(ROOT, samplePath)} (rode "scaffold" primeiro)`);

  const tsx = path.join(ROOT, "apps/server/node_modules/.bin/tsx");
  const script = path.join(ROOT, "apps/server/scripts/verify-event.mts");
  if (!existsSync(tsx)) fail(`tsx não encontrado em ${tsx} — rode "pnpm install" na raiz`);

  const result = spawnSync(tsx, [script, "--sample", samplePath], {
    cwd: path.join(ROOT, "apps/server"),
    stdio: "inherit",
  });
  process.exit(result.status ?? 1);
}

function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "scaffold") return cmdScaffold(rest);
  if (cmd === "remove") return cmdRemove(rest);
  if (cmd === "verify") return cmdVerify(rest);
  fail(`comando desconhecido: "${cmd ?? ""}". Use scaffold | verify | remove.`);
}

main();
