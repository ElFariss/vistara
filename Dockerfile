FROM node:24-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY test.csv ./test.csv
COPY .env.example ./.env.example
COPY docker/entrypoint.sh /entrypoint.sh

RUN mkdir -p data/uploads
RUN chmod +x /entrypoint.sh

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npm", "start"]
