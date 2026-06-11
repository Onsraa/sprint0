# QuantaPay API — Node runtime, production deps only, non-root
FROM node:20-alpine

WORKDIR /srv/quantapay
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public

USER node

EXPOSE 3000
CMD ["node", "src/server.js"]
