# M0 — dev image. Prod runs behind Caddy (infra/caddy) with auto-TLS.
FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/protocol/package.json ./packages/protocol/
COPY packages/config/package.json ./packages/config/
RUN pnpm install --frozen-lockfile=false

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/server ./apps/server
RUN pnpm --filter @orbit/protocol build && pnpm --filter @orbit/server build

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/apps/server/dist ./dist
COPY --from=build /app/apps/server/package.json ./
COPY --from=deps /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "dist/server.js"]
