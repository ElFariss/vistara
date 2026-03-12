FROM node:24-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

COPY client/package.json client/package-lock.json* ./client/
RUN cd client && npm ci

COPY client ./client
RUN cd client && npm run build

FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
# Copy built client to dist, which server.mjs will serve over public
COPY --from=builder /app/dist ./dist
COPY scripts ./scripts
COPY test.csv ./test.csv
COPY .env.example ./.env.example
COPY docker/entrypoint.sh /entrypoint.sh

RUN mkdir -p data/uploads
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
