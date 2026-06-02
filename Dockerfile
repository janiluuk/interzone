FROM node:22-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Build server (tsc) and dashboard (vite)
RUN npm run build:server
RUN npm run build:dashboard

FROM node:22-alpine
WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 4242
CMD ["node", "dist/server.js"]
