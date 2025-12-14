# --- Stage 1: Builder ---
FROM node:20-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
# CHANGED: 'npm ci' -> 'npm install' to fix lockfile mismatch
RUN npm install

# Copy Source
COPY . .

# 1. Build Frontend (Vite)
RUN npm run build

# 2. Build Backend (Esbuild)
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
# CHANGED: 'npm ci' -> 'npm install'
RUN npm install --only=production

# Copy Frontend Build
COPY --from=builder /app/dist ./dist

# Copy Backend Build (Bundled JS)
COPY --from=builder /app/dist-server ./dist-server

# Copy Entrypoint
COPY entrypoint.sh ./
RUN chmod +x entrypoint.sh

EXPOSE 80

ENTRYPOINT ["./entrypoint.sh"]