# The WhatsApp bot. Build from the repository root: docker build -f bot/Dockerfile .
FROM node:24-alpine
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY bot/package.json bot/
RUN pnpm install --frozen-lockfile --prod --filter futtarns-bot
COPY bot/src bot/src
WORKDIR /app/bot
ENV NODE_ENV=production \
    PORT=3001 \
    AUTH_DIR=/data/auth
RUN mkdir -p /data/auth && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3001/health >/dev/null || exit 1
CMD ["node", "src/index.ts"]
