# One image for Coolify (or any Docker host): the Next.js app and the WhatsApp bot run
# side by side (scripts/start.mjs). Needs DATABASE_URL (Postgres) and APP_URL; keep /data
# on a volume so the WhatsApp login survives redeploys. PORT (default 3000) is the app's
# port; BOT_PORT (default 3001) is only used inside the container.
FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS app-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY bot/package.json bot/
RUN pnpm install --frozen-lockfile --filter futtarns

FROM base AS bot-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY bot/package.json bot/
RUN pnpm install --frozen-lockfile --prod --filter futtarns-bot

FROM base AS build
COPY --from=app-deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

FROM node:24-alpine AS runner
# The port the app listens on; override at build time or with PORT at runtime.
ARG PORT=3000
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=${PORT} \
    HOSTNAME=0.0.0.0 \
    AUTH_DIR=/data/whatsapp
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/drizzle ./drizzle
COPY --from=bot-deps --chown=node:node /app/node_modules /opt/bot/node_modules
COPY --from=bot-deps --chown=node:node /app/bot/node_modules /opt/bot/bot/node_modules
COPY --chown=node:node bot/package.json /opt/bot/bot/package.json
COPY --chown=node:node bot/src /opt/bot/bot/src
COPY --chown=node:node scripts/start.mjs ./start.mjs
RUN mkdir -p /data/whatsapp && chown -R node:node /data
USER node
VOLUME /data
EXPOSE ${PORT}
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null || exit 1
CMD ["node", "start.mjs"]
