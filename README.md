# realtime-events

Servidor de notificações em tempo real (Socket.IO) que liga um webhook PHP
ao front React da aplicação: o PHP recebe uma notificação do parceiro,
repassa para este servidor, e o servidor entrega para as sessões de
navegador certas — sem que o usuário precise dar reload na página.

Projetado para crescer: adicionar um novo tipo de notificação é criar um
arquivo de schema e registrá-lo (ver [Adicionando um novo tipo de
notificação](#adicionando-um-novo-tipo-de-notificação)), sem tocar em
servidor, autenticação ou roteamento.

## Arquitetura

```
[PHP webhook] --HTTP+HMAC--> POST /internal/emit ┐
                                                  ├─> dispatchEvent (domínio)
                                                  │     resolve audiência → salas
                                                  ▼
                                           EventPublisher (porta)
                                                  │
                                     SocketIoPublisher (adapter)
                                                  │
                                          [navegadores React]
```

- **`packages/contracts`** — catálogo de tipos de notificação (Zod), o
  envelope compartilhado, e o único ponto de extensão do sistema.
- **`apps/server`** — servidor Socket.IO. Domínio (`core/`) não sabe que
  existe HTTP nem WebSocket; adapters (`http/`, `realtime/`, `adapters/`)
  plugam nas portas do domínio.
- **`packages/client-react`** — `RealtimeProvider` + hooks
  (`useRealtimeEvent`, `useEntitySubscription`, `useRealtimeStatus`) para o
  front React consumir.
- **`apps/playground`** — app React mínimo + script `pnpm emit` que simula
  o webhook PHP, para testar o pipeline inteiro sem depender do PHP.

Decisões de design (autenticação por JWT curto, salas hierárquicas por
tenant, entrega best-effort com refetch no reconnect, etc.) estão
documentadas nos comentários dos módulos correspondentes, começando por
`packages/contracts/src/registry.ts` e `apps/server/src/core/resolve-rooms.ts`.

## Como rodar localmente

Requer Node ≥ 22 e pnpm.

```bash
pnpm install
cp .env.example .env   # já existe um .env de desenvolvimento no repo; ajuste se precisar
pnpm dev                # servidor em http://localhost:4000
pnpm dev:playground      # em outro terminal — front de demonstração em http://localhost:5173
pnpm emit --type order.updated --orderId 123   # em outro terminal — simula o webhook PHP
```

Com os três rodando, disparar `pnpm emit` faz a seção "Notificações
recebidas" do playground atualizar sem reload.

Outros comandos úteis:

```bash
pnpm test        # unitários + integração (sobe o servidor real numa porta efêmera)
pnpm typecheck
pnpm lint
pnpm build        # compila contracts, client-react e server
```

## Contrato de ingestão (`POST /internal/emit`)

O PHP assina o corpo cru com HMAC-SHA256 usando o segredo compartilhado
(`INGEST_HMAC_SECRET`):

```
POST /internal/emit
Content-Type: application/json
X-Timestamp: <unix seconds>
X-Signature: sha256=<hex de HMAC(secret, "${timestamp}.${rawBody}")>

{
  "id": "uuid-v4",
  "type": "order.updated",
  "v": 1,
  "occurredAt": "2026-08-12T21:49:00Z",
  "audience": { "tenantId": 7, "userIds": [12] },
  "payload": { "orderId": 123, "status": "updated" }
}
```

- `audience` descreve **quem** recebe (em termos que o PHP já conhece:
  tenant, usuários, entidade). O servidor traduz isso para salas do
  Socket.IO — o PHP nunca decide nomes de sala. Regras de roteamento em
  `apps/server/src/core/resolve-rooms.ts`.
- Aceita lote: `{ "events": [ envelope, envelope, ... ] }`.
- Resposta `202 { "accepted": n }`. Validação é tudo-ou-nada: se qualquer
  evento do lote falhar, o lote inteiro volta `422` com a lista de erros.
- `401` para assinatura inválida ou timestamp fora da janela de tolerância
  (`INGEST_TIMESTAMP_TOLERANCE_SECONDS`, anti-replay).
- `413` se o corpo passar de `MAX_BODY_BYTES`.

Exemplo com `curl` (secret de desenvolvimento do `.env` do repo):

```bash
BODY='{"id":"550e8400-e29b-41d4-a716-446655440000","type":"order.updated","v":1,"occurredAt":"2026-08-12T21:49:00Z","audience":{"tenantId":"7"},"payload":{"orderId":123}}'
TS=$(date +%s)
SIG="sha256=$(printf '%s' "${TS}.${BODY}" | openssl dgst -sha256 -hmac "$INGEST_HMAC_SECRET" | sed 's/^.* //')"
curl -X POST http://localhost:4000/internal/emit \
  -H "Content-Type: application/json" \
  -H "X-Timestamp: $TS" \
  -H "X-Signature: $SIG" \
  -d "$BODY"
```

### Exemplo em PHP

```php
<?php

function signRealtimeEnvelope(array $envelope, string $secret): array
{
    $rawBody = json_encode($envelope, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    $timestamp = (string) time();
    $signature = 'sha256=' . hash_hmac('sha256', "{$timestamp}.{$rawBody}", $secret);

    return [
        'body' => $rawBody,
        'headers' => [
            'Content-Type: application/json',
            "X-Timestamp: {$timestamp}",
            "X-Signature: {$signature}",
        ],
    ];
}

$envelope = [
    'id' => Str::uuid()->toString(), // troque pelo gerador de UUID do seu framework
    'type' => 'order.updated',
    'v' => 1,
    'occurredAt' => gmdate('Y-m-d\TH:i:s\Z'),
    'audience' => ['tenantId' => $tenantId, 'userIds' => [$userId]],
    'payload' => ['orderId' => $order->id, 'status' => $order->status],
];

['body' => $body, 'headers' => $headers] = signRealtimeEnvelope(
    $envelope,
    getenv('REALTIME_INGEST_HMAC_SECRET'),
);

$ch = curl_init('http://realtime-server:4000/internal/emit');
curl_setopt_array($ch, [
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $body,
    CURLOPT_HTTPHEADER => $headers,
    CURLOPT_RETURNTRANSFER => true,
]);
curl_exec($ch);
```

## Autenticação do front

O React se conecta usando um JWT curto (HS256, TTL de 10 min) que **o PHP
emite** — este servidor só valida. Implemente um endpoint no PHP:

```
GET /api/realtime/token  (autenticado pela sessão normal da aplicação)
→ { "token": "<jwt>" }
```

Claims esperadas no JWT (assinado com o mesmo `JWT_SECRET`):

```json
{ "sub": "<userId>", "tenantId": "<tenantId>", "exp": ... }
```

`JWT_SECRET` é compartilhado em base64, e o PHP deve assinar com os **bytes
decodificados** desse valor — não com a string base64 em si
(`base64_decode($secret)` antes de passar para a lib de JWT do PHP). Este
servidor decodifica da mesma forma por padrão; veja `JWT_SECRET_ENCODING` em
`.env.example` para desativar isso caso o segredo seja texto puro.

No front:

```tsx
import { RealtimeProvider } from "@realtime-events/client-react";

async function getToken() {
	const res = await fetch("/api/realtime/token");
	const { token } = await res.json();
	return token;
}

<RealtimeProvider url="https://realtime.example.com" getToken={getToken}>
	<App />
</RealtimeProvider>;
```

`getToken` é chamado a cada tentativa de conexão/reconexão — nunca guarde
um token fixo, ele expira em minutos.

Para assinar/atualizar uma parte específica da tela:

```tsx
import { useRealtimeEvent, useEntitySubscription } from "@realtime-events/client-react";

function OrderPanel({ orderId }: { orderId: number }) {
	useEntitySubscription("order", orderId); // entra na sala da entidade

	useRealtimeEvent("order.updated", event => {
		if (event.payload.orderId === orderId) refetchOrder();
	});

	// ...
}
```

## Adicionando um novo tipo de notificação

Caminho preferido: a skill `/new-event`
(`.claude/skills/new-event/SKILL.md`) entrevista você sobre os campos do
payload e as regras de audiência, e gera o arquivo do evento, o registro, um
teste, um envelope de exemplo, docs com snippet PHP + React, e prova a
entrega ponta a ponta contra o servidor real.

Passo a passo manual, caso não esteja usando a skill:

1. Crie `packages/contracts/src/events/<nome>.ts`:

    ```ts
    import { z } from "zod";
    import { defineEvent } from "../registry.js";

    export const invoicePaidPayloadSchema = z.object({
    	invoiceId: z.union([z.string(), z.number()]),
    });

    export const invoicePaidEvent = defineEvent({
    	type: "invoice.paid",
    	v: 1,
    	payload: invoicePaidPayloadSchema,
    });
    ```

2. Registre em `packages/contracts/src/events/index.ts`:

    ```ts
    export const registry = createRegistry().register(orderUpdatedEvent).register(invoicePaidEvent);
    ```

3. Rode `pnpm build` (ou `pnpm --filter @realtime-events/contracts dev` em watch).

Nada mais muda: o servidor valida automaticamente contra o schema
registrado (tipo desconhecido = `422`), e o front assina com
`useRealtimeEvent("invoice.paid", handler)`.

## Escalando para múltiplos nós

Por padrão o servidor roda em 1 nó com o adapter em memória do Socket.IO.
Para rodar mais de um nó atrás de um load balancer, defina `REDIS_URL` — o
`@socket.io/redis-adapter` liga automaticamente (`apps/server/src/adapters/redis.ts`).
No `docker-compose.yml`, descomente o serviço `redis` e a variável
`REDIS_URL` do serviço `realtime-server`.

## Docker

```bash
docker compose up --build
```

O `Dockerfile` é multi-stage: instala e builda com devDependencies num
stage, depois reinstala só as dependências de produção preservando a
estrutura do workspace (os symlinks internos do pnpm são relativos, então
sobrevivem ao `COPY` entre stages), e a imagem final não carrega toolchain
de build. Variáveis obrigatórias: `INGEST_HMAC_SECRET`, `JWT_SECRET` (ver
`.env.example`).

## Variáveis de ambiente

Ver `.env.example` para a lista comentada. As obrigatórias são
`INGEST_HMAC_SECRET` (mínimo 16 caracteres) e `JWT_SECRET` (mínimo 16 bytes
depois de decodificado — ver `JWT_SECRET_ENCODING`); o resto tem default
sensato para desenvolvimento.

## Testes

```bash
pnpm test
```

Cobre unitários (HMAC, registry, resolução de salas, middleware JWT) e um
teste de integração que sobe o servidor real numa porta efêmera e conversa
com ele via `socket.io-client`, validando: entrega para a audiência certa,
isolamento entre tenants, rejeição de assinatura inválida, rejeição de tipo
desconhecido, e subscribe/unsubscribe de sala de entidade.
