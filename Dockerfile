# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage — installs all dependencies, generates the Prisma Client
# (Prisma 7 + @prisma/adapter-pg: pure JS driver adapter, no Rust query
# engine binary to fetch), and compiles TypeScript to dist/.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json nest-cli.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src

# prisma.config.ts eagerly resolves DATABASE_URL (via env()) just to load,
# even for `generate`, which never actually connects to a database — a
# build-time-only placeholder satisfies that without needing real
# credentials at image-build time.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
RUN npm run build

# ---------------------------------------------------------------------------
# Runtime stage — production dependencies only, plus the compiled app
# (which already includes the generated Prisma Client under
# dist/src/generated/prisma — see tsconfig.json, generated/ is not
# excluded from the TypeScript compilation).
#
# Also carries the `prisma` CLI itself, `prisma.config.ts`, and
# `prisma/` (schema + migrations) — not needed by the running app
# (which only imports @prisma/client + @prisma/adapter-pg, the actual
# runtime driver, both already regular dependencies), but needed to run
# `npx prisma migrate deploy` as a release step *against this exact
# image* (CD, .github/workflows/cd.yml, and docs/deployment.md's manual
# procedure both do this) rather than requiring a separate migration
# image with a different dependency set than what's actually deployed.
# `prisma` and `dotenv` (prisma.config.ts's own `import 'dotenv/config'`)
# are therefore real `dependencies` in package.json, not devDependencies
# — `npm ci --omit=dev` below would otherwise silently omit both and
# `prisma migrate deploy` would fail inside this image with no local
# `prisma` binary and no schema to read.
# ---------------------------------------------------------------------------
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY prisma.config.ts ./
COPY prisma ./prisma

# Run as the non-root `node` user the base image already provides
# (uid/gid 1000) rather than the default root — standard container
# hardening, no application code change required. `chown` happens before
# the `USER` switch since only root can change ownership.
RUN chown -R node:node /app
USER node

# Database migrations are a separate release step
# (`npx prisma migrate deploy`), not run automatically on container
# start — this image only runs the compiled application.
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
