# --- Stage 1: Builder ---
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy Source
COPY . .

# 1. Build Frontend (Vite) -> outputs to /app/dist
RUN npm run build

# 2. Build Backend (TSC) -> outputs to /app/dist-server
# We run tsc explicitly on the backend files
RUN npx tsc server.ts client.ts scanner.ts types.ts --outDir dist-server --esModuleInterop --resolveJsonModule


# --- Stage 2: Runner ---
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

# Copy Frontend Build
COPY --from=builder /app/dist ./dist

# Copy Backend Build (Compiled JS)
COPY --from=builder /app/dist-server ./dist-server

# Copy Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 80

ENTRYPOINT ["./entrypoint.sh"]