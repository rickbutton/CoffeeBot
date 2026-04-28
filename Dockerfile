FROM mcr.microsoft.com/playwright:v1.59.1-noble

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends sqlite3 \
    && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9

# --- Dependency layer: cached unless package.json or lockfile change.
# Code-only deploys reuse this layer and skip the install entirely.
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# --- Source + build layer: invalidated only when source changes.
COPY tsconfig.json ./
COPY src ./src
COPY drizzle ./drizzle
RUN pnpm build && pnpm prune --prod

ENV NODE_ENV=production
CMD ["node", "--enable-source-maps", "dist/index.js"]
