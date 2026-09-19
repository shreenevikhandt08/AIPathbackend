# AI Path Builder API — Express
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --legacy-peer-deps \
    || npm install --omit=dev --legacy-peer-deps --no-audit --no-fund

COPY . .

ENV NODE_ENV=production
ENV PORT=5001
EXPOSE 5001

CMD ["node", "server.js"]
