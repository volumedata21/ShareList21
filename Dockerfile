# --- Stage 1: Builder ---
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy Source
COPY . .

# 1. Build Frontend (Vite)
RUN npm run build

# 2. Build Backend (Esbuild)
# - --bundle: Combines scanner.ts into server.js/client.js (fixes import errors)
# - --packages=external: Keeps node_modules external (sqlite3 works better this way)
# - --format=esm: Outputs modern ES Modules
# - --platform=node: Optimizes for Node.js
RUN npx esbuild server.ts client.ts \
    --bundle \
    --platform=node \
    --target=node20 \
    --format=esm \
    --packages=external \
    --outdir=dist-server


# --- Stage 2: Runner ---
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --only=production

# Copy Frontend Build
COPY --from=builder /app/dist ./dist

# Copy Backend Build (Bundled JS)
COPY --from=builder /app/dist-server ./dist-server

# Copy Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 80

ENTRYPOINT ["./entrypoint.sh"]