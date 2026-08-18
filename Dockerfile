# syntax=docker/dockerfile:1

# Imagem só do servidor Socket.IO (@realtime-events/server). O playground é
# uma ferramenta de desenvolvimento e não entra nesta imagem.
#
# Estratégia: em vez de `pnpm deploy` (cujo modo "injected" exige reinstalar
# o lockfile inteiro e cujo modo "legacy" usa symlinks absolutos que não
# sobrevivem a um COPY entre stages), preservamos a estrutura relativa do
# monorepo entre os stages — os symlinks que o pnpm cria dentro de
# node_modules são relativos (ex.: apps/server/node_modules/@realtime-events
# /contracts -> ../../../../packages/contracts), então continuam válidos
# depois de copiados, desde que a árvore de diretórios em volta deles
# também seja copiada.

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@11.21.0 --activate
WORKDIR /repo

# ---- deps: instala com devDependencies; só os manifests primeiro, para
# cache de camada (não invalida com toda mudança de código-fonte) ----
FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/client-react/package.json packages/client-react/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/playground/package.json apps/playground/package.json
RUN pnpm install --frozen-lockfile

# ---- dev: mesmas deps (com devDependencies), mas sem copiar o código-fonte
# — o docker-compose.dev.yml monta o repo como bind mount por cima e roda
# `pnpm dev` / `pnpm dev:playground` com hot-reload (tsx watch / vite) ----
FROM deps AS dev
CMD ["pnpm", "dev"]

# ---- build: compila contracts (dependência) e o servidor ----
FROM deps AS build
COPY packages/contracts packages/contracts
COPY apps/server apps/server
RUN pnpm --filter @realtime-events/contracts run build
RUN pnpm --filter @realtime-events/server run build

# ---- prune: descarta node_modules com devDependencies e reinstala só as
# de produção, preservando a estrutura de diretórios do workspace ----
FROM build AS prune
RUN rm -rf node_modules packages/contracts/node_modules apps/server/node_modules \
  packages/client-react/node_modules apps/playground/node_modules
RUN pnpm install --frozen-lockfile --prod

# ---- runtime: imagem final, sem toolchain de build nem devDependencies ----
FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /repo
COPY --from=prune /repo/node_modules ./node_modules
COPY --from=prune /repo/package.json /repo/pnpm-workspace.yaml ./
COPY --from=prune /repo/packages/contracts/package.json packages/contracts/package.json
COPY --from=prune /repo/packages/contracts/dist packages/contracts/dist
COPY --from=prune /repo/packages/contracts/node_modules packages/contracts/node_modules
COPY --from=prune /repo/apps/server/package.json apps/server/package.json
COPY --from=prune /repo/apps/server/dist apps/server/dist
COPY --from=prune /repo/apps/server/node_modules apps/server/node_modules

WORKDIR /repo/apps/server
EXPOSE 4000
CMD ["node", "dist/main.js"]
